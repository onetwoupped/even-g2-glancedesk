import struct
import zlib
from pathlib import Path

W, H = 576, 288

# Minimal 5x7 uppercase/ASCII bitmap glyphs for clear pixel-exact verification
FONT = {
    'A': ["01110","10001","10001","11111","10001","10001","10001"],
    'B': ["11110","10001","10001","11110","10001","10001","11110"],
    'C': ["01110","10001","10000","10000","10000","10001","01110"],
    'D': ["11100","10010","10001","10001","10001","10010","11100"],
    'E': ["11111","10000","10000","11110","10000","10000","11111"],
    'F': ["11111","10000","10000","11110","10000","10000","10000"],
    'G': ["01110","10001","10000","10111","10001","10001","01110"],
    'H': ["10001","10001","10001","11111","10001","10001","10001"],
    'I': ["01110","00100","00100","00100","00100","00100","01110"],
    'J': ["00111","00010","00010","00010","10010","10010","01100"],
    'K': ["10001","10010","10100","11000","10100","10010","10001"],
    'L': ["10000","10000","10000","10000","10000","10000","11111"],
    'M': ["10001","11011","10101","10101","10001","10001","10001"],
    'N': ["10001","11001","10101","10011","10001","10001","10001"],
    'O': ["01110","10001","10001","10001","10001","10001","01110"],
    'P': ["11110","10001","10001","11110","10000","10000","10000"],
    'Q': ["01110","10001","10001","10001","10101","10010","01101"],
    'R': ["11110","10001","10001","11110","10100","10010","10001"],
    'S': ["01111","10000","10000","01110","00001","00001","11110"],
    'T': ["11111","00100","00100","00100","00100","00100","00100"],
    'U': ["10001","10001","10001","10001","10001","10001","01110"],
    'V': ["10001","10001","10001","10001","10001","01010","00100"],
    'W': ["10001","10001","10001","10101","10101","11011","10001"],
    'X': ["10001","10001","01010","00100","01010","10001","10001"],
    'Y': ["10001","10001","01010","00100","00100","00100","00100"],
    'Z': ["11111","00001","00010","00100","01000","10000","11111"],
    '0': ["01110","10011","10101","10101","11001","10001","01110"],
    '1': ["00100","01100","00100","00100","00100","00100","01110"],
    '2': ["01110","10001","00001","00110","01000","10000","11111"],
    '3': ["11110","00001","00001","01110","00001","00001","11110"],
    '4': ["00010","00110","01010","10010","11111","00010","00010"],
    '5': ["11111","10000","11110","00001","00001","10001","01110"],
    '6': ["01110","10000","11110","10001","10001","10001","01110"],
    '7': ["11111","00001","00010","00100","01000","01000","01000"],
    '8': ["01110","10001","10001","01110","10001","10001","01110"],
    '9': ["01110","10001","10001","01111","00001","00010","01100"],
    '$': ["00100","01111","10100","01110","00101","11110","00100"],
    '%': ["11001","11010","00100","00100","01011","10011","00000"],
    '.': ["00000","00000","00000","00000","00000","01100","01100"],
    ':': ["00000","00100","00100","00000","00100","00100","00000"],
    '-': ["00000","00000","00000","11111","00000","00000","00000"],
    '+': ["00000","00100","00100","11111","00100","00100","00000"],
    '/': ["00001","00010","00100","00100","01000","10000","00000"],
    '(': ["00010","00100","01000","01000","01000","00100","00010"],
    ')': ["01000","00100","00010","00010","00010","00100","01000"],
    '[': ["01110","01000","01000","01000","01000","01000","01110"],
    ']': ["01110","00010","00010","00010","00010","00010","01110"],
    '@': ["01110","10001","10111","10101","10110","10000","01110"],
    '|': ["00100","00100","00100","00100","00100","00100","00100"],
    ' ': ["00000","00000","00000","00000","00000","00000","00000"],
}


def make_canvas():
    return bytearray(W * H * 3)


def set_px(buf, x, y, rgb):
    if 0 <= x < W and 0 <= y < H:
        i = (y * W + x) * 3
        buf[i : i + 3] = bytes(rgb)


def draw_rect(buf, x, y, w, h, rgb):
    for dx in range(w):
        set_px(buf, x + dx, y, rgb)
        set_px(buf, x + dx, y + h - 1, rgb)
    for dy in range(h):
        set_px(buf, x, y + dy, rgb)
        set_px(buf, x + w - 1, y + dy, rgb)


def draw_line(buf, x0, y0, x1, y1, rgb, thick=1):
    steps = max(abs(x1 - x0), abs(y1 - y0), 1)
    for s in range(steps + 1):
        px = int(round(x0 + (x1 - x0) * s / steps))
        py = int(round(y0 + (y1 - y0) * s / steps))
        for oy in range(-thick // 2, thick // 2 + 1):
            for ox in range(-thick // 2, thick // 2 + 1):
                set_px(buf, px + ox, py + oy, rgb)


def draw_text(buf, x, y, text, rgb, scale=2):
    cx = x
    for ch in text.upper():
        g = FONT.get(ch, FONT[' '])
        for row_i, row in enumerate(g):
            for col_i, bit in enumerate(row):
                if bit == '1':
                    for sy in range(scale):
                        for sx in range(scale):
                            set_px(buf, cx + col_i * scale + sx, y + row_i * scale + sy, rgb)
        cx += 6 * scale


def save_png(buf, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    raw_rows = bytearray()
    stride = W * 3
    for y in range(H):
        raw_rows.append(0)
        raw_rows.extend(buf[y * stride : (y + 1) * stride])

    def chunk(ctype, data):
        return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw_rows), 6)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def render_g2_feed_with_sparkline(out_path: Path):
    buf = make_canvas()
    bright = (46, 255, 136)
    mid = (24, 155, 82)
    dim = (14, 88, 46)
    fill = (8, 42, 22)

    # Exact GlanceDesk v2 layout coordinates from src/layout.ts:
    # hdr: (0, 0, 576, 40)
    draw_rect(buf, 0, 0, 576, 40, mid)
    draw_text(buf, 10, 12, "TG [1/1] @ONEUPPED | 1M AGO", bright, scale=2)

    # main: (0, 46, 372, 178)
    draw_rect(buf, 0, 46, 372, 178, dim)
    draw_text(buf, 12, 62, "SOL BREAKOUT INCOMING", bright, scale=2)
    draw_text(buf, 12, 86, "WATCHING FUNDING RATE", mid, scale=2)
    draw_text(buf, 12, 134, "SOL-PERP $72.13 (+2.1%)", bright, scale=2)
    draw_text(buf, 12, 162, "FUND +0.001% | BAL $9750", mid, scale=2)

    # chart imageObject: (380, 64, 192, 140)
    cx, cy, cw, ch = 380, 64, 192, 140
    draw_rect(buf, cx, cy, cw, ch, mid)
    draw_text(buf, cx + 8, cy + 8, "SOL 24H +2.1%", bright, scale=1)

    # Realistic 24h SOL curve
    closes = [70.6,70.8,70.5,70.9,71.2,71.0,70.7,70.9,71.1,71.5,71.4,71.3,71.6,71.8,71.5,71.9,72.0,71.7,71.8,72.1,72.3,72.0,72.2,72.13]
    mn, mx = min(closes), max(closes)
    span = mx - mn or 1.0
    pad_l, pad_r, pad_t, pad_b = 10, 12, 26, 22
    pw, ph = cw - pad_l - pad_r, ch - pad_t - pad_b

    # Dashed mid line
    mid_y = cy + pad_t + ph // 2
    for dx in range(0, pw, 6):
        draw_line(buf, cx + pad_l + dx, mid_y, cx + pad_l + min(dx + 2, pw), mid_y, dim, 1)

    pts = []
    for i, val in enumerate(closes):
        px = int(cx + pad_l + (i / (len(closes) - 1)) * pw)
        py = int(cy + pad_t + (1.0 - (val - mn) / span) * ph)
        pts.append((px, py))

    # Fill under curve
    base_y = cy + pad_t + ph
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        for px in range(x0, x1 + 1):
            t = (px - x0) / max(1, x1 - x0)
            yt = int(y0 + (y1 - y0) * t)
            for py in range(yt, base_y):
                set_px(buf, px, py, fill)

    for i in range(len(pts) - 1):
        draw_line(buf, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], bright, thick=2)

    # Endpoint dot
    ex, ey = pts[-1]
    for oy in range(-3, 4):
        for ox in range(-3, 4):
            if ox * ox + oy * oy <= 10:
                set_px(buf, ex + ox, ey + oy, bright)

    draw_text(buf, cx + 8, cy + ch - 15, f"L:{mn:.2f} H:{mx:.2f}", mid, scale=1)

    # act footer: (0, 230, 576, 58)
    draw_rect(buf, 0, 230, 576, 58, dim)
    draw_text(buf, 10, 250, "TAP: REPLY/TRADE | SWIPE: NEXT | DBL: EXIT", mid, scale=2)

    save_png(buf, out_path)


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "artifacts" / "g2_feed_preview.png"
    render_g2_feed_with_sparkline(out)
    print(f"Rendered {out} ({out.stat().st_size} bytes)")

import struct
import zlib
from pathlib import Path

W, H = 576, 288

FONT = {
    'A': ["01110","10001","10001","11111","10001","10001","10001"],
    'B': ["11110","10001","10001","11110","10001","10001","11110"],
    'C': ["01110","10001","10000","10000","10000","10001","01110"],
    'D': ["11100","10010","10001","10001","10001","10010","11100"],
    'E': ["11111","10000","10000","11110","10000","10000","11111"],
    'F': ["11111","10000","10000","11110","10000","10000","00000"],
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
    '>': ["10000","01000","00100","00010","00100","01000","10000"],
    ' ': ["00000","00000","00000","00000","00000","00000","00000"],
}


def make_canvas():
    return bytearray(W * H * 3)


def set_px(buf, x, y, rgb):
    if 0 <= x < W and 0 <= y < H:
        i = (y * W + x) * 3
        buf[i : i + 3] = bytes(rgb)


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


def draw_borderless_chart(buf, cx, cy, cw, ch, title, closes, ref_val, ref_label):
    bright = (56, 255, 146)
    soft = (28, 138, 76)
    ref_col = (34, 175, 96)

    draw_text(buf, cx + 4, cy + 2, title, soft, scale=1)

    all_v = closes + ([ref_val] if ref_val is not None else [])
    mn, mx = min(all_v), max(all_v)
    span = mx - mn or 1.0
    pad_l, pad_r, pad_t, pad_b = 4, 8, 18, 18
    pw, ph = cw - pad_l - pad_r, ch - pad_t - pad_b

    def to_y(v):
        return int(cy + pad_t + (1.0 - (v - mn) / span) * ph)

    if ref_val is not None:
        ry = to_y(ref_val)
        for dx in range(0, pw, 7):
            draw_line(buf, cx + pad_l + dx, ry, cx + pad_l + min(dx + 3, pw), ry, ref_col, 1)
        lbl_w = len(ref_label) * 6
        lbl_y = ry + 4 if ry < cy + pad_t + ph // 2 else max(cy + 14, ry - 10)
        draw_text(buf, cx + pad_l + pw - lbl_w, lbl_y, ref_label, soft, scale=1)

    pts = [
        (int(cx + pad_l + (i / (len(closes) - 1)) * pw), to_y(v))
        for i, v in enumerate(closes)
    ]
    for i in range(len(pts) - 1):
        draw_line(buf, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], bright, thick=2)

    ex, ey = pts[-1]
    for oy in range(-3, 4):
        for ox in range(-3, 4):
            if ox * ox + oy * oy <= 9:
                set_px(buf, ex + ox, ey + oy, bright)

    draw_text(buf, cx + 4, cy + ch - 11, f"{mn:.2f} - {mx:.2f}", soft, scale=1)


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


def render_screens(out_dir: Path):
    bright = (56, 255, 146)
    mid = (32, 168, 92)
    dim = (18, 96, 52)

    # Screen 1: 1.5R Break-Even Prompt (In-lecture / hands-free position management)
    buf = make_canvas()
    draw_text(buf, 16, 14, "1.5R REACHED - SOL SHORT", dim, scale=1)
    draw_text(buf, 16, 48, "SOL SHORT  +1.52R", bright, scale=2)
    draw_text(buf, 16, 76, "$70.75 (IN $72.40)", mid, scale=2)
    draw_text(buf, 16, 128, "> MOVE STOP TO BE ($72.40)", bright, scale=2)
    draw_text(buf, 16, 158, "  TAKE 50% (+$19.0)", mid, scale=2)
    draw_text(buf, 16, 188, "  CLOSE ALL (+$38.0)", mid, scale=2)
    draw_text(buf, 16, 260, "SWIPE PICK - TAP ACT - DBL EXIT", dim, scale=1)

    sol_closes = [72.5, 72.4, 72.6, 72.3, 72.1, 72.2, 71.9, 71.8, 71.6, 71.7, 71.4, 71.2, 71.3, 71.0, 70.9, 70.75]
    draw_borderless_chart(buf, 374, 56, 186, 126, "SOL 15M", sol_closes, 72.40, "ENTRY")
    save_png(buf, out_dir / "g2_feed_preview.png")

    # Screen 2: Price Alert Hit -> Structure Break -> 1-Tap Short with Auto SL / 2R TP
    buf2 = make_canvas()
    draw_text(buf2, 16, 14, "ALERT HIT - NEAR-PERP - PAPER", dim, scale=1)
    draw_text(buf2, 16, 48, "NEAR  $4.19  -1.8%", bright, scale=2)
    draw_text(buf2, 16, 76, "STRUCTURE BREAK $4.20", mid, scale=2)
    draw_text(buf2, 16, 128, "> SHORT $250 SL+1.5% 2R", bright, scale=2)
    draw_text(buf2, 16, 158, "  LONG  $250 SL-1.5% 2R", mid, scale=2)
    draw_text(buf2, 16, 188, "  DISMISS ALERT", mid, scale=2)
    draw_text(buf2, 16, 260, "SWIPE PICK - TAP EXECUTE - DBL EXIT", dim, scale=1)

    near_closes = [4.28, 4.30, 4.31, 4.29, 4.26, 4.27, 4.25, 4.23, 4.24, 4.22, 4.21, 4.22, 4.20, 4.18, 4.19]
    draw_borderless_chart(buf2, 374, 56, 186, 126, "NEAR 15M", near_closes, 4.20, "ALERT")
    save_png(buf2, out_dir / "g2_alert_entry.png")


if __name__ == "__main__":
    art_dir = Path(__file__).resolve().parent.parent / "artifacts"
    render_screens(art_dir)
    for fn in ("g2_feed_preview.png", "g2_alert_entry.png"):
        p = art_dir / fn
        print(f"Rendered {p} ({p.stat().st_size} bytes)")

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
    'P': ["11110","10001","10001","11110","10000","10000","00000"],
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
    ',': ["00000","00000","00000","00000","00100","00100","01000"],
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


def fill_rect(buf, x, y, w, h, rgb):
    for dy in range(h):
        for dx in range(w):
            set_px(buf, x + dx, y + dy, rgb)


def stroke_rect(buf, x, y, w, h, rgb):
    for dx in range(w):
        set_px(buf, x + dx, y, rgb)
        set_px(buf, x + dx, y + h - 1, rgb)
    for dy in range(h):
        set_px(buf, x, y + dy, rgb)
        set_px(buf, x + w - 1, y + dy, rgb)


def draw_text(buf, x, y, text, rgb, scale=2):
    cx = x
    for ch in text.upper():
        g = FONT.get(ch, FONT[' '])
        for r_i, row in enumerate(g):
            for c_i, bit in enumerate(row):
                if bit == '1':
                    for sy in range(scale):
                        for sx in range(scale):
                            set_px(buf, cx + c_i * scale + sx, y + r_i * scale + sy, rgb)
        cx += 6 * scale


def draw_candles(buf, cx, cy, cw, ch, title, bars, levels):
    bright = (69, 255, 152)
    bear = (37, 168, 94)
    soft = (27, 122, 68)

    draw_text(buf, cx + 4, cy + 2, title, soft, scale=1)

    highs = [b[1] for b in bars] + [lv[0] for lv in levels]
    lows = [b[2] for b in bars] + [lv[0] for lv in levels]
    rmax, rmin = max(highs), min(lows)
    padv = (rmax - rmin or 1.0) * 0.08
    mx, mn = rmax + padv, rmin - padv
    span = mx - mn or 1.0

    pad_l, pad_r, pad_t, pad_b = 4, 34, 18, 16
    pw, ph = cw - pad_l - pad_r, ch - pad_t - pad_b

    def to_y(v):
        return int(round(cy + pad_t + (1.0 - (v - mn) / span) * ph))

    slot_w = pw / len(bars)
    body_w = max(4, min(7, int(slot_w - 3)))

    for i, (o, h, l, c) in enumerate(bars):
        xmid = int(round(cx + pad_l + i * slot_w + slot_w / 2))
        yh, yl, yo, yc = to_y(h), to_y(l), to_y(o), to_y(c)
        top, bot = min(yo, yc), max(yo, yc)
        bh = max(2, bot - top)
        bull = c >= o

        for py in range(yh, yl + 1):
            set_px(buf, xmid, py, bright if bull else bear)

        bx = xmid - body_w // 2
        if bull:
            fill_rect(buf, bx, top, body_w, bh, (0, 0, 0))
            stroke_rect(buf, bx, top, body_w, bh, bright)
        else:
            fill_rect(buf, bx, top, body_w, bh, bear)

    for price, label, emph in levels:
        ly = to_y(price)
        col = bright if emph else soft
        step = 7 if emph else 6
        dash = 4 if emph else 2
        for dx in range(0, pw, step):
            for k in range(dash):
                if dx + k < pw:
                    set_px(buf, cx + pad_l + dx + k, ly, col)
        draw_text(buf, cx + pad_l + pw + 3, max(cy + 14, min(cy + ch - 22, ly - 3)), label, col, scale=1)

    draw_text(buf, cx + 4, cy + ch - 11, f"{rmin:.1f} - {rmax:.1f}", soft, scale=1)


def save_png(buf, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = bytearray()
    stride = W * 3
    for y in range(H):
        raw.append(0)
        raw.extend(buf[y * stride : (y + 1) * stride])

    def chunk(ct, data):
        return struct.pack(">I", len(data)) + ct + data + struct.pack(">I", zlib.crc32(ct + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def render_v4(out_dir: Path):
    bright = (69, 255, 152)
    mid = (37, 168, 94)
    dim = (22, 108, 60)

    # Realistic 16 OHLC 15m ETH bars (o, h, l, c)
    eth_bars = [
        (1712, 1718, 1709, 1716),
        (1716, 1725, 1715, 1724),
        (1724, 1732, 1722, 1730),
        (1730, 1734, 1726, 1727),
        (1727, 1731, 1721, 1722),
        (1722, 1726, 1719, 1725),
        (1725, 1733, 1724, 1731),
        (1731, 1735, 1727, 1728),
        (1728, 1730, 1720, 1721),
        (1721, 1724, 1716, 1718),
        (1718, 1723, 1717, 1722),
        (1722, 1726, 1720, 1725),
        (1725, 1728, 1721, 1723),
        (1723, 1727, 1720, 1726),
        (1726, 1728, 1722, 1724),
        (1724, 1726, 1721, 1724.9),
    ]

    # Screen 1: Interactive SL/TP on live OHLC Candlesticks ($35 x 10x)
    buf = make_canvas()
    draw_text(buf, 16, 12, "3/4 TAKE PROFIT - ETH SHORT", dim, scale=1)
    draw_text(buf, 16, 48, "SL $1,738.0 (-$2.65)", mid, scale=2)
    draw_text(buf, 16, 78, "> TP $1,692.0 (1.9%)", bright, scale=2)
    draw_text(buf, 16, 130, "GAIN +$6.68", bright, scale=2)
    draw_text(buf, 16, 160, "REWARD 2.52R ($35 X 10X)", mid, scale=2)
    draw_text(buf, 16, 260, "SWIPE MOVE TP - TAP REVIEW - DBL BACK", dim, scale=1)
    draw_candles(
        buf, 344, 52, 220, 142, "ETH 15M", eth_bars,
        [(1738.0, "SL", False), (1724.9, "IN", False), (1692.0, "TP", True)]
    )
    save_png(buf, out_dir / "g2_feed_preview.png")

    # Screen 2: 1.5R Break-Even Prompt on OHLC Candlesticks
    buf2 = make_canvas()
    draw_text(buf2, 16, 12, "1.5R REACHED - ETH SHORT", dim, scale=1)
    draw_text(buf2, 16, 48, "ETH SHORT +1.55R", bright, scale=2)
    draw_text(buf2, 16, 76, "$1,704.5 (IN $1,724.9)", mid, scale=2)
    draw_text(buf2, 16, 128, "> MOVE STOP TO BE", bright, scale=2)
    draw_text(buf2, 16, 158, "  TAKE 50% (+$2.07)", mid, scale=2)
    draw_text(buf2, 16, 188, "  CLOSE ALL (+$4.14)", mid, scale=2)
    draw_text(buf2, 16, 260, "SWIPE PICK - TAP ACT - DBL EXIT", dim, scale=1)
    draw_candles(
        buf2, 344, 52, 220, 142, "ETH 15M", eth_bars,
        [(1724.9, "IN", True), (1738.0, "SL", False)]
    )
    save_png(buf2, out_dir / "g2_alert_entry.png")


if __name__ == "__main__":
    art_dir = Path(__file__).resolve().parent.parent / "artifacts"
    render_v4(art_dir)
    for fn in ("g2_feed_preview.png", "g2_alert_entry.png"):
        p = art_dir / fn
        print(f"Rendered {p} ({p.stat().st_size} bytes)")

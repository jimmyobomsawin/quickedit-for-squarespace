"""Generate toolbar icons + macOS AppIcon for QuickEdit for Squarespace.

Outputs:
  extension/icons/icon-{16,32,48,128}.png      (browser toolbar)
  safari/Assets.xcassets/AppIcon.appiconset/   (macOS app shell — 16/32/128/256/512 @1x and @2x + Contents.json)

Run: python3 make_icons.py
"""
from PIL import Image, ImageDraw, ImageFont
import math, os, json

REPO = os.path.dirname(os.path.abspath(__file__))
EXT_ICONS = os.path.join(REPO, "extension", "icons")
SAFARI_APP_DIR = os.path.join(REPO, "safari", "QuickEdit for Squarespace")
APPICON_DIR = os.path.join(SAFARI_APP_DIR, "Assets.xcassets", "AppIcon.appiconset")
SAFARI_WEB_ICON = os.path.join(SAFARI_APP_DIR, "Resources", "Icon.png")  # shown in the app shell window

# Pencil palette
PENCIL_BODY = (250, 204, 21, 255)
PENCIL_TIP = (24, 24, 27, 255)
ERASER = (244, 67, 54, 255)
STROKE = (24, 24, 27, 255)

# "SQ" backdrop
SQ_COLOR = (40, 40, 44, 255)

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
]


def find_font_path():
    for c in FONT_CANDIDATES:
        if os.path.exists(c):
            return c
    return None


FONT_PATH = find_font_path()


def draw_sq(draw, size):
    text = "SQ"
    if not FONT_PATH:
        font = ImageFont.load_default()
    else:
        font_size = size
        while font_size > 4:
            font = ImageFont.truetype(FONT_PATH, font_size)
            bbox = draw.textbbox((0, 0), text, font=font)
            w = bbox[2] - bbox[0]
            h = bbox[3] - bbox[1]
            if w <= size * 0.98 and h <= size * 0.98:
                break
            font_size -= 1
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (size - w) // 2 - bbox[0]
    y = (size - h) // 2 - bbox[1]
    draw.text((x, y), text, fill=SQ_COLOR, font=font)


def draw_pencil(draw, size):
    pad = max(1, size // 12)
    tip = (size - pad, pad)
    end = (pad, size - pad)
    width = max(2, int(size * 0.22))
    dx, dy = end[0] - tip[0], end[1] - tip[1]
    L = math.hypot(dx, dy)
    px, py = -dy / L * (width / 2), dx / L * (width / 2)

    def lerp(a, b, t):
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

    p_tip = tip
    p_woodEnd = lerp(tip, end, 0.16)
    p_bodyEnd = lerp(tip, end, 0.82)
    p_eraser = end

    def quad(a, b, fill):
        poly = [
            (a[0] + px, a[1] + py),
            (a[0] - px, a[1] - py),
            (b[0] - px, b[1] - py),
            (b[0] + px, b[1] + py),
        ]
        draw.polygon(poly, fill=fill, outline=STROKE)

    tri = [
        p_tip,
        (p_woodEnd[0] + px, p_woodEnd[1] + py),
        (p_woodEnd[0] - px, p_woodEnd[1] - py),
    ]
    draw.polygon(tri, fill=PENCIL_TIP, outline=STROKE)
    quad(p_woodEnd, p_bodyEnd, PENCIL_BODY)
    quad(p_bodyEnd, p_eraser, ERASER)


def make_browser_icon(size, with_backdrop=True):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if with_backdrop:
        draw_sq(draw, size)
    draw_pencil(draw, size)
    return img


def make_app_icon(size):
    # macOS app icons sit inside a rounded square. Apple's HIG: corner radius ~22.5%.
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = int(size * 0.225)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=(245, 245, 247, 255))

    inset = int(size * 0.10)
    inner_size = size - 2 * inset
    inner = Image.new("RGBA", (inner_size, inner_size), (0, 0, 0, 0))
    inner_draw = ImageDraw.Draw(inner)
    draw_sq(inner_draw, inner_size)
    draw_pencil(inner_draw, inner_size)
    img.paste(inner, (inset, inset), inner)
    return img


def write_browser_icons():
    os.makedirs(EXT_ICONS, exist_ok=True)
    for s in (16, 32, 48, 128):
        make_browser_icon(s).save(os.path.join(EXT_ICONS, f"icon-{s}.png"))
    print("wrote browser icons to", EXT_ICONS)


# macOS AppIcon set — matches the naming convention safari-web-extension-converter
# generated for the AppIcon.appiconset (Contents.json already references these names).
APP_ICON_VARIANTS = [
    ("mac-icon-16@1x.png", 16, 1),
    ("mac-icon-16@2x.png", 16, 2),
    ("mac-icon-32@1x.png", 32, 1),
    ("mac-icon-32@2x.png", 32, 2),
    ("mac-icon-128@1x.png", 128, 1),
    ("mac-icon-128@2x.png", 128, 2),
    ("mac-icon-256@1x.png", 256, 1),
    ("mac-icon-256@2x.png", 256, 2),
    ("mac-icon-512@1x.png", 512, 1),
    ("mac-icon-512@2x.png", 512, 2),
]


def write_app_icon_set():
    # Only run if Safari project exists. The converter generates the Contents.json
    # at scaffold time; we just overwrite the PNGs (filenames already match).
    if not os.path.isdir(APPICON_DIR):
        print(f"  (skipping AppIcon — {APPICON_DIR} not found, run safari-web-extension-converter first)")
        return
    for fname, pt, scale in APP_ICON_VARIANTS:
        px = pt * scale
        make_app_icon(px).save(os.path.join(APPICON_DIR, fname))
    print("wrote macOS AppIcon set to", APPICON_DIR)


def write_safari_web_icon():
    if not os.path.isdir(os.path.dirname(SAFARI_WEB_ICON)):
        return
    # 128px icon used inside the app shell window (Main.html references ../Icon.png).
    make_app_icon(128).save(SAFARI_WEB_ICON)
    print("wrote app shell window icon to", SAFARI_WEB_ICON)


if __name__ == "__main__":
    write_browser_icons()
    write_app_icon_set()
    write_safari_web_icon()

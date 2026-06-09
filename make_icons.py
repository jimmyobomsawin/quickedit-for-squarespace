"""Generate toolbar icons + macOS AppIcon for QuickEdit for Squarespace.

Single source of truth: the **landing-page logo** (landing-page/index.html) — a
detailed yellow #2 pencil (red eraser → metal ferrule → yellow body → wood cone
→ graphite tip) rotated 45° over a bold "SQ", on a soft rounded-square tile.
This script reproduces that exact mark so every surface matches the landing page.

Outputs:
  extension/icons/icon-{16,32,48,128}.png      (browser toolbar)
  safari/Assets.xcassets/AppIcon.appiconset/   (macOS app shell — 16/32/128/256/512 @1x and @2x)
  safari/.../Resources/Icon.png                (app shell window)

Run: python3 make_icons.py
(Then `./scripts/sync-extension.sh` to copy the toolbar icons into the Safari extension.)
"""
from PIL import Image, ImageDraw, ImageFont, ImageChops
import os

REPO = os.path.dirname(os.path.abspath(__file__))
EXT_ICONS = os.path.join(REPO, "extension", "icons")
SAFARI_APP_DIR = os.path.join(REPO, "safari", "QuickEdit for Squarespace")
APPICON_DIR = os.path.join(SAFARI_APP_DIR, "Assets.xcassets", "AppIcon.appiconset")
SAFARI_WEB_ICON = os.path.join(SAFARI_APP_DIR, "Resources", "Icon.png")  # shown in the app shell window

# ---- Landing-page logo palette (exact hex values from landing-page/index.html) ----
TILE_BG = (245, 245, 247, 255)   # --qe-soft  #f5f5f7  (rounded-square background)
SQ_COLOR = (42, 42, 46, 255)     # logo ::before color  #2a2a2e
ERASER = (244, 67, 54, 255)      # #f44336
FERRULE = (156, 163, 175, 255)   # #9ca3af  (metal band)
BODY = (250, 204, 21, 255)       # #facc15  (yellow body)
WOOD = (233, 196, 106, 255)      # #e9c46a  (wood cone)
TIP = (168, 162, 158, 255)       # #a8a29e  (graphite tip)
STROKE = (17, 17, 17, 255)       # #111

TILE_RADIUS_FRAC = 0.225         # 36/160 — also Apple's HIG corner radius
SQ_HEIGHT_FRAC = 0.46            # cap height ≈ landing page's 96px in a 160px box

# Pencil geometry in the SVG's 100-unit viewBox (drawn vertical, rotated at render).
PENCIL_STROKE_W = 1.4            # stroke-width in 100-unit space
PENCIL_ROTATE = 45               # SVG rotate(45 50 50) — clockwise

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


def _fit_sq_font(text, target_h, max_w):
    """Largest font whose rendered bbox fits within target_h AND max_w."""
    if not FONT_PATH:
        return ImageFont.load_default()
    scratch = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    chosen = 4
    for s in range(4, int(target_h * 3) + 2):
        f = ImageFont.truetype(FONT_PATH, s)
        b = scratch.textbbox((0, 0), text, font=f)
        w, h = b[2] - b[0], b[3] - b[1]
        if h <= target_h and w <= max_w:
            chosen = s
        else:
            break
    return ImageFont.truetype(FONT_PATH, chosen)


def draw_sq(draw, S):
    text = "SQ"
    font = _fit_sq_font(text, SQ_HEIGHT_FRAC * S, 0.92 * S)
    b = draw.textbbox((0, 0), text, font=font)
    w, h = b[2] - b[0], b[3] - b[1]
    x = (S - w) / 2 - b[0]
    y = (S - h) / 2 - b[1]
    draw.text((x, y), text, fill=SQ_COLOR, font=font)


def _render_pencil_layer(S):
    """Detailed #2 pencil from the landing-page SVG, drawn on its own SxS layer
    and rotated 45° clockwise about center (matches SVG rotate(45 50 50))."""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    k = S / 100.0  # 100-unit viewBox → canvas px
    sw = max(1, round(PENCIL_STROKE_W * k))

    def P(x, y):
        return (x * k, y * k)

    # (fill, x, y, w, h) — top→down: eraser, ferrule, body
    rects = [
        (ERASER, 44, 14, 12, 9.0),
        (FERRULE, 44, 23, 12, 2.5),
        (BODY, 44, 25.5, 12, 47.0),
    ]
    # (fill, [points]) — wood cone then graphite tip
    polys = [
        (WOOD, [(44, 72.5), (56, 72.5), (54, 82), (46, 82)]),
        (TIP, [(46, 82), (54, 82), (50, 90)]),
    ]

    # Fills first.
    for fill, x, y, w, h in rects:
        d.rectangle([P(x, y), P(x + w, y + h)], fill=fill)
    for fill, pts in polys:
        d.polygon([P(*p) for p in pts], fill=fill)

    # Then stroke each shape separately so the internal dividers show (as in the SVG).
    def stroke_closed(points):
        pts = [P(*p) for p in points]
        d.line(pts + [pts[0]], fill=STROKE, width=sw, joint="curve")

    for _, x, y, w, h in rects:
        stroke_closed([(x, y), (x + w, y), (x + w, y + h), (x, y + h)])
    for _, pts in polys:
        stroke_closed(pts)

    # PIL rotates CCW for positive angles; SVG rotate(45) is clockwise → use -45.
    return layer.rotate(-PENCIL_ROTATE, resample=Image.BICUBIC, center=(S / 2, S / 2), expand=False)


def render_logo(size, supersample=8):
    """The landing-page logo at `size` px: soft rounded tile + SQ + rotated pencil."""
    S = size * supersample
    r = round(size * TILE_RADIUS_FRAC) * supersample

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=TILE_BG)
    draw_sq(d, S)

    pencil = _render_pencil_layer(S)

    # Subtle drop-shadow: landing page uses drop-shadow(-1.5px 1.5px 0 / 6% black)
    # relative to the 160px logo; scale the offset to this size.
    k_box = (size / 160.0) * supersample
    dx, dy = round(-1.5 * k_box), round(1.5 * k_box)
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    blk = Image.new("RGBA", (S, S), (0, 0, 0, 255))
    blk.putalpha(pencil.split()[3].point(lambda a: int(a * 0.06)))
    shadow.paste(blk, (dx, dy), blk)

    img = Image.alpha_composite(img, shadow)
    img = Image.alpha_composite(img, pencil)

    # Clip to the rounded tile (matches the landing page's overflow:hidden) so the
    # rotated pencil never poked past the corners.
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=255)
    img.putalpha(ImageChops.multiply(img.split()[3], mask))

    return img.resize((size, size), Image.LANCZOS)


def write_browser_icons():
    os.makedirs(EXT_ICONS, exist_ok=True)
    for s in (16, 32, 48, 128):
        render_logo(s).save(os.path.join(EXT_ICONS, f"icon-{s}.png"))
    print("wrote browser icons to", EXT_ICONS)


# macOS AppIcon set — names match what safari-web-extension-converter scaffolded
# into Contents.json (we only overwrite the PNGs).
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
    if not os.path.isdir(APPICON_DIR):
        print(f"  (skipping AppIcon — {APPICON_DIR} not found, run safari-web-extension-converter first)")
        return
    for fname, pt, scale in APP_ICON_VARIANTS:
        render_logo(pt * scale).save(os.path.join(APPICON_DIR, fname))
    print("wrote macOS AppIcon set to", APPICON_DIR)


def write_safari_web_icon():
    if not os.path.isdir(os.path.dirname(SAFARI_WEB_ICON)):
        return
    # 128px icon shown inside the app shell window (Main.html references ../Icon.png).
    render_logo(128).save(SAFARI_WEB_ICON)
    print("wrote app shell window icon to", SAFARI_WEB_ICON)


if __name__ == "__main__":
    write_browser_icons()
    write_app_icon_set()
    write_safari_web_icon()

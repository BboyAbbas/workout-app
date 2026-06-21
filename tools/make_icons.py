"""Generate the Workout app icons (minimal dumbbell glyph).

Flat geometric mark -> crisp PNGs at every size the PWA manifest needs.
Re-run any time to regenerate: python tools/make_icons.py
"""
from PIL import Image, ImageDraw

BG = (52, 211, 153, 255)    # emerald accent  #34d399
FG = (15, 17, 21, 255)      # near-black       #0f1115
OUT = __file__.replace("tools\\make_icons.py", "icons").replace("tools/make_icons.py", "icons")

SS = 4  # supersample factor for smooth edges


def dumbbell(draw, S, scale):
    """Draw a centered dumbbell of total width S*scale."""
    cx = cy = S / 2
    W = S * scale
    x_left, x_right = cx - W / 2, cx + W / 2
    weight_w = W * 0.22
    weight_h = W * 0.54
    bar_h = W * 0.14

    wr = weight_w * 0.30  # weight corner radius
    # connecting bar
    draw.rounded_rectangle(
        [x_left + weight_w * 0.7, cy - bar_h / 2, x_right - weight_w * 0.7, cy + bar_h / 2],
        radius=bar_h / 2, fill=FG)
    # left + right weights
    draw.rounded_rectangle(
        [x_left, cy - weight_h / 2, x_left + weight_w, cy + weight_h / 2],
        radius=wr, fill=FG)
    draw.rounded_rectangle(
        [x_right - weight_w, cy - weight_h / 2, x_right, cy + weight_h / 2],
        radius=wr, fill=FG)


def make(path, size, scale, rounded):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.22, fill=BG)
    else:
        d.rectangle([0, 0, S, S], fill=BG)  # full bleed for maskable
    dumbbell(d, S, scale)
    img = img.resize((size, size), Image.LANCZOS)
    img.save(path)
    print("wrote", path)


if __name__ == "__main__":
    import os
    os.makedirs(OUT, exist_ok=True)
    make(os.path.join(OUT, "icon-192.png"), 192, 0.60, rounded=True)
    make(os.path.join(OUT, "icon-512.png"), 512, 0.60, rounded=True)
    # maskable: full-bleed bg + smaller glyph inside the safe zone
    make(os.path.join(OUT, "icon-maskable-512.png"), 512, 0.50, rounded=False)

"""Generate the pi-mcp-adapter-desktop plugin icon (256x256, editorial screenprint style).

No text, flat color blocks, deep indigo ink outline, paper grain texture —
consistent with the other packages/plugins icons.
"""
from PIL import Image, ImageDraw, ImageFilter
import random

SIZE = 256
PAPER = (246, 241, 232)
INDIGO = (39, 37, 74)
CORAL = (233, 84, 74)
MUSTARD = (240, 180, 41)
TEAL = (28, 145, 132)


def rounded_rect(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def main():
    img = Image.new("RGB", (SIZE, SIZE), PAPER)
    draw = ImageDraw.Draw(img)

    # --- Server node: indigo square on the left (MCP server / config) ---
    node_box = (34, 78, 118, 162)
    rounded_rect(draw, node_box, 18, fill=PAPER, outline=INDIGO, width=8)
    for i, y in enumerate((96, 128, 160)):
        pass
    # inner "plug" slots: three small rectangles inside the node
    for i, (x0, x1) in enumerate(((48, 66), (74, 92), (100, 104))):
        rounded_rect(draw, (x0, 118 - 8 + i * 14, x1, 118 - 8 + i * 14 + 8), 3, fill=INDIGO, width=0)

    # --- Tool socket: coral circle on the right (registered MCP tools) ---
    cx, cy, r = 196, 120, 34
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=CORAL, outline=INDIGO, width=8)
    draw.ellipse((cx - 12, cy - 12, cx + 12, cy + 12), fill=PAPER, outline=INDIGO, width=6)

    # --- Connection: bold mustard curve linking node and socket ---
    draw.line((118, 104, 152, 96), fill=INDIGO, width=22)
    draw.line((152, 96, 166, 120), fill=INDIGO, width=22)
    draw.arc((128, 84, 210, 168), start=200, end=330, fill=MUSTARD, width=16)
    # re-draw a short stroke so the arc looks intentional
    draw.arc((128, 84, 210, 168), start=240, end=310, fill=MUSTARD, width=16)

    # --- Dot terminals (teal) on the curve ---
    for (px, py) in ((140, 100), (168, 150)):
        draw.ellipse((px - 9, py - 9, px + 9, py + 9), fill=TEAL, outline=INDIGO, width=5)

    # --- Bottom accent: paper-grain noise + soft vignette ---
    rng = random.Random(42)
    noise = Image.new("L", (SIZE, SIZE), 0)
    nd = ImageDraw.Draw(noise)
    for _ in range(900):
        x, y = rng.randint(0, SIZE - 1), rng.randint(0, SIZE - 1)
        v = rng.randint(6, 18)
        nd.ellipse((x, y, x + 1, y + 1), fill=v)
    noise = noise.filter(ImageFilter.GaussianBlur(0.6))
    grain = Image.new("RGB", (SIZE, SIZE), PAPER)
    grain = Image.composite(Image.new("RGB", (SIZE, SIZE), (222, 214, 200)), grain, noise)
    img = Image.blend(img, grain, 0.5)

    # faint paper edge
    draw = ImageDraw.Draw(img)
    draw.rectangle((2, 2, SIZE - 3, SIZE - 3), outline=(205, 196, 178), width=2)

    img.save("assets/icon.png")
    print("written assets/icon.png", img.size)


if __name__ == "__main__":
    main()
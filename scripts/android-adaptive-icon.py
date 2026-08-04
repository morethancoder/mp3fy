#!/usr/bin/env -S uv run --quiet --with pillow python3
"""Rebuild the Android adaptive launcher icon from src-tauri/app-icon.png.

`tauri icon` writes the whole artwork — plum plate and all — as the adaptive
foreground, but Android crops adaptive foregrounds to the centre ~67% and
supplies its own mask. The plate's corners get cut off and the note renders
zoomed in. So split the artwork the way the format wants: the white note alone
as the foreground, inset to the safe zone, over a plum gradient background.

Run after any `pnpm tauri icon` — that command overwrites both.
"""

import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src-tauri/app-icon.png"
RES = ROOT / "src-tauri/gen/android/app/src/main/res"

# Android shows the middle 72dp of a 108dp adaptive foreground; only the inner
# 66dp is guaranteed. Scaling by 72/108 keeps the note at the size it has in
# the desktop icon once the launcher's mask has taken its bite.
VISIBLE = 72 / 108
DENSITIES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
# The note is pure white on saturated plum: the darkest channel separates them.
WHITE_FLOOR = 130


def note_layer(icon: Image.Image) -> Image.Image:
    """White artwork on transparency, keyed out of the plum plate."""
    width, height = icon.size
    layer = Image.new("RGBA", icon.size, (255, 255, 255, 0))
    src = icon.load()
    dst = layer.load()
    for y in range(height):
        for x in range(width):
            r, g, b, a = src[x, y]
            keyed = (min(r, g, b) - WHITE_FLOOR) / (255 - WHITE_FLOOR)
            alpha = round(max(0.0, min(1.0, keyed)) * a)
            if alpha:
                dst[x, y] = (255, 255, 255, alpha)
    return layer


def plate_colors(icon: Image.Image) -> tuple[str, str]:
    """Top and bottom of the plate's gradient, sampled clear of the note."""
    width, height = icon.size
    pixels = icon.load()
    top = pixels[width // 2, round(height * 0.04)]
    bottom = pixels[width // 2, round(height * 0.96)]
    return tuple("#%02x%02x%02x" % px[:3] for px in (top, bottom))


def write_foregrounds(layer: Image.Image) -> None:
    for density, size in DENSITIES.items():
        inset = round(size * VISIBLE)
        canvas = Image.new("RGBA", (size, size), (255, 255, 255, 0))
        offset = (size - inset) // 2
        canvas.paste(layer.resize((inset, inset), Image.LANCZOS), (offset, offset))
        canvas.save(RES / f"mipmap-{density}/ic_launcher_foreground.png")


def write_background(start: str, end: str) -> None:
    ns = "http://schemas.android.com/apk/res/android"
    aapt = "http://schemas.android.com/aapt"
    ET.register_namespace("android", ns)
    ET.register_namespace("aapt", aapt)

    vector = ET.Element("vector", {f"{{{ns}}}{k}": v for k, v in {
        "width": "108dp", "height": "108dp",
        "viewportWidth": "108", "viewportHeight": "108",
    }.items()})
    path = ET.SubElement(vector, "path", {f"{{{ns}}}pathData": "M0,0h108v108h-108z"})
    fill = ET.SubElement(path, f"{{{aapt}}}attr", {"name": "android:fillColor"})
    ET.SubElement(fill, "gradient", {f"{{{ns}}}{k}": v for k, v in {
        "type": "linear",
        "startX": "54", "startY": "0", "endX": "54", "endY": "108",
        "startColor": start, "endColor": end,
    }.items()})

    ET.indent(vector, space="    ")
    # Not ic_launcher_background: `tauri icon` owns that name as a @color, and
    # one name per resource type keeps the two from being mistaken for each other.
    target = RES / "drawable/ic_launcher_plate.xml"
    target.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        + ET.tostring(vector, encoding="unicode")
        + "\n"
    )
    return target


def main() -> None:
    icon = Image.open(SOURCE).convert("RGBA")
    start, end = plate_colors(icon)
    write_foregrounds(note_layer(icon))
    write_background(start, end)

    adaptive = RES / "mipmap-anydpi-v26/ic_launcher.xml"
    adaptive.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
        '    <background android:drawable="@drawable/ic_launcher_plate" />\n'
        "</adaptive-icon>\n"
    )
    print(f"plate gradient {start} -> {end}")
    print(f"foregrounds inset to {VISIBLE:.0%} at {', '.join(DENSITIES)}")


if __name__ == "__main__":
    main()

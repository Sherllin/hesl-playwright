"""Compare text-line geometry of actual preview/PDF rasters; ignore pale watermarks."""
import json
import sys
from PIL import Image, ImageChops


def line_bands(path, colored_text=False):
    source = Image.open(path).convert("RGBA")
    image = Image.new("RGBA", source.size, "white")
    image.alpha_composite(source)
    mask = image.convert("L").point(lambda value: 255 if value < 100 else 0)
    if colored_text:
        red, green, blue = image.convert("RGB").split()
        minimum = ImageChops.darker(ImageChops.darker(red, green), blue)
        maximum = ImageChops.lighter(ImageChops.lighter(red, green), blue)
        saturated = ImageChops.subtract(maximum, minimum).point(lambda value: 255 if value > 80 else 0)
        dark_channel = minimum.point(lambda value: 255 if value < 100 else 0)
        mask = ImageChops.lighter(mask, ImageChops.multiply(saturated, dark_channel))
    width, height = mask.size
    bands = []
    active = None
    for y in range(height):
        row = mask.crop((0, y, width, y + 1))
        box = row.getbbox()
        if not box or row.histogram()[255] < 8:
            continue
        if active is not None and y - active[3] <= 3:
            active = [min(active[0], box[0]), active[1], max(active[2], box[2]), y]
        else:
            if active is not None:
                bands.append(active)
            active = [box[0], y, box[2], y]
    if active is not None:
        bands.append(active)
    bands = [band for band in bands if band[3] - band[1] >= 3 and band[2] - band[0] > width * 0.03]
    return [[value / (width if index % 2 == 0 else height) for index, value in enumerate(band)] for band in bands]


def compare(preview, pdf, colored_text=False):
    left, right = line_bands(preview, colored_text), line_bands(pdf, colored_text)
    delta = max((abs(a - b) for before, after in zip(left, right) for a, b in zip(before, after)), default=0)
    return {"previewBands": left, "pdfBands": right, "maxDelta": delta}


if __name__ == "__main__":
    print(json.dumps(compare(sys.argv[1], sys.argv[2], "--colored-text" in sys.argv[3:])))

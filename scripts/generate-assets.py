# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Leon
"""Draw replacement PNGs from geometry only, using the Python standard library."""
from pathlib import Path
import hashlib
import json
import math
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
BG = (44, 54, 84, 255)
FG = (235, 238, 255, 255)


class Canvas:
    def __init__(self, size):
        self.size = size
        self.pixels = bytearray(size * size * 4)

    def paint(self, bounds, predicate, color):
        scale = self.size / 24
        x0, y0, x1, y1 = bounds
        for y in range(max(0, int(y0 * scale)), min(self.size, math.ceil(y1 * scale))):
            for x in range(
                max(0, int(x0 * scale)), min(self.size, math.ceil(x1 * scale))
            ):
                if predicate((x + 0.5) / scale, (y + 0.5) / scale):
                    i = (y * self.size + x) * 4
                    self.pixels[i : i + 4] = bytes(color)

    def circle(self, x, y, r, color=FG, inner=0):
        self.paint(
            (x - r, y - r, x + r, y + r),
            lambda a, b: inner * inner <= (a - x) ** 2 + (b - y) ** 2 <= r * r,
            color,
        )

    def polygon(self, points, color=FG):
        def inside(x, y):
            result = False
            for (ax, ay), (bx, by) in zip(points, points[1:] + points[:1]):
                if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                    result = not result
            return result

        xs, ys = zip(*points)
        self.paint((min(xs), min(ys), max(xs), max(ys)), inside, color)

    def rect(self, x, y, w, h, color=FG):
        self.polygon([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], color)

    def line(self, a, b, width=1.6, color=FG):
        ax, ay = a
        bx, by = b
        dx = bx - ax
        dy = by - ay
        length = dx * dx + dy * dy

        def hit(x, y):
            t = (
                max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / length))
                if length
                else 0
            )
            return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= (width / 2) ** 2

        pad = width / 2
        self.paint(
            (
                min(ax, bx) - pad,
                min(ay, by) - pad,
                max(ax, bx) + pad,
                max(ay, by) + pad,
            ),
            hit,
            color,
        )

    def png(self):
        def chunk(tag, data):
            return (
                struct.pack(">I", len(data))
                + tag
                + data
                + struct.pack(">I", zlib.crc32(tag + data))
            )

        stride = self.size * 4
        raw = b"".join(
            b"\0" + self.pixels[y * stride : (y + 1) * stride] for y in range(self.size)
        )
        return (
            b"\x89PNG\r\n\x1a\n"
            + chunk(
                b"IHDR", struct.pack(">IIBBBBB", self.size, self.size, 8, 6, 0, 0, 0)
            )
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b"")
        )


def icon(name):
    c = Canvas(96)
    c.circle(12, 12, 11.8, BG)
    if name in ["play", "next", "previous", "previous-user"]:
        if name.startswith("previous"):
            c.polygon([(16, 6), (7, 12), (16, 18)])
            c.rect(5, 6, 1.6, 12)
        else:
            c.polygon([(8, 6), (17, 12), (8, 18)])
            if name == "next":
                c.rect(17.5, 6, 1.6, 12)
    elif name == "pause":
        c.rect(7, 6, 3.5, 12)
        c.rect(13.5, 6, 3.5, 12)
    elif name == "stop":
        c.rect(7, 7, 10, 10)
    elif name in ["plus", "minus"]:
        c.line((6, 12), (18, 12), 2)
        if name == "plus":
            c.line((12, 6), (12, 18), 2)
    elif name == "back":
        c.line((17, 12), (6, 12))
        c.line((6, 12), (11, 7))
        c.line((6, 12), (11, 17))
    elif name in ["check", "success"]:
        c.line((6, 12), (10, 16), 2)
        c.line((10, 16), (18, 7), 2)
    elif name in ["delete", "song-delete-system"]:
        c.rect(8, 8, 8, 11)
        c.rect(6.5, 5.5, 11, 1.7)
        c.rect(10, 4, 4, 1.7)
        c.rect(10, 10, 1, 6, BG)
        c.rect(13, 10, 1, 6, BG)
    elif name == "playback-settings":
        for x, y in [(7, 9), (12, 14), (17, 7)]:
            c.line((x, 5), (x, 19), 1)
            c.circle(x, y, 2.2)
    elif name == "info":
        c.circle(12, 7, 1.3)
        c.rect(11, 10, 2, 8)
    elif name == "help":
        c.line((8, 7), (12, 5))
        c.line((12, 5), (16, 8))
        c.line((16, 8), (12, 12))
        c.line((12, 12), (12, 14))
        c.circle(12, 18, 1)
    elif name in ["connection", "tools"]:
        c.line((7, 7), (17, 17), 2.4)
        c.line((17, 7), (7, 17), 2.4)
        for p in [(7, 7), (17, 17), (17, 7), (7, 17)]:
            c.circle(*p, 2.1)
    elif name == "phone":
        c.rect(7, 4, 10, 16)
        c.rect(8.5, 6, 7, 10, BG)
        c.circle(12, 18, 0.8, BG)
    elif name == "minimize":
        c.line((6, 9), (12, 15), 2)
        c.line((12, 15), (18, 9), 2)
    elif name in ["settings", "vibration"]:
        if name == "settings":
            for i in range(8):
                a = i * math.pi / 4
                c.line(
                    (12 + 6 * math.cos(a), 12 + 6 * math.sin(a)),
                    (12 + 8 * math.cos(a), 12 + 8 * math.sin(a)),
                    2.3,
                )
            c.circle(12, 12, 6.5, FG, 3.2)
        else:
            c.rect(9, 7, 6, 10)
            for x in [5, 19]:
                c.line((x, 8), (x - 1, 12))
                c.line((x - 1, 12), (x, 16))
    elif name == "warning":
        c.polygon([(12, 4), (21, 20), (3, 20)])
        c.rect(11, 9, 2, 5, BG)
        c.circle(12, 17, 1, BG)
    elif name == "library":
        c.rect(6, 6, 2, 12)
        c.rect(10, 6, 2, 12)
        c.line((15, 6), (18, 18), 2)
    else:
        raise ValueError(name)
    return c.png()


def generate():
    names = [
        "back",
        "check",
        "connection",
        "delete",
        "help",
        "info",
        "library",
        "minimize",
        "minus",
        "next",
        "pause",
        "phone",
        "play",
        "playback-settings",
        "plus",
        "previous-user",
        "previous",
        "settings",
        "song-delete-system",
        "stop",
        "success",
        "tools",
        "vibration",
        "warning",
    ]
    resources = {f"icons/{name}.png": icon(name) for name in names}
    logo = Canvas(96)
    logo.circle(12, 12, 11.8, BG)
    logo.rect(11, 5, 2, 11)
    logo.polygon([(11, 5), (19, 3.5), (19, 7), (11, 8.5)])
    logo.circle(8.7, 16, 3)
    resources["logo.png"] = logo.png()
    disc = Canvas(384)
    disc.circle(12, 12, 11.8, (29, 32, 43, 255))
    for radius in [4.8, 6.3, 7.8, 9.3, 10.8]:
        disc.circle(12, 12, radius, (62, 68, 86, 255), radius - 0.10)
    disc.line((12, 2), (12, 7), 0.25, (100, 110, 135, 255))
    disc.line((12, 17), (12, 22), 0.25, (100, 110, 135, 255))
    disc.circle(12, 12, 3.6, (136, 151, 210, 255))
    disc.circle(12, 12, 0.7, (29, 32, 43, 255))
    resources["vinyl.png"] = disc.png()
    manifest = []
    for model in ["10", "10p", "9p"]:
        for relative, data in resources.items():
            if model == "10" and relative == "vinyl.png":
                continue
            path = ROOT / model / "rpk/src/common" / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            manifest.append(
                {
                    "path": str(path.relative_to(ROOT)),
                    "width": 384 if relative == "vinyl.png" else 96,
                    "height": 384 if relative == "vinyl.png" else 96,
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
            )
    (ROOT / "docs/generated-assets.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )
    print("Generated", len(manifest), "PNGs without external resources")


if __name__ == "__main__":
    generate()

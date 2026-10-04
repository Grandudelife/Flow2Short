"""Package the standard PNG icon representations into an ICNS container."""
import pathlib
import struct
import sys

root = pathlib.Path(sys.argv[1])
representations = [
    ("icp4", "icon_16x16.png"), ("icp5", "icon_32x32.png"),
    ("icp6", "icon_32x32@2x.png"), ("ic07", "icon_128x128.png"),
    ("ic08", "icon_256x256.png"), ("ic09", "icon_512x512.png"),
    ("ic10", "icon_512x512@2x.png"), ("ic11", "icon_16x16@2x.png"),
    ("ic12", "icon_32x32@2x.png"), ("ic13", "icon_128x128@2x.png"),
    ("ic14", "icon_256x256@2x.png"),
]
chunks = []
for code, filename in representations:
    png = (root / filename).read_bytes()
    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    chunks.append(code.encode("ascii") + struct.pack(">I", len(png) + 8) + png)
payload = b"".join(chunks)
pathlib.Path(sys.argv[2]).write_bytes(b"icns" + struct.pack(">I", len(payload) + 8) + payload)

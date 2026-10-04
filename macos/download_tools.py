"""Download pinned, checksum-verified Apple Silicon FFmpeg tools."""
import hashlib
import pathlib
import sys
import urllib.request
import zipfile

root = pathlib.Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
for name, checksum in [
    ("ffmpeg", "591260c945d0eef150e3bf82b0ef988bd36a9cecc18ff05d6679617159f0a95e"),
    ("ffprobe", "e11c17e8200b3ee4c4c186d245e2b4053f01d56957336c1817fca0b997469106"),
]:
    archive = root / (name + "9arm.zip")
    urllib.request.urlretrieve("https://www.osxexperts.net/" + archive.name, archive)
    with zipfile.ZipFile(archive) as zip_file:
        entry = next(n for n in zip_file.namelist() if pathlib.PurePosixPath(n).name == name and not n.startswith("__MACOSX"))
        binary = zip_file.read(entry)
    if hashlib.sha256(binary).hexdigest() != checksum:
        raise RuntimeError(name + " checksum mismatch; refusing to install")
    destination = root / name
    destination.write_bytes(binary)
    destination.chmod(0o755)
    archive.unlink()

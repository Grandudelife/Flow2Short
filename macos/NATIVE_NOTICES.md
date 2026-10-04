# Native macOS runtime

This private local build uses independent FFmpeg and FFprobe 9.0 executables from
https://www.osxexperts.net/ (downloaded 2026-10-04). They are GPL-enabled static
Apple Silicon builds, dynamically linked only to macOS system frameworks.
The distribution is for the owner's local evaluation, not a public release.

FFmpeg copyright: 2000–2026 the FFmpeg developers.
FFprobe copyright: 2007–2026 the FFmpeg developers.
The binaries report GNU GPL version 2 or later; the license is in
`licenses/GPL-2.0.txt`. These independent executables are invoked through argv,
without a shell. FFmpeg is not linked into the Swift application.

Provider/build recipe: https://www.osxexperts.net/
Upstream source: https://github.com/FFmpeg/FFmpeg/tree/n9.0
Upstream licensing: https://ffmpeg.org/legal.html
The exact binaries' `-buildconf` and `-L` outputs document enabled third-party
libraries and licensing. Before redistributing binaries, obtain the exact
corresponding source and dependency sources/build scripts from the builder,
or build and distribute a reproducible toolchain and its corresponding source.

SHA-256 (before local ad-hoc code signing):
- ffmpeg: 591260c945d0eef150e3bf82b0ef988bd36a9cecc18ff05d6679617159f0a95e
- ffprobe: e11c17e8200b3ee4c4c186d245e2b4053f01d56957336c1817fca0b997469106

The bundled interface and fonts retain their original notices in
THIRD_PARTY_NOTICES.md. The native app does not use the WebAssembly engine.

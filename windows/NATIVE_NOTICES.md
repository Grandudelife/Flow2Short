# Windows desktop runtime

The self-contained Windows host uses Microsoft .NET 10 (MIT-licensed runtime)
and Microsoft.Web.WebView2 SDK 1.0.4258.31. The Evergreen WebView2 Runtime is a
separate Microsoft component; its installation and updates use Microsoft's terms.
Runtime download: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
.NET source: https://github.com/dotnet/runtime
WebView2 SDK/license: https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4258.31

FFmpeg and FFprobe are independent processes, not linked to the C# application.
The bundled x64 GPL-enabled shared build comes from BtbN/FFmpeg-Builds:
https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-03-18-14
Archive: ffmpeg-n9.0.2-22-g46d8f462ee-win64-gpl-shared-9.0.zip
SHA-256: 6b2621d2f833cd94ae56371ce154bd0cab4aa504d802d661431093753a5f031f
FFmpeg source revision: 46d8f462ee on the n9.0 branch.
Build scripts and dependency recipes: https://github.com/BtbN/FFmpeg-Builds
Upstream licensing: https://ffmpeg.org/legal.html

The original provider's license/documentation files are included in
`ffmpeg-notices/`; the executable's exact `-L` and `-buildconf` outputs are retained
as `ffmpeg-license.txt` and `ffmpeg-buildconf.txt`. GPL license texts are in
`licenses/`. This is an evaluation release in the owner's private repository.
Before public redistribution, provide the complete corresponding FFmpeg and
dependency sources/build recipes for the exact distributed tool build.

The original app artwork, interface, fonts and WebAssembly notices remain in
THIRD_PARTY_NOTICES.md. Windows desktop rendering uses native FFmpeg, not WASM.

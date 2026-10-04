param([string]$Destination = "", [string]$Go = "go")
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $Destination) { $Destination = Join-Path $root 'dist/windows' }
$Destination = [IO.Path]::GetFullPath($Destination)
$build = Join-Path $root '.build-windows'
$payload = Join-Path $build 'payload'
New-Item -ItemType Directory -Force $build, $Destination | Out-Null
if (Test-Path $payload) { Remove-Item -Recurse -Force $payload }
New-Item -ItemType Directory $payload | Out-Null

# An immutable build URL and archive hash, never an unverified moving "latest".
$url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-03-18-14/ffmpeg-n9.0.2-22-g46d8f462ee-win64-gpl-shared-9.0.zip'
$expected = '6b2621d2f833cd94ae56371ce154bd0cab4aa504d802d661431093753a5f031f'
$archive = Join-Path $build 'ffmpeg-windows.zip'
if (-not (Test-Path $archive) -or (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    Invoke-WebRequest $url -OutFile $archive
}
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'FFmpeg archive checksum mismatch' }
$expanded = Join-Path $build 'ffmpeg'
if (Test-Path $expanded) { Remove-Item -Recurse -Force $expanded }
Expand-Archive $archive $expanded
$bin = (Get-ChildItem $expanded -Recurse -Filter ffmpeg.exe | Select-Object -First 1).Directory.FullName
if (-not $bin) { throw 'FFmpeg executable not found' }
Copy-Item (Join-Path $bin '*') $payload -Recurse
$provider = Split-Path $bin -Parent
New-Item -ItemType Directory (Join-Path $payload 'ffmpeg-notices') | Out-Null
Get-ChildItem $provider | Where-Object { $_.Name -ne 'bin' } | ForEach-Object { Copy-Item $_.FullName (Join-Path $payload 'ffmpeg-notices') -Recurse }
Copy-Item (Join-Path $root 'app') $payload -Recurse
Copy-Item (Join-Path $root 'licenses') $payload -Recurse
Copy-Item (Join-Path $root 'THIRD_PARTY_NOTICES.md') $payload
Copy-Item (Join-Path $PSScriptRoot 'NATIVE_NOTICES.md') $payload

$previousOS, $previousArch, $previousCGO = $env:GOOS, $env:GOARCH, $env:CGO_ENABLED
try {
    $env:GOOS = 'windows'; $env:GOARCH = 'amd64'; $env:CGO_ENABLED = '0'
    Push-Location (Join-Path $root 'server')
    try {
        & $Go build -trimpath '-ldflags=-s -w' -o (Join-Path $payload 'flow2short-server.exe') .
        if ($LASTEXITCODE -ne 0) { throw 'Go service build failed' }
    } finally { Pop-Location }
} finally { $env:GOOS = $previousOS; $env:GOARCH = $previousArch; $env:CGO_ENABLED = $previousCGO }
& (Join-Path $payload 'ffmpeg.exe') -L 2>&1 | Out-File (Join-Path $payload 'ffmpeg-license.txt') -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg could not start' }
& (Join-Path $payload 'ffmpeg.exe') -buildconf 2>&1 | Out-File (Join-Path $payload 'ffmpeg-buildconf.txt') -Encoding utf8

# Keep the existing app artwork; only create its Windows icon container.
Add-Type -AssemblyName System.Drawing
$image = [Drawing.Image]::FromFile((Join-Path $root 'app/icons/icon-512.png'))
$thumbnail = $image.GetThumbnailImage(256, 256, $null, [IntPtr]::Zero)
$png = [IO.MemoryStream]::new()
$thumbnail.Save($png, [Drawing.Imaging.ImageFormat]::Png)
$icon = [IO.BinaryWriter]::new([IO.File]::Create((Join-Path $build 'AppIcon.ico')))
try {
    $bytes = $png.ToArray()
    $icon.Write([uint16]0); $icon.Write([uint16]1); $icon.Write([uint16]1)
    $icon.Write([byte]0); $icon.Write([byte]0); $icon.Write([byte]0); $icon.Write([byte]0)
    $icon.Write([uint16]1); $icon.Write([uint16]32); $icon.Write([uint32]$bytes.Length); $icon.Write([uint32]22)
    $icon.Write($bytes)
} finally { $icon.Dispose(); $png.Dispose(); $thumbnail.Dispose(); $image.Dispose() }

$zip = Join-Path $build 'payload.zip'
if (Test-Path $zip) { Remove-Item $zip }
[IO.Compression.ZipFile]::CreateFromDirectory($payload, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
[IO.File]::WriteAllText((Join-Path $build 'payload.sha256'), (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant(), [Text.Encoding]::ASCII)
& dotnet publish (Join-Path $PSScriptRoot 'Flow2Short.Windows.csproj') -c Release -r win-x64 --self-contained true -o $Destination
if ($LASTEXITCODE -ne 0) { throw 'Windows desktop build failed' }
if (-not (Test-Path (Join-Path $Destination 'Flow2Short-Windows.exe'))) { throw 'Standalone EXE missing' }
Write-Host "Built standalone EXE: $Destination/Flow2Short-Windows.exe"

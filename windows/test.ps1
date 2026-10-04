param([string]$Executable, [string]$Reports)
$ErrorActionPreference = 'Stop'
$Executable = [IO.Path]::GetFullPath($Executable)
$Reports = [IO.Path]::GetFullPath($Reports)
New-Item -ItemType Directory -Force $Reports | Out-Null
# Test the downloaded-file scenario: no publish-directory sidecars can help it.
$standalone = Join-Path $Reports 'standalone'
New-Item -ItemType Directory -Force $standalone | Out-Null
$isolatedExe = Join-Path $standalone 'Flow2Short-Windows.exe'
Copy-Item $Executable $isolatedExe -Force
$Executable = $isolatedExe
$env:FLOW2SHORT_TEST_DATA = Join-Path $Reports 'isolated-user-data'
function Invoke-Smoke([string]$name) {
    $report = Join-Path $Reports "$name.json"
    $process = Start-Process -FilePath $Executable -ArgumentList @('--smoke-test', "`"$report`"") -PassThru
    if (-not $process.WaitForExit(120000)) {
        & taskkill /PID $process.Id /T /F
        throw 'Desktop smoke test timed out'
    }
    $process.Refresh()
    if (Test-Path $report) { Get-Content $report | Write-Host }
    if ($process.ExitCode -ne 0 -or -not (Test-Path $report)) { throw "Desktop smoke test failed: $name" }
    $result = Get-Content $report -Raw | ConvertFrom-Json
    if (-not $result.success -or -not $result.nativeBridge -or -not $result.blobDownload -or -not $result.persistentStorage) { throw "Desktop verification failed: $name" }
    # The host must shut down its dynamically assigned local service.
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $client.Connect('127.0.0.1', [int]$result.localPort)
        throw 'Local service survived application exit'
    } catch [Net.Sockets.SocketException] { } finally { $client.Dispose() }
    return $result
}
$first = Invoke-Smoke 'first-launch'
$second = Invoke-Smoke 'second-launch'
if (-not $second.restored) { throw 'Editor storage was not restored across launches' }
Write-Host 'Standalone EXE extraction, WebView2 editor, native bridge, Blob download, persistence and shutdown passed.'

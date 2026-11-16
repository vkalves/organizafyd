# PowerShell / tests/installer-smoke.ps1 / Windows PowerShell 5.1+ / real service startup
param([string]$AppDirectory = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
$desktop = $AppDirectory
$companion = $null
$logs = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $logs | Out-Null
try {
    $app = Join-Path $desktop 'Zyon.exe'
    $report = Join-Path $logs 'runtime.json'
    if (-not (Test-Path -LiteralPath $app)) { throw 'This check requires the built desktop executable.' }
    $companion = Start-Process -FilePath $app -WorkingDirectory $desktop -ArgumentList ('--runtime-test --report-to "' + $report + '"') -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $logs 'stdout.txt') -RedirectStandardError (Join-Path $logs 'stderr.txt')
    $retainedHandle = $companion.Handle
    if (-not $companion.WaitForExit(120000)) { throw 'Native desktop runtime check did not exit.' }
    $companion.Refresh()
    if ($companion.ExitCode -ne 0) {
        Get-Content (Join-Path $logs 'stdout.txt'), (Join-Path $logs 'stderr.txt') -ErrorAction SilentlyContinue
        Get-Content $report -ErrorAction SilentlyContinue
        Get-Content (Join-Path $env:LOCALAPPDATA 'ZyonCompanion\runtime\appium-startup.json') -ErrorAction SilentlyContinue
        throw ('Native desktop window failed its smoke check; exit=' + $companion.ExitCode)
    }
    $result = Get-Content -Raw -LiteralPath $report | ConvertFrom-Json
    if (-not $result.ready -or -not $result.owned -or -not $result.stopped) { throw 'Desktop did not start and stop its own real Appium process.' }
    Write-Host 'Packaged Zyon.exe started real Appium itself, passed HTTP readiness, and stopped its own process.'
} finally {
    foreach ($process in @($companion)) {
        if ($process -and -not $process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F | Out-Null
        }
    }
    Remove-Item -LiteralPath $logs -Recurse -Force -ErrorAction SilentlyContinue
}

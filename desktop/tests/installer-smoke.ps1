# PowerShell / tests/installer-smoke.ps1 / Windows PowerShell 5.1+ / real service startup
$ErrorActionPreference = 'Stop'
$desktop = Split-Path $PSScriptRoot -Parent
function Wait-Ready([string]$Url, [switch]$Appium) {
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            if ($Appium) {
                $result = Invoke-RestMethod -Uri $Url -TimeoutSec 2
                if ($result.value.ready -eq $true) { return }
            } else {
                $result = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
                if ($result.StatusCode -eq 200 -and $result.Content -match 'Zyon') { return }
            }
        } catch { }
        Start-Sleep -Milliseconds 300
    }
    throw ('Installed service did not become ready: ' + $Url)
}
$controller = $null
$companion = $null
$logs = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $logs | Out-Null
try {
    $controller = Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $desktop 'launch.ps1') + '" -Mode Appium') -PassThru -NoNewWindow
    Wait-Ready 'http://127.0.0.1:4723/status' -Appium
    $companion = Start-Process -FilePath (Join-Path $desktop '.venv\Scripts\python.exe') -WorkingDirectory $desktop -ArgumentList '-m zyon.desktop --smoke-test' -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $logs 'stdout.txt') -RedirectStandardError (Join-Path $logs 'stderr.txt')
    $retainedHandle = $companion.Handle
    if (-not $companion.WaitForExit(30000)) { throw 'Native desktop smoke did not exit.' }
    $companion.Refresh()
    if ($companion.ExitCode -ne 0) {
        Get-Content (Join-Path $logs 'stdout.txt'), (Join-Path $logs 'stderr.txt') -ErrorAction SilentlyContinue
        throw ('Native desktop window failed its smoke check; exit=' + $companion.ExitCode)
    }
    Write-Host 'Installed Appium passed HTTP readiness and the native desktop window opened successfully.'
} finally {
    foreach ($process in @($controller, $companion)) {
        if ($process -and -not $process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F | Out-Null
        }
    }
    Remove-Item -LiteralPath $logs -Recurse -Force -ErrorAction SilentlyContinue
}

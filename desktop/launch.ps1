# PowerShell / launch.ps1 / Windows PowerShell 5.1+ / companion launch and dependencies
param([ValidateSet('Companion', 'Prepare', 'Appium')][string]$Mode = 'Companion')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'runtime.ps1')
Set-CompanionRuntime
try {
    if ($Mode -eq 'Appium') {
        $appium = Join-Path $PSScriptRoot 'tools\node_modules\.bin\appium.cmd'
        if (-not (Test-Path -LiteralPath $appium)) { throw 'Run install-requirements.cmd first.' }
        $env:APPIUM_HOME = Join-Path $env:LOCALAPPDATA 'ZyonCompanion\appium'
        & $appium --address 127.0.0.1 --port 4723 --log-level error --log-no-colors
        exit $LASTEXITCODE
    }
    $venv = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $venv)) {
        $python = Get-Command python.exe -ErrorAction SilentlyContinue
        if ($python) {
            & $python.Source -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)'
            if ($LASTEXITCODE -eq 0) { & $python.Source -m venv (Join-Path $PSScriptRoot '.venv') }
        }
        if (-not (Test-Path -LiteralPath $venv)) {
            if (-not (Get-Command py -ErrorAction SilentlyContinue)) { throw 'Run install-requirements.cmd to install Python.' }
            & py -3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)'
            if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 or newer is required. Run install-requirements.cmd.' }
            & py -3 -m venv (Join-Path $PSScriptRoot '.venv')
            if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment.' }
        }
    }
    $requirements = Join-Path $PSScriptRoot 'requirements.txt'
    $digest = (Get-FileHash -LiteralPath $requirements -Algorithm SHA256).Hash
    $marker = Join-Path $PSScriptRoot '.venv\zyon-requirements.sha256'
    if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -Raw -LiteralPath $marker).Trim() -ne $digest) {
        $ErrorActionPreference = 'Continue'
        & $venv -m pip install --disable-pip-version-check -r $requirements
        $pipResult = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        if ($pipResult -ne 0) { throw 'Python package installation failed. Check your internet connection and retry.' }
        Set-Content -LiteralPath $marker -Value $digest -Encoding ASCII
    }
    if ($Mode -eq 'Prepare') { exit 0 }
    & $venv -m zyon.server
    exit $LASTEXITCODE
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }

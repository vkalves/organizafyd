# PowerShell / setup-appium.ps1 / Windows PowerShell 5.1+ / Windows 10
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'runtime.ps1')
Set-CompanionRuntime
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 LTS (22.12 or later) including npm.' }
    $nodeVersion = [version]((& node -p 'process.versions.node') | Select-Object -First 1)
    if ($nodeVersion.Major -ne 22 -or $nodeVersion.Minor -lt 12) { throw 'This package is pinned to Node.js 22 LTS. Install Node.js 22.12 or later in the 22.x series.' }
    if (-not (Get-Command adb -ErrorAction SilentlyContinue)) { throw 'Install Android SDK Platform Tools and put its directory on PATH.' }
    if (-not (Get-Command java -ErrorAction SilentlyContinue)) { throw 'Install JDK 17 and set JAVA_HOME.' }
    if (-not $env:ANDROID_HOME) { throw 'Set ANDROID_HOME to your Android SDK directory.' }
    if (-not $env:JAVA_HOME) { throw 'Set JAVA_HOME to your JDK 17 directory.' }
    Push-Location (Join-Path $PSScriptRoot 'tools')
    try {
        # Native tools may emit warnings on stderr in Windows PowerShell 5.1.
        $ErrorActionPreference = 'Continue'
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Appium npm installation failed.' }
        $env:APPIUM_HOME = Join-Path $env:LOCALAPPDATA 'ZyonCompanion\appium'
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        $appium = Join-Path $PSScriptRoot 'tools\node_modules\appium\index.js'
        & $node $appium driver list --installed --json | Out-String | Set-Variable installedDrivers
        if ($LASTEXITCODE -ne 0) { throw 'Appium driver inventory failed.' }
        if ($installedDrivers -notmatch 'uiautomator2') {
            & $node $appium driver install 'uiautomator2@5.0.7'
            if ($LASTEXITCODE -ne 0) { throw 'UiAutomator2 driver installation failed.' }
        }
        & $node $appium driver doctor uiautomator2
        if ($LASTEXITCODE -ne 0) { throw 'Appium doctor reported missing Android dependencies.' }
    } finally { $ErrorActionPreference = 'Stop'; Pop-Location }
    Write-Host 'Appium setup finished. Start start-appium.cmd, then start.cmd.'
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }

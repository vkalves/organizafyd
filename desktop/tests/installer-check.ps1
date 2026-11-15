# PowerShell / tests/installer-check.ps1 / Windows PowerShell 5.1+ / installer contracts
$ErrorActionPreference = 'Stop'
$desktop = Split-Path $PSScriptRoot -Parent
foreach ($file in Get-ChildItem -LiteralPath $desktop -Filter '*.ps1') {
    $parseErrors = $null; $tokens = $null
    [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count) { throw ($file.Name + ': ' + ($parseErrors | Out-String)) }
}
. (Join-Path $desktop 'install-requirements.ps1')
if (-not (Find-CompanionPython)) { throw 'An existing compatible Python was not detected.' }
if (@(Get-InstallPlan).Count -lt 7) { throw 'Incomplete install plan.' }
Assert-DownloadUrl 'https://nodejs.org/dist/test.zip' @('nodejs.org')
foreach ($url in @('http://nodejs.org/file.zip', 'https://nodejs.org.evil.test/file.zip', 'https://user:password@nodejs.org/file.zip', 'file:///C:/test.zip')) {
    $rejected = $false
    try { Assert-DownloadUrl $url @('nodejs.org') } catch { $rejected = $true }
    if (-not $rejected) { throw 'Invalid package origin was accepted.' }
}
$temp = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    $cached = Join-Path $temp 'cached.zip'
    Set-Content -LiteralPath $cached -Value 'cached package fixture' -Encoding ASCII
    $digest = (Get-FileHash -LiteralPath $cached -Algorithm SHA256).Hash
    # A correct cache must return before making a network request.
    Get-VerifiedDownload 'https://invalid.test/package.zip' $cached $digest @('invalid.test')
    $rejected = $false
    try { Get-VerifiedDownload 'https://invalid.test/package.zip' $cached 'bad-checksum' @('invalid.test') } catch { $rejected = $true }
    if (-not $rejected) { throw 'Missing checksum was accepted.' }
    $originalLocal = $env:LOCALAPPDATA
    $originalPath = $env:PATH
    $originalJava = $env:JAVA_HOME
    $originalAndroid = $env:ANDROID_HOME
    $originalSdk = $env:ANDROID_SDK_ROOT
    try {
        $env:LOCALAPPDATA = $temp
        $runtime = Join-Path $temp 'ZyonCompanion\runtime'
        $java = Join-Path $runtime 'java'
        $node = Join-Path $runtime 'node'
        $sdk = Join-Path $runtime 'android-sdk'
        New-Item -ItemType Directory -Path (Join-Path $java 'bin'), $node, $sdk -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $java 'bin\java.exe') -Value 'fixture'
        @{ Node = $node; Java = $java; Android = $sdk } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime 'paths.json') -Encoding UTF8
        . (Join-Path $desktop 'runtime.ps1')
        Set-CompanionRuntime
        if ($env:JAVA_HOME -ne $java -or $env:ANDROID_HOME -ne $sdk) { throw 'Isolated runtime environment was not loaded.' }
        if ($env:PATH -notlike ($node + ';*')) { throw 'Isolated Node is not first in PATH.' }
    } finally {
        $env:LOCALAPPDATA = $originalLocal; $env:PATH = $originalPath; $env:JAVA_HOME = $originalJava
        $env:ANDROID_HOME = $originalAndroid; $env:ANDROID_SDK_ROOT = $originalSdk
    }
} finally { Remove-Item -LiteralPath $temp -Recurse -Force }
Write-Host 'Installer contracts passed: parsing, download origins, checksum/cache and isolated runtime paths.'

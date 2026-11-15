# PowerShell / runtime.ps1 / Windows PowerShell 5.1+ / isolated companion tools
function Set-CompanionRuntime {
    $root = Join-Path $env:LOCALAPPDATA 'ZyonCompanion\runtime'
    $configPath = Join-Path $root 'paths.json'
    if (-not (Test-Path -LiteralPath $configPath)) { return }
    $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    $extra = @()
    foreach ($item in @($config.Node, $config.Python)) {
        if ($item -and (Test-Path -LiteralPath $item)) { $extra += $item }
    }
    if ($config.Java -and (Test-Path -LiteralPath (Join-Path $config.Java 'bin\java.exe'))) {
        $env:JAVA_HOME = $config.Java
        $extra += Join-Path $config.Java 'bin'
    }
    if ($config.Android -and (Test-Path -LiteralPath $config.Android)) {
        $env:ANDROID_HOME = $config.Android
        $env:ANDROID_SDK_ROOT = $config.Android
        $extra += Join-Path $config.Android 'platform-tools'
        $extra += Join-Path $config.Android 'cmdline-tools\latest\bin'
    }
    $env:PATH = ($extra -join ';') + ';' + $env:PATH
}

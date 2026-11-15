# PowerShell / install-requirements.ps1 / Windows PowerShell 5.1+ / Windows 10 x64
param([switch]$PlanOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-InstallPlan {
    return @('Python 3.11+ (install Python 3.12 with WinGet if missing)',
        'Isolated Node.js 22 LTS and npm', 'Isolated Temurin JDK 17',
        'Android command-line tools 19.0, platform-tools, Android 34, build-tools 35.0.0',
        'Google Chrome (install with WinGet if missing)',
        'Python requirements, Appium 3.9.1 and UiAutomator2 5.0.7',
        'Android SDK license acceptance and Appium diagnostics')
}

function Assert-DownloadUrl([string]$Url, [string[]]$Hosts) {
    $parsed = $null
    if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$parsed) -or $parsed.Scheme -ne 'https' -or $parsed.UserInfo -or $parsed.Host -notin $Hosts) {
        throw 'A package metadata URL was not an approved HTTPS download host.'
    }
}

function Get-VerifiedDownload([string]$Url, [string]$Destination, [string]$Sha256, [string[]]$Hosts) {
    Assert-DownloadUrl $Url $Hosts
    if ($Sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Missing or invalid SHA-256 for downloaded package.' }
    if ((Test-Path -LiteralPath $Destination) -and (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -eq $Sha256) { return }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile ($Destination + '.partial') -TimeoutSec 300
            if ((Get-FileHash -LiteralPath ($Destination + '.partial') -Algorithm SHA256).Hash -ne $Sha256) { throw 'Package checksum did not match. No downloaded code was executed.' }
            Move-Item -LiteralPath ($Destination + '.partial') -Destination $Destination -Force
            return
        } catch {
            Remove-Item -LiteralPath ($Destination + '.partial') -Force -ErrorAction SilentlyContinue
            if ($attempt -eq 3) { throw }
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
}

function Invoke-Checked([string]$File, [string[]]$Arguments) {
    # Windows PowerShell treats some harmless native stderr as terminating errors.
    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $File @Arguments
        $result = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prior }
    if ($result -ne 0) { throw ('A required command failed (exit ' + $result + '): ' + (Split-Path $File -Leaf)) }
}

function Accept-AndroidSdkLicenses([string]$SdkManager, [string]$SdkRoot) {
    # Feed the real SDK CLI directly. Windows PowerShell pipelines into .bat
    # wrappers can drop stdin; send one flushed answer at a time instead.
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $env:ComSpec
    $info.Arguments = '/d /s /c ""{0}" "--sdk_root={1}" --licenses"' -f $SdkManager, $SdkRoot
    $info.UseShellExecute = $false
    $info.RedirectStandardInput = $true
    # Java reads literal y/yes: a UTF-8/UTF-16 preamble rejects the first answer.
    $info.StandardInputEncoding = [Text.Encoding]::ASCII
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { throw 'Could not start Android SDK license setup.' }
        $timer = [Diagnostics.Stopwatch]::StartNew()
        while (-not $process.HasExited) {
            if ($timer.Elapsed.TotalSeconds -gt 180) { $process.Kill(); throw 'Android SDK license setup timed out. Check connectivity and rerun.' }
            try { $process.StandardInput.WriteLine('y'); $process.StandardInput.Flush() }
            catch [IO.IOException] { break }
            Start-Sleep -Milliseconds 150
        }
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw 'Android SDK licenses were not accepted. Rerun the installer.' }
    } finally { $process.Dispose() }
}

function Refresh-InstallPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:PATH = $machine + ';' + $user + ';' + $env:PATH
}

function Find-CompanionPython {
    $candidates = @()
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand -and $pythonCommand.Source -notmatch '\\Microsoft\\WindowsApps\\') { $candidates += $pythonCommand.Source }
    $candidates += Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            $prior = $ErrorActionPreference
            try { $ErrorActionPreference = 'Continue'; $result = & $candidate -c 'import sys; sys.exit(1) if sys.version_info < (3,11) else print(sys.executable)' 2>$null; $probeResult = $LASTEXITCODE } finally { $ErrorActionPreference = $prior }
            if ($probeResult -eq 0 -and $result -and (Test-Path -LiteralPath $result)) { return [string]$result }
        }
    }
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $prior = $ErrorActionPreference
        try { $ErrorActionPreference = 'Continue'; $result = & py -3 -c 'import sys; sys.exit(1) if sys.version_info < (3,11) else print(sys.executable)' 2>$null; $probeResult = $LASTEXITCODE } finally { $ErrorActionPreference = $prior }
        if ($probeResult -eq 0 -and $result -and (Test-Path -LiteralPath $result)) { return [string]$result }
    }
    return $null
}

function Find-CompanionChrome {
    foreach ($root in @($env:PROGRAMFILES, ${env:PROGRAMFILES(X86)}, $env:LOCALAPPDATA)) {
        if ($root -and (Test-Path -LiteralPath (Join-Path $root 'Google\Chrome\Application\chrome.exe'))) { return $true }
    }
    return $false
}

function Install-WinGetPackage([string]$Id, [switch]$UserScope) {
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw 'Windows App Installer (WinGet) is missing. Install/update App Installer from https://apps.microsoft.com/detail/9NBLGGH4NNS1 then run install-requirements.cmd again.'
    }
    $arguments = @('install', '--id', $Id, '--exact', '--source', 'winget', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity')
    if ($UserScope) { $arguments += @('--scope', 'user') }
    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & winget.exe @arguments
        $result = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prior }
    # WinGet's "no applicable update" result is handled by validating the executable.
    if ($result -ne 0 -and $result -ne -1978335189) { throw ('WinGet could not install ' + $Id + ' (exit ' + $result + '). Complete any Windows installer prompt and rerun.') }
    Refresh-InstallPath
}

function Install-CompanionRequirements {
    if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'This installer supports Windows 10/11 x64.' }
    $root = Join-Path $env:LOCALAPPDATA 'ZyonCompanion\runtime'
    $cache = Join-Path $root 'downloads'
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    $lock = [IO.File]::Open((Join-Path $root 'installation.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        Write-Host 'Installing companion requirements. Large downloads may take several minutes.'
        Write-Host 'This installs software and accepts the package/Android SDK licenses. Windows may request installation approval.'
        $python = Find-CompanionPython
        if (-not $python) { Install-WinGetPackage 'Python.Python.3.12' -UserScope; $python = Find-CompanionPython }
        if (-not $python) { throw 'Python installation was not confirmed. Restart Windows if requested, then rerun.' }
        if (-not (Find-CompanionChrome)) { Install-WinGetPackage 'Google.Chrome' }
        if (-not (Find-CompanionChrome)) { throw 'Chrome installation was not confirmed. Restart if requested, then rerun.' }

        $nodeRoot = Join-Path $root 'node'
        $javaRoot = Join-Path $root 'java'
        $sdkRoot = Join-Path $root 'android-sdk'
        if (-not (Test-Path -LiteralPath (Join-Path $nodeRoot 'node.exe'))) {
            Write-Host 'Downloading isolated Node.js 22...'
            $sums = (Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt' -TimeoutSec 30).Content
            $match = [regex]::Match($sums, '(?m)^([a-f0-9]{64})\s+(node-v22\.\d+\.\d+-win-x64\.zip)\r?$')
            if (-not $match.Success) { throw 'Could not locate a verified Windows Node.js 22 package.' }
            $archive = Join-Path $cache $match.Groups[2].Value
            Get-VerifiedDownload ('https://nodejs.org/dist/latest-v22.x/' + $match.Groups[2].Value) $archive $match.Groups[1].Value @('nodejs.org')
            $stage = Join-Path $root 'node-extract'
            if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
            Expand-Archive -LiteralPath $archive -DestinationPath $stage
            $folder = @(Get-ChildItem -LiteralPath $stage -Directory)
            if ($folder.Count -ne 1) { throw 'Unexpected Node.js archive layout.' }
            Move-Item -LiteralPath $folder[0].FullName -Destination $nodeRoot
            Remove-Item -LiteralPath $stage -Recurse -Force
        }
        if (-not (Test-Path -LiteralPath (Join-Path $javaRoot 'bin\java.exe'))) {
            Write-Host 'Downloading isolated Temurin Java 17...'
            $assets = @(Invoke-RestMethod -Uri 'https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse' -TimeoutSec 30)
            if ($assets.Count -ne 1) { throw 'Could not uniquely identify the Windows Java 17 package.' }
            $package = $assets[0].binary.package
            $archive = Join-Path $cache 'temurin17-windows.zip'
            Get-VerifiedDownload $package.link $archive $package.checksum @('github.com', 'api.adoptium.net')
            $stage = Join-Path $root 'java-extract'
            if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
            Expand-Archive -LiteralPath $archive -DestinationPath $stage
            $folder = @(Get-ChildItem -LiteralPath $stage -Directory)
            if ($folder.Count -ne 1) { throw 'Unexpected Java archive layout.' }
            Move-Item -LiteralPath $folder[0].FullName -Destination $javaRoot
            Remove-Item -LiteralPath $stage -Recurse -Force
        }
        $sdkManager = Join-Path $sdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'
        if (-not (Test-Path -LiteralPath $sdkManager)) {
            Write-Host 'Downloading Android SDK command-line tools...'
            $archive = Join-Path $cache 'commandlinetools-win-13114758.zip'
            Get-VerifiedDownload 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip' $archive '98b565cb657b012dae6794cefc0f66ae1efb4690c699b78a614b4a6a3505b003' @('dl.google.com')
            $stage = Join-Path $root 'android-extract'
            if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
            Expand-Archive -LiteralPath $archive -DestinationPath $stage
            New-Item -ItemType Directory -Path (Join-Path $sdkRoot 'cmdline-tools') -Force | Out-Null
            if (-not (Test-Path -LiteralPath (Join-Path $stage 'cmdline-tools\bin\sdkmanager.bat'))) { throw 'Unexpected Android SDK archive layout.' }
            Move-Item -LiteralPath (Join-Path $stage 'cmdline-tools') -Destination (Join-Path $sdkRoot 'cmdline-tools\latest')
            Remove-Item -LiteralPath $stage -Recurse -Force
        }
        $paths = @{ Node = $nodeRoot; Java = $javaRoot; Android = $sdkRoot; Python = (Split-Path $python -Parent) }
        $paths | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'paths.json') -Encoding UTF8
        . (Join-Path $PSScriptRoot 'runtime.ps1')
        Set-CompanionRuntime
        Invoke-Checked (Join-Path $nodeRoot 'node.exe') @('--version')
        Invoke-Checked (Join-Path $javaRoot 'bin\java.exe') @('-version')
        Write-Host 'Accepting Android SDK licenses and installing device tools...'
        Accept-AndroidSdkLicenses $sdkManager $sdkRoot
        Invoke-Checked $sdkManager @("--sdk_root=$sdkRoot", 'platform-tools', 'platforms;android-34', 'build-tools;35.0.0')
        foreach ($required in @('platform-tools\adb.exe', 'platforms\android-34\android.jar', 'build-tools\35.0.0\aapt2.exe')) {
            if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot $required))) { throw ('Android SDK component was not installed: ' + $required + '. Check SDK licenses and connectivity, then rerun.') }
        }
        Invoke-Checked (Join-Path $sdkRoot 'platform-tools\adb.exe') @('version')
        Invoke-Checked 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'launch.ps1'), '-Mode', 'Prepare')
        Invoke-Checked 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'setup-appium.ps1'))
        Write-Host 'All required software checks passed. Enable USB debugging and authorize this computer on the phone.' -ForegroundColor Green
    } finally { $lock.Dispose() }
}

if ($MyInvocation.InvocationName -ne '.') {
    if ($PlanOnly) { Get-InstallPlan; exit 0 }
    try { Install-CompanionRequirements; exit 0 }
    catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
}

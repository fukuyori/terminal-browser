[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+(?:\.\d+)?$')]
    [string]$Version = "",
    [string]$IsccPath = "",
    [switch]$Sign
)

$ErrorActionPreference = "Stop"

# A parent PowerShell 7 leaves its module directories in PSModulePath, and they
# hide Windows PowerShell's own copies of cmdlets such as Get-FileHash.
if ($PSVersionTable.PSEdition -eq "Desktop") {
    $system = Join-Path $PSHOME "Modules"
    $others = ($env:PSModulePath -split ";") | Where-Object { $_ -and $_ -ne $system }
    $env:PSModulePath = (@($system) + $others) -join ";"
}

$root = Split-Path -Parent $PSScriptRoot
$payload = Join-Path $root "dist-release\terminal-browser"
$output = Join-Path $root "dist-release"
$iss = Join-Path $root "installer\terminal-browser.iss"

$required = @(
    "bin\terminal-browser.cmd",
    "browser\native\pixel.node",
    "agent-browser\bin\agent-browser.exe",
    "electron\electron.exe",
    "runtime\node.exe",
    "skills\manifest",
    "VERSION"
)
foreach ($relativePath in $required) {
    $path = Join-Path $payload $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "missing Windows package file: $path; run corepack pnpm build:windows first"
    }
}

if (-not $Version) {
    # A Windows file version is four numbers, so the fork revision of 0.8.0-win.1
    # becomes the fourth one: 0.8.0.1. A dev build has no number to carry over.
    $payloadVersion = (Get-Content -LiteralPath (Join-Path $payload "VERSION") -Raw).Trim()
    $match = [regex]::Match($payloadVersion, '^v?(?<base>\d+\.\d+\.\d+)(?:-win\.(?<fork>\d+))?$')
    if ($match.Success) {
        $fork = if ($match.Groups["fork"].Success) { $match.Groups["fork"].Value } else { "0" }
        $Version = "$($match.Groups['base'].Value).$fork"
    } else {
        $Version = "0.0.0.0"
        Write-Warning "'$payloadVersion' is not a release version, so the installer says 0.0.0.0"
    }
}

if ($Version -notmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') {
    throw "Inno Setup requires a numeric version such as 0.8.0.1; got: $Version"
}

if (-not $IsccPath) {
    $command = Get-Command iscc -ErrorAction SilentlyContinue
    if ($command) {
        $IsccPath = $command.Source
    } else {
        $candidates = @(
            "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
            "C:\Program Files\Inno Setup 6\ISCC.exe",
            "C:\Program Files (x86)\Inno Setup 7\ISCC.exe",
            "C:\Program Files\Inno Setup 7\ISCC.exe"
        )
        $IsccPath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    }
}
if (-not $IsccPath -or -not (Test-Path -LiteralPath $IsccPath -PathType Leaf)) {
    throw "ISCC.exe was not found; install Inno Setup 6 or pass -IsccPath"
}

New-Item -ItemType Directory -Path $output -Force | Out-Null
$baseName = "terminal-browser-$Version-windows-x64"
$options = @("/DMyAppVersion=$Version", "/O$output", "/F$baseName")
if ($Sign) {
    $signer = Join-Path $PSScriptRoot "sign-windows.ps1"
    & $signer -NoInstaller

    # Inno signs the uninstaller as well, which it assembles on the user's machine,
    # so that one cannot wait for a signing pass afterwards. Inno expands $f to the
    # file to sign, quotes included, and $q to a quote of our own.
    $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `$q$signer`$q `$f"
    $options += "/DSignTool=terminalbrowser"
    $options += "/Sterminalbrowser=$command"
}
& $IsccPath @options $iss
if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup compilation failed with exit code $LASTEXITCODE"
}

$installer = Join-Path $output "$baseName.exe"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "Inno Setup did not create the expected installer: $installer"
}

$item = Get-Item -LiteralPath $installer
$manifest = [ordered]@{
    version = $Version
    channel = "installer"
    platform = "windows-x64"
    file = $item.Name
    sha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    size = $item.Length
    published = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output "manifest-installer-windows-x64.json") -Encoding utf8

Write-Output $installer

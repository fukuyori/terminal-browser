[CmdletBinding()]
param(
    [string]$Version = "0.5.8-win.1",
    [string]$Channel = "windows",
    [string]$AgentBrowserPath = "",
    [switch]$Sign,
    [switch]$Zip
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
$out = Join-Path $root "dist-release"
$stage = Join-Path $out "terminal-browser"
$target = "win32-x64"

if (-not [Environment]::Is64BitOperatingSystem) {
    throw "Windows x64 is required"
}

if (Test-Path -LiteralPath $out) {
    $resolvedRoot = [IO.Path]::GetFullPath($root).TrimEnd('\')
    $resolvedOut = [IO.Path]::GetFullPath($out).TrimEnd('\')
    if (-not $resolvedOut.StartsWith("$resolvedRoot\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "refusing to remove output outside the repository: $resolvedOut"
    }
    Remove-Item -LiteralPath $out -Recurse -Force
}

$directories = @(
    "bin",
    "cli\dist",
    "browser\dist",
    "browser\native",
    "electron",
    "runtime",
    "assets\fonts",
    "assets\react-grab"
)
foreach ($directory in $directories) {
    New-Item -ItemType Directory -Path (Join-Path $stage $directory) -Force | Out-Null
}

Push-Location (Join-Path $root "engine")
try {
    cargo build -p pixel-node --release
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
} finally {
    Pop-Location
}

$native = if ($env:CARGO_TARGET_DIR) {
    Join-Path $env:CARGO_TARGET_DIR "release\pixel_node.dll"
} else {
    Join-Path $root "engine\target\release\pixel_node.dll"
}
if (-not (Test-Path -LiteralPath $native)) { throw "missing native library: $native" }
Copy-Item -LiteralPath $native -Destination (Join-Path $stage "browser\native\pixel.node")

$esbuild = Join-Path $root "node_modules\esbuild\bin\esbuild"
if (-not (Test-Path -LiteralPath $esbuild)) {
    throw "missing esbuild; run corepack pnpm install first"
}

function Bundle([string]$Source, [string]$Destination) {
    node (Join-Path $root "scripts\bundle.mjs") $Source $Destination
    if ($LASTEXITCODE -ne 0) { throw "esbuild failed for $Source" }
}

Bundle (Join-Path $root "cli\src\main.ts") (Join-Path $stage "cli\dist\main.js")
Bundle (Join-Path $root "browser\src\main.tsx") (Join-Path $stage "browser\dist\main.js")

Copy-Item -LiteralPath (Join-Path $root "assets\fonts\JetBrainsMono-Regular.ttf") -Destination (Join-Path $stage "assets\fonts")

node (Join-Path $root "scripts\copy-react-grab.mjs")
if ($LASTEXITCODE -ne 0) { throw "react-grab asset copy failed" }
foreach ($asset in @("index.global.js", "logo.png")) {
    $source = Join-Path $root "assets\react-grab\$asset"
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "missing react-grab asset: $source"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $stage "assets\react-grab")
}

$electronDist = Join-Path $root "browser\node_modules\electron\dist"
$electron = Join-Path $electronDist "electron.exe"
if (-not (Test-Path -LiteralPath $electron)) {
    throw "missing Windows Electron; run corepack pnpm install first"
}
Copy-Item -Path (Join-Path $electronDist "*") -Destination (Join-Path $stage "electron") -Recurse -Force

$nodeCommand = Get-Command node -ErrorAction Stop
$nodeExecutable = $nodeCommand.Source
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) {
    throw "missing node.exe; install Node.js before building the Windows package"
}
Copy-Item -LiteralPath $nodeExecutable -Destination (Join-Path $stage "runtime\node.exe")

if ($AgentBrowserPath) {
    $agent = [IO.Path]::GetFullPath($AgentBrowserPath)
    if (-not (Test-Path -LiteralPath $agent -PathType Leaf)) {
        throw "missing agent-browser executable: $agent"
    }
    $agentDir = Join-Path $stage "agent-browser\bin"
    New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
    Copy-Item -LiteralPath $agent -Destination (Join-Path $agentDir "agent-browser.exe")
}

$launcher = @'
@echo off
setlocal
set "TERMINAL_BROWSER_DIST_ROOT=%~dp0.."
"%TERMINAL_BROWSER_DIST_ROOT%\runtime\node.exe" "%TERMINAL_BROWSER_DIST_ROOT%\cli\dist\main.js" %*
'@
Set-Content -LiteralPath (Join-Path $stage "bin\terminal-browser.cmd") -Value $launcher -Encoding ascii
Set-Content -LiteralPath (Join-Path $stage "VERSION") -Value $Version -Encoding ascii
Set-Content -LiteralPath (Join-Path $stage "CHANNEL") -Value $Channel -Encoding ascii

# Before the zip, so a portable copy carries the signatures too. The installer
# signs itself at packaging time, once these are inside it.
if ($Sign) {
    & (Join-Path $PSScriptRoot "sign-windows.ps1")
}

if (-not $Zip) {
    Write-Output $stage
    return
}

$archive = Join-Path $out "terminal-browser-$target.zip"
Compress-Archive -LiteralPath $stage -DestinationPath $archive -CompressionLevel Optimal
$item = Get-Item -LiteralPath $archive
$manifest = [ordered]@{
    version = $Version
    channel = $Channel
    platform = $target
    file = $item.Name
    sha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    size = $item.Length
    published = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out "manifest-$target.json") -Encoding utf8

Write-Output $archive

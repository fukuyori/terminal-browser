[CmdletBinding()]
param(
    [string]$Version = "0.11.1-win.1",
    [string]$Channel = "windows",
    [string]$AgentBrowserPath = "",
    [switch]$Sign,
    [switch]$RequireCleanPixel,
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
$target = "windows-x64"

if (-not [Environment]::Is64BitOperatingSystem) {
    throw "Windows x64 is required"
}

$pixel = [IO.Path]::GetFullPath((Join-Path $root "..\pixel"))
if (-not (Test-Path -LiteralPath (Join-Path $pixel "packages\pixel\package.json"))) {
    throw "no pixel checkout at $pixel"
}
$wanted = (Get-Content -LiteralPath (Join-Path $root "pixel.commit") -Raw).Trim()
$head = (git -C $pixel rev-parse HEAD).Trim()
if ($head -ne $wanted) {
    throw "pixel is at $head but pixel.commit asks for $wanted"
}
if ($RequireCleanPixel) {
    $dirty = git -C $pixel status --porcelain
    if ($dirty) {
        throw "pixel has uncommitted changes:`n$($dirty -join "`n")"
    }
    # tsc leaves the output of deleted sources behind, and a failed native build
    # leaves the last one, so these two are made again from scratch.
    foreach ($stale in @("packages\pixel\dist", "packages\native\win32-x64\pixel.node")) {
        $path = Join-Path $pixel $stale
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
    }
}

Push-Location $pixel
try {
    corepack pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "pixel install failed" }
    corepack pnpm --filter "@zenbu-labs/pixel" build
    if ($LASTEXITCODE -ne 0) { throw "pixel build failed" }
    corepack pnpm --filter "@zenbu-labs/pixel" build:native -- --release
    if ($LASTEXITCODE -ne 0) { throw "pixel native build failed" }
} finally {
    Pop-Location
}

# file: dependencies are copied in, so this is what carries the pixel just
# built into browser/ and cli/.
Push-Location $root
try {
    corepack pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "install failed" }
} finally {
    Pop-Location
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
    "browser\node_modules\@zenbu-labs",
    "electron",
    "runtime",
    "agent-browser\bin",
    "skills",
    "assets\fonts",
    "assets\react-grab"
)
foreach ($directory in $directories) {
    New-Item -ItemType Directory -Path (Join-Path $stage $directory) -Force | Out-Null
}

# pixel looks its engine binary up in this package at run time, so the payload
# carries the package rather than a loose library.
$nativePackage = node (Join-Path $root "scripts\pixel-paths.mjs") native
if ($LASTEXITCODE -ne 0 -or -not $nativePackage -or -not (Test-Path -LiteralPath (Join-Path $nativePackage "pixel.node"))) {
    throw "@zenbu-labs/pixel-native-win32-x64 is not installed in browser/"
}
Copy-Item -LiteralPath $nativePackage -Destination (Join-Path $stage "browser\node_modules\@zenbu-labs\pixel-native-win32-x64") -Recurse -Force

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

node (Join-Path $root "scripts\generate-skill.mjs")
if ($LASTEXITCODE -ne 0) { throw "skill generation failed" }
Copy-Item -Path (Join-Path $root "skill\build\*") -Destination (Join-Path $stage "skills") -Recurse -Force

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

$electronDist = node (Join-Path $root "scripts\pixel-paths.mjs") electron
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $electronDist ".zenbu-electron-sha256"))) {
    throw "pixel has not installed its electron; run corepack pnpm install first"
}
if (-not (Test-Path -LiteralPath (Join-Path $electronDist "pixel.exe"))) {
    throw "missing electron\pixel.exe in $electronDist"
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
} else {
    $agent = node (Join-Path $root "scripts\agent-browser.mjs") --path
    if ($LASTEXITCODE -ne 0) { throw "agent-browser build failed" }
}
if (-not (Test-Path -LiteralPath $agent -PathType Leaf)) {
    throw "missing agent-browser executable: $agent"
}
Copy-Item -LiteralPath $agent -Destination (Join-Path $stage "agent-browser\bin\agent-browser.exe")

$launcher = @'
@echo off
setlocal
set "TERMINAL_BROWSER_DIST_ROOT=%~dp0.."
"%TERMINAL_BROWSER_DIST_ROOT%\runtime\node.exe" --disable-warning=ExperimentalWarning "%TERMINAL_BROWSER_DIST_ROOT%\cli\dist\main.js" %*
'@
Set-Content -LiteralPath (Join-Path $stage "bin\terminal-browser.cmd") -Value $launcher -Encoding ascii
Set-Content -LiteralPath (Join-Path $stage "VERSION") -Value $Version -Encoding ascii
Set-Content -LiteralPath (Join-Path $stage "CHANNEL") -Value $Channel -Encoding ascii

# The engine binary travels from the pixel checkout through node_modules and
# into the payload, and a stale copy at either step is silent. Compare them
# before signing, which rewrites the payload's copy and would hide the answer.
$engineCopies = [ordered]@{
    "pixel checkout" = Join-Path $pixel "packages\native\win32-x64\pixel.node"
    "node_modules"   = Join-Path $nativePackage "pixel.node"
    "payload"        = Join-Path $stage "browser\node_modules\@zenbu-labs\pixel-native-win32-x64\pixel.node"
}
$engineHashes = [ordered]@{}
foreach ($where in $engineCopies.Keys) {
    $engineHashes[$where] = (Get-FileHash -LiteralPath $engineCopies[$where] -Algorithm SHA256).Hash
}
if (($engineHashes.Values | Select-Object -Unique).Count -ne 1) {
    $detail = ($engineHashes.Keys | ForEach-Object { "  $_`: $($engineHashes[$_])" }) -join "`n"
    throw "the engine binary differs between where it was built and where it is used:`n$detail"
}

# Before the zip, so a portable copy carries the signatures too. The installer
# signs itself at packaging time, once these are inside it.
if ($Sign) {
    & (Join-Path $PSScriptRoot "sign-windows.ps1")
}

if (-not $Zip) {
    Write-Output $stage
    return
}

$archive = Join-Path $out "terminal-browser-$Version-$target.zip"
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

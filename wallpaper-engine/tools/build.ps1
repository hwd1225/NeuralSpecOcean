<#
  Rebuilds wallpaper-engine/wallpaper/index.html from NeuralSpecOcean's standalone build.

  By default it reads index.html at the root of this repository (the upstream bundle in this fork),
  so after syncing the fork with upstream you only need to run this script again.

  It makes four small, documented insertions (see ../CHANGES.md). Nothing upstream is removed.

  Usage (Windows PowerShell 5.1 or PowerShell 7), from anywhere:
    powershell -ExecutionPolicy Bypass -File wallpaper-engine\tools\build.ps1
    powershell -ExecutionPolicy Bypass -File wallpaper-engine\tools\build.ps1 -Download   # use the pinned upstream commit instead
    powershell -ExecutionPolicy Bypass -File wallpaper-engine\tools\build.ps1 -UpstreamFile path\to\index.html
#>
param(
  [string]$UpstreamFile = '',
  [switch]$Download,
  [string]$OutFile = ''
)
$ErrorActionPreference = 'Stop'

# The upstream version this port was made and tested with.
$UpstreamRepo   = 'bgbg108555/NeuralSpecOcean'
$UpstreamCommit = 'e9a87c6542931463282415c051352d675928a74c'
$UpstreamSha256 = 'C2D42F1415BFBE47EDD7FA27A27BA2A30538BBC77C2A99E7FAB2FFBEA894E95F'  # of the LF-normalised file

$addonRoot = Split-Path -Parent $PSScriptRoot        # .../wallpaper-engine
$repoRoot  = Split-Path -Parent $addonRoot           # fork root
if (-not $OutFile) { $OutFile = Join-Path $addonRoot 'wallpaper\index.html' }

if ($Download) {
  $UpstreamFile = Join-Path ([IO.Path]::GetTempPath()) "NeuralSpecOcean-$($UpstreamCommit.Substring(0,7))-index.html"
  if (-not (Test-Path $UpstreamFile)) {
    $url = "https://raw.githubusercontent.com/$UpstreamRepo/$UpstreamCommit/index.html"
    Write-Host "Downloading $url"
    Invoke-WebRequest -UseBasicParsing $url -OutFile $UpstreamFile
  }
} elseif (-not $UpstreamFile) {
  $UpstreamFile = Join-Path $repoRoot 'index.html'
}
if (-not (Test-Path $UpstreamFile)) { throw "Upstream index.html not found: $UpstreamFile" }
Write-Host "Source: $UpstreamFile"

$utf8 = New-Object System.Text.UTF8Encoding($false)
# Normalise line endings so a Windows checkout (core.autocrlf) gives the same result.
$html = [IO.File]::ReadAllText($UpstreamFile, $utf8).Replace("`r`n", "`n")

$sha = [Security.Cryptography.SHA256]::Create()
$hash = -join ($sha.ComputeHash($utf8.GetBytes($html)) | ForEach-Object { $_.ToString('X2') })
if ($hash -eq $UpstreamSha256) {
  Write-Host "Upstream matches the tested commit $($UpstreamCommit.Substring(0,7))."
} else {
  Write-Warning "Upstream index.html differs from the tested commit $($UpstreamCommit.Substring(0,7)) (probably a newer upstream version). Building anyway; please test the wallpaper."
}

function Insert-Once([string]$text, [string]$anchor, [string]$insert, [ValidateSet('before','after')][string]$where, [switch]$Last) {
  $i = if ($Last) { $text.LastIndexOf($anchor) } else { $text.IndexOf($anchor) }
  if ($i -lt 0) { throw "Anchor not found (upstream changed?): $anchor" }
  if (-not $Last -and $text.IndexOf($anchor, $i + 1) -ge 0) { throw "Anchor is not unique: $anchor" }
  $at = if ($where -eq 'after') { $i + $anchor.Length } else { $i }
  return $text.Substring(0, $at) + $insert + $text.Substring($at)
}

# 1) diagnostics overlay, loaded first so it can catch errors during boot
$html = Insert-Once $html '<meta charset="utf-8">' "`n<script src=`"diag.js`"></script>" 'after'

# 2) wallpaper stylesheet (hides the upstream UI panels)
$html = Insert-Once $html '</head>' "<link rel=`"stylesheet`" href=`"wallpaper.css`">`n" 'before'

# 3) camera hooks on window.oceanDebug, used by wallpaper.js for swing motion and mouse parallax
$hooks = "    getOrbit() { return { yaw: yaw, pitch: pitch, gliding: camGlide.active, dive: diveMode }; },`n" +
         "    setYawPitch(y, p) { if (camGlide.active || diveMode) return; yaw = y; pitch = Math.max(0.03, Math.min(1.22, p)); },`n"
$html = Insert-Once $html "    setPlaying(on) {`n      playing = !!on;" $hooks 'before'

# 4) Wallpaper Engine adapter, after the upstream bundle
$html = Insert-Once $html '</body>' "<script src=`"wallpaper.js`"></script>`n" 'before' -Last

[IO.File]::WriteAllText($OutFile, $html, $utf8)
Write-Host "Wrote $OutFile ($([Math]::Round((Get-Item $OutFile).Length / 1MB, 2)) MB)"

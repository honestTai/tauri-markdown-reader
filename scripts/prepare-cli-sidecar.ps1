$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$tauriDir = Join-Path $repoRoot 'src-tauri'
$cargoToml = Join-Path $tauriDir 'Cargo.toml'
$releaseDir = Join-Path (Join-Path $tauriDir 'target') 'release'
$runningOnWindows = [System.Environment]::OSVersion.Platform -eq 'Win32NT' -or $env:OS -eq 'Windows_NT'
$exeExt = if ($runningOnWindows) { '.exe' } else { '' }
$source = Join-Path $releaseDir "md-reader$exeExt"

cargo build --manifest-path $cargoToml --release --bin md-reader
if ($LASTEXITCODE -ne 0) {
  throw "CLI build failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath $source)) {
  throw "CLI build did not produce $source"
}

Write-Host "Prepared CLI binary: $source"

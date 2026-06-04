$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$cargoToml = Join-Path $repoRoot 'src-tauri\Cargo.toml'
$releaseDir = Join-Path $repoRoot 'src-tauri\target\release'
$source = Join-Path $releaseDir 'md-reader.exe'

cargo build --manifest-path $cargoToml --release --bin md-reader

if (-not (Test-Path -LiteralPath $source)) {
  throw "CLI build did not produce $source"
}

Write-Host "Prepared CLI binary: $source"

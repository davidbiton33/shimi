param([Parameter(Mandatory=$true)][string]$PackagePath)
$ErrorActionPreference='Stop'
$PackagePath=(Resolve-Path -LiteralPath $PackagePath).Path
$Root=Join-Path ([IO.Path]::GetTempPath()) ('shimi-smoke-'+[guid]::NewGuid().ToString('N'))
$Prefix=Join-Path $Root 'install'
$Repo=Join-Path $Root 'repo'
try {
  New-Item -ItemType Directory -Path $Repo -Force | Out-Null
  & npm install --offline --ignore-scripts --no-audit --no-fund --prefix $Prefix $PackagePath
  if($LASTEXITCODE -ne 0){throw 'npm install failed'}
  $Cli=Join-Path $Prefix 'node_modules\shimi-agent-cli\dist\src\cli.js'
  if(!(Test-Path -LiteralPath $Cli)){throw 'SHIMI CLI missing'}
  & node $Cli --version
  if($LASTEXITCODE -ne 0){throw 'CLI version failed'}
  Push-Location $Repo
  try {
    & git init -q
    Set-Content -LiteralPath (Join-Path $Repo 'example.ts') -Value 'export const value = 1' -Encoding UTF8
    & node $Cli init
    if($LASTEXITCODE -ne 0){throw 'CLI init failed'}
    Set-Content -LiteralPath (Join-Path $Repo '.ai\AI_TASK.md') -Value '# Task`nReview example.ts.' -Encoding UTF8
    & node $Cli pack
    if($LASTEXITCODE -ne 0){throw 'CLI pack failed'}
    Write-Output 'SHIMI Windows smoke passed'
  } finally { Pop-Location }
} finally {
  if(Test-Path -LiteralPath $Root){Remove-Item -LiteralPath $Root -Recurse -Force}
}

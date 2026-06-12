param(
  [string]$Workspace = "D:\Draw-workspace",
  [string]$Name = "drawio"
)

$ErrorActionPreference = "Stop"

function Find-DrawioExe {
  $localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { "" }
  $candidates = @(
    $env:DRAWIO_EXE,
    "D:\Program Files (x86)\Draw.io\draw.io.exe",
    "D:\Program Files\Draw.io\draw.io.exe",
    "D:\Draw-io\draw.io\draw.io.exe",
    "D:\Program Files\draw.io\draw.io.exe",
    "D:\Program Files (x86)\draw.io\draw.io.exe",
    "C:\Program Files\draw.io\draw.io.exe",
    "C:\Program Files (x86)\draw.io\draw.io.exe",
    (Join-Path $localAppData "Programs\draw.io\draw.io.exe")
  ) | Where-Object { $_ } | Select-Object -Unique

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  return $null
}

$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
$server = Join-Path $repo "src\server.js"
$drawioExe = Find-DrawioExe

if (-not $drawioExe) {
  Write-Warning "Draw.io executable was not found automatically."
  Write-Host "The MCP server can still be registered, but start_session and image/PDF export need Draw.io."
  Write-Host 'Set DRAWIO_EXE later, for example: $env:DRAWIO_EXE="D:\Program Files (x86)\Draw.io\draw.io.exe"'
} else {
  Write-Host "Found Draw.io: $drawioExe"
}

New-Item -ItemType Directory -Force $Workspace | Out-Null

Write-Host "Installing npm dependencies..."
npm --prefix $repo install

Write-Host "Registering Codex MCP: $Name"
if ($drawioExe) {
  codex mcp add $Name --env "DRAWIO_EXE=$drawioExe" --env "DRAWIO_MCP_WORKSPACE=$Workspace" -- node $server
} else {
  codex mcp add $Name --env "DRAWIO_MCP_WORKSPACE=$Workspace" -- node $server
}

Write-Host "Running smoke test..."
npm --prefix $repo run smoke

Write-Host ""
Write-Host "Done."
Write-Host "Codex MCP name: $Name"
Write-Host "Workspace: $Workspace"
Write-Host "Server: $server"
Write-Host ""
Write-Host "Claude Code can use the same server:"
Write-Host "claude mcp add $Name -- node `"$server`""

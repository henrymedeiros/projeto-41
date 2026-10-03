# Instala (ou remove, com -Remove) o lancador do Projeto 41 no Windows:
# - %LOCALAPPDATA%\Projeto41\Projeto41.vbs roda o supervisor sem janela;
# - atalho na pasta Inicializar: sobe sozinho ao entrar no Windows;
# - atalho "Projeto 41" na Area de Trabalho: sobe (se preciso) e abre o navegador.
# Chamado por `npm run autostart` (scripts/autostart.mjs).
param(
  [string]$CommandBase64,
  [string]$LogoPath,
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

$installDirectory = Join-Path $env:LOCALAPPDATA "Projeto41"
$launcherPath = Join-Path $installDirectory "Projeto41.vbs"
$iconPath = Join-Path $installDirectory "Projeto41.ico"
$startupShortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "Projeto 41.lnk"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Projeto 41.lnk"

if ($Remove) {
  Remove-Item -LiteralPath $startupShortcut, $desktopShortcut -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $installDirectory -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Inicializacao automatica e atalho removidos."
  exit 0
}

if (-not $CommandBase64) { throw "Informe -CommandBase64." }
$Command = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($CommandBase64))
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null

$quoted = $Command.Replace('"', '""')
$launcher = @"
Set shell = CreateObject("WScript.Shell")
extra = ""
If WScript.Arguments.Count > 0 Then extra = " " & WScript.Arguments(0)
shell.Run "$quoted" & extra, 0, False
"@
Set-Content -LiteralPath $launcherPath -Value $launcher -Encoding Unicode

$iconLocation = "$env:SystemRoot\System32\shell32.dll,220"
if ($LogoPath -and (Test-Path -LiteralPath $LogoPath)) {
  try {
    Add-Type -AssemblyName System.Drawing
    $source = [System.Drawing.Image]::FromFile($LogoPath)
    $bitmap = New-Object System.Drawing.Bitmap 256, 256
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($source, 0, 0, 256, 256)
    $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
    $stream = [System.IO.File]::Open($iconPath, [System.IO.FileMode]::Create)
    $icon.Save($stream)
    $stream.Close()
    $graphics.Dispose(); $bitmap.Dispose(); $source.Dispose()
    $iconLocation = "$iconPath,0"
  } catch {
    Write-Warning "Nao foi possivel gerar o icone personalizado; sera usado o icone padrao."
  }
}

$shell = New-Object -ComObject WScript.Shell
function New-Shortcut([string]$Path, [string]$Arguments, [string]$Description) {
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = "$env:SystemRoot\System32\wscript.exe"
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $installDirectory
  $shortcut.IconLocation = $iconLocation
  $shortcut.Description = $Description
  $shortcut.Save()
}
New-Shortcut $startupShortcut "`"$launcherPath`"" "Iniciar o Projeto 41 em segundo plano"
New-Shortcut $desktopShortcut "`"$launcherPath`" --open" "Abrir Projeto 41"

# ja inicia agora, sem esperar o proximo login
Start-Process -FilePath "$env:SystemRoot\System32\wscript.exe" -ArgumentList "`"$launcherPath`""

Write-Host "Inicializacao automatica: $startupShortcut"
Write-Host "Atalho na Area de Trabalho: $desktopShortcut"

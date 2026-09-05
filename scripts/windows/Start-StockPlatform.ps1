param(
  [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message"
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-Command {
  param(
    [string]$Name,
    [string]$WingetId,
    [string]$ManualUrl
  )

  if (Test-Command $Name) {
    return
  }

  if (Test-Command "winget") {
    Write-Step "Installing $Name with winget"
    winget install --exact --id $WingetId --accept-package-agreements --accept-source-agreements
    Refresh-Path
  }

  if (-not (Test-Command $Name)) {
    Write-Host "$Name is required. Opening download page: $ManualUrl"
    Start-Process $ManualUrl
    throw "$Name was not found after installation attempt."
  }
}

function Invoke-Python {
  param([string[]]$Arguments)

  if (Test-Command "py") {
    & py -3 @Arguments
    return
  }

  & python @Arguments
}

function Wait-HttpOk {
  param(
    [string]$Url,
    [int]$Retries = 60
  )

  for ($i = 0; $i -lt $Retries; $i++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }

  throw "Timed out waiting for $Url"
}

function Test-RunningPlatform {
  try {
    $api = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 2
    $web = Invoke-WebRequest -Uri "http://127.0.0.1:3000/" -UseBasicParsing -TimeoutSec 2
    return $api.StatusCode -ge 200 -and $api.StatusCode -lt 500 -and $web.StatusCode -ge 200 -and $web.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Assert-PlatformPortsAvailable {
  foreach ($port in @(8000, 3000)) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $listener) {
      throw "端口 $port 已被其他程序占用（PID：$($listener.OwningProcess)）。请关闭占用程序后再启动。"
    }
  }
}

function Stop-OwnedProcess {
  param([Diagnostics.Process]$Process)

  if ($null -eq $Process) {
    return
  }
  try {
    if (-not $Process.HasExited) {
      Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }
  } catch {
  }
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $processPath = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
  $ProjectRoot = Split-Path -Parent $processPath
  if (-not (Test-Path (Join-Path $ProjectRoot "package.json")) -and $PSScriptRoot) {
    $ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
  }
}

$ProjectRoot = (Resolve-Path $ProjectRoot).Path
Set-Location $ProjectRoot

$apiExe = Join-Path $ProjectRoot "api\stock-platform-api.exe"
$nodeExe = Join-Path $ProjectRoot "runtime\node\node.exe"
$webServer = Join-Path $ProjectRoot "web\server.js"
if (-not (Test-Path $webServer)) {
  $webServer = Join-Path $ProjectRoot "web\apps\web\server.js"
}
$hasBundledApp = (Test-Path $apiExe) -and (Test-Path $nodeExe) -and (Test-Path $webServer)

if (-not (Test-Path "package.json") -or -not (Test-Path "apps\web\package.json")) {
  if (-not $hasBundledApp) {
    throw "没有找到平台程序文件。请重新下载 Windows 压缩包并完整解压。"
  }
}

if (Test-RunningPlatform) {
  Write-Step "Platform is already running"
  Start-Process "http://127.0.0.1:3000/"
  exit 0
}

Assert-PlatformPortsAvailable

New-Item -ItemType Directory -Force -Path "storage\local" | Out-Null
New-Item -ItemType Directory -Force -Path "storage\local\pids" | Out-Null
Remove-Item -Path "storage\local\pids\api.pid", "storage\local\pids\web.pid" -Force -ErrorAction SilentlyContinue

$env:STOCK_APP_INSTALL_ROOT = $ProjectRoot
$env:STOCK_APP_DATA_HOME = Join-Path $ProjectRoot "storage\local"
$env:STOCK_APP_DB_PATH = Join-Path $ProjectRoot "storage\local\app.db"
$env:STOCK_APP_TEMPLATE_HOME = Join-Path $ProjectRoot "storage\templates"
$env:STOCK_APP_API_HOST = "127.0.0.1"
$env:STOCK_APP_API_PORT = "8000"
$env:BACKEND_API_URL = "http://127.0.0.1:8000"
$env:HOSTNAME = "127.0.0.1"
$env:PORT = "3000"

$apiProcess = $null
$webProcess = $null
try {
if ($hasBundledApp) {
  Write-Step "Starting bundled app"
  $apiProcess = Start-Process -FilePath $apiExe -WorkingDirectory $ProjectRoot -WindowStyle Minimized -PassThru
  $webProcess = Start-Process -FilePath $nodeExe -ArgumentList @($webServer) -WorkingDirectory $ProjectRoot -WindowStyle Minimized -PassThru
  Set-Content -Path "storage\local\pids\api.pid" -Value $apiProcess.Id
  Set-Content -Path "storage\local\pids\web.pid" -Value $webProcess.Id
} else {
  Write-Step "Checking runtime tools"
  Ensure-Command -Name "node" -WingetId "OpenJS.NodeJS.LTS" -ManualUrl "https://nodejs.org/"
  Ensure-Command -Name "npm" -WingetId "OpenJS.NodeJS.LTS" -ManualUrl "https://nodejs.org/"
  if (-not (Test-Command "python") -and -not (Test-Command "py")) {
    Ensure-Command -Name "python" -WingetId "Python.Python.3.12" -ManualUrl "https://www.python.org/downloads/windows/"
  }

  Write-Step "Installing Python dependencies"
  if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Invoke-Python -Arguments @("-m", "venv", ".venv")
  }
  & ".venv\Scripts\python.exe" -m pip install --upgrade pip
  & ".venv\Scripts\python.exe" -m pip install -r "apps\api\requirements.txt"

  Write-Step "Installing web dependencies"
  npm --prefix "apps\web" install

  Write-Step "Starting local API and web app"
  $apiArgs = @("-m", "uvicorn", "app.main:app", "--app-dir", "apps/api", "--host", "127.0.0.1", "--port", "8000")
  $webArgs = @("--prefix", "apps/web", "run", "dev", "--", "--hostname", "127.0.0.1")
  $apiProcess = Start-Process -FilePath ".venv\Scripts\python.exe" -ArgumentList $apiArgs -WorkingDirectory $ProjectRoot -WindowStyle Minimized -PassThru
  $webProcess = Start-Process -FilePath "npm" -ArgumentList $webArgs -WorkingDirectory $ProjectRoot -WindowStyle Minimized -PassThru
  Set-Content -Path "storage\local\pids\api.pid" -Value $apiProcess.Id
  Set-Content -Path "storage\local\pids\web.pid" -Value $webProcess.Id
}

Write-Step "Opening web app"
Wait-HttpOk -Url "http://127.0.0.1:8000/health"
Wait-HttpOk -Url "http://127.0.0.1:3000/"
Start-Process "http://127.0.0.1:3000/"

Write-Host ""
Write-Host "股票交易平台已启动：http://127.0.0.1:3000/"
Write-Host "使用期间请不要关闭这个窗口。"
Read-Host "按 Enter 退出这个启动窗口"
} finally {
  Stop-OwnedProcess -Process $webProcess
  Stop-OwnedProcess -Process $apiProcess
  Remove-Item -Path "storage\local\pids\api.pid", "storage\local\pids\web.pid" -Force -ErrorAction SilentlyContinue
}

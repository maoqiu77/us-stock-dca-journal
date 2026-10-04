param(
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot,
  [Parameter(Mandatory = $true)]
  [string]$PackageZip,
  [string]$BackupZip = "",
  [Parameter(Mandatory = $true)]
  [string]$LauncherPath,
  [string]$ApiPid = "",
  [string]$WebPid = "",
  [switch]$DryRun,
  [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"

Write-Host "Install root: $InstallRoot"
Write-Host "Package zip: $PackageZip"
Write-Host "Backup zip: $BackupZip"
Write-Host "Launcher: $LauncherPath"
Write-Host "Preserve: $(Join-Path $InstallRoot 'storage\local')"

if ($DryRun) {
  Write-Host "Dry run only. No files will be changed."
  exit 0
}

function Verify-Package {
  param([string]$ZipPath)
  $verifyDir = Join-Path ([System.IO.Path]::GetTempPath()) ("stock-platform-verify-" + [System.Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $verifyDir | Out-Null
  try {
    Expand-Archive -Path $ZipPath -DestinationPath $verifyDir -Force
    $entries = Get-ChildItem -LiteralPath $verifyDir
    $sourceRoot = $verifyDir
    if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
      $sourceRoot = $entries[0].FullName
    }
    $manifest = Join-Path $sourceRoot "release.json"
    if (-not (Test-Path $manifest)) { throw "The downloaded package is missing release.json." }
    $metadata = Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json
    if ($metadata.platform -ne "windows-x64") { throw "release.json platform is not windows-x64." }
    foreach ($required in @(
      "api\stock-platform-api.exe",
      "runtime\node\node.exe",
      "启动股票交易平台.exe",
      "Start-StockPlatform.ps1",
      "updater\Install-Update.ps1"
    )) {
      if (-not (Test-Path (Join-Path $sourceRoot $required))) { throw "Missing package path: $required" }
    }
    Write-Host "Package verification passed: $($metadata.version)"
  } finally {
    Remove-Item -LiteralPath $verifyDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($VerifyOnly) {
  Verify-Package -ZipPath $PackageZip
  exit 0
}

function Stop-PlatformProcess {
  param([string]$PidValue)
  if ($PidValue -match '^\d+$') {
    try {
      Stop-Process -Id ([int]$PidValue) -Force -ErrorAction SilentlyContinue
    } catch {
    }
  }
}

Start-Sleep -Seconds 2
Stop-PlatformProcess -PidValue $WebPid
Stop-PlatformProcess -PidValue $ApiPid
Start-Sleep -Seconds 1

$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("stock-platform-update-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $workDir | Out-Null

try {
  Expand-Archive -Path $PackageZip -DestinationPath $workDir -Force
  $entries = Get-ChildItem -LiteralPath $workDir
  $sourceRoot = $workDir
  if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
    $sourceRoot = $entries[0].FullName
  }

  if (-not (Test-Path (Join-Path $sourceRoot "release.json"))) {
    throw "The downloaded package is missing release.json."
  }

  foreach ($item in Get-ChildItem -LiteralPath $sourceRoot) {
    if ($item.Name -eq "storage") {
      $storageRoot = Join-Path $InstallRoot "storage"
      New-Item -ItemType Directory -Force -Path $storageRoot | Out-Null
      $templatesSource = Join-Path $item.FullName "templates"
      if (Test-Path $templatesSource) {
        $templatesTarget = Join-Path $storageRoot "templates"
        Remove-Item -LiteralPath $templatesTarget -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Item -LiteralPath $templatesSource -Destination $templatesTarget -Recurse
      }
      continue
    }

    $target = Join-Path $InstallRoot $item.Name
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath $item.FullName -Destination $target -Recurse
  }

  if (Test-Path $LauncherPath) {
    Start-Process -FilePath $LauncherPath -WorkingDirectory $InstallRoot
  } else {
    $fallbackLauncher = Join-Path $InstallRoot "启动股票交易平台.exe"
    if (Test-Path $fallbackLauncher) {
      Start-Process -FilePath $fallbackLauncher -WorkingDirectory $InstallRoot
    } else {
      Start-Process -FilePath "powershell.exe" -ArgumentList @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $InstallRoot "Start-StockPlatform.ps1")) -WorkingDirectory $InstallRoot
    }
  }
} finally {
  Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
}

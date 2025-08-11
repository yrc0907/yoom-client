param(
  [Parameter(Mandatory=$true)] [string]$Bucket,
  [Parameter(Mandatory=$true)] [string]$Region
)

# 进入项目根目录（脚本位于 tools/preview-docker/）
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $ScriptDir "..\..")
Set-Location $Root

if (-not (Test-Path "previews")) {
  Write-Error "未找到 previews 目录，请先运行 docker 生成预览文件。"
  exit 1
}

# 检查 AWS CLI
$aws = Get-Command aws -ErrorAction SilentlyContinue
if (-not $aws) {
  Write-Error "未检测到 AWS CLI，请先安装并执行 aws configure 配置凭证与区域。"
  exit 1
}

# 同步到 S3
$cache = 'public, max-age=86400, stale-while-revalidate=604800'
$cmd = "aws s3 sync previews s3://$Bucket/previews --region $Region --content-type video/mp4 --cache-control `"$cache`""
Write-Host "执行：$cmd" -ForegroundColor Cyan
Invoke-Expression $cmd

Write-Host "完成：已将 previews/ 同步到 s3://$Bucket/previews" -ForegroundColor Green 
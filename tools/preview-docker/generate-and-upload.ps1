param(
  [Parameter(Mandatory=$true)] [string]$Bucket,
  [Parameter(Mandatory=$true)] [string]$Region,
  [switch]$Anim,
  [switch]$PreviewOnly
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $ScriptDir "..\..")
Set-Location $Root

# 1) 生成视频预览
Write-Host "开始生成低码率预览..." -ForegroundColor Cyan
Push-Location "$ScriptDir"
try {
  docker compose run --rm preview || throw "docker compose 预览生成失败"
  if ($Anim) {
    Write-Host "开始生成 WebP/GIF 动图预览..." -ForegroundColor Cyan
    docker compose run --rm anim || throw "docker compose 动图生成失败"
  }
  Write-Host "开始生成 VTT 缩略图..." -ForegroundColor Cyan
  docker compose run --rm vtt || throw "docker compose VTT 生成失败"
} finally {
  Pop-Location
}

# 2) 上传到 S3
Write-Host "准备上传到 S3：s3://$Bucket/previews, previews-anim, previews-vtt" -ForegroundColor Cyan
$cache = 'public, max-age=86400, stale-while-revalidate=604800'
if ($PreviewOnly) {
  Write-Host "仅预览变更(dry-run)" -ForegroundColor Yellow
  aws s3 sync previews s3://$Bucket/previews --region $Region --content-type video/mp4 --cache-control "$cache" --dryrun
  if (Test-Path "previews-anim") { aws s3 sync previews-anim s3://$Bucket/previews-anim --region $Region --cache-control "$cache" --dryrun }
  if (Test-Path "previews-vtt") { aws s3 sync previews-vtt s3://$Bucket/previews-vtt --region $Region --cache-control "$cache" --dryrun }
  exit 0
}

& "$ScriptDir\upload-previews.ps1" -Bucket $Bucket -Region $Region
if (Test-Path "previews-anim") { aws s3 sync previews-anim s3://$Bucket/previews-anim --region $Region --cache-control "$cache" }
if (Test-Path "previews-vtt") { aws s3 sync previews-vtt s3://$Bucket/previews-vtt --region $Region --cache-control "$cache" }

Write-Host "全部完成" -ForegroundColor Green 
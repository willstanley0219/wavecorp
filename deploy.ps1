# 官網上傳：先備份主機上的舊檔，再上傳，最後比對檔案是否一致。
# 用法：pwsh -NoProfile -ExecutionPolicy Bypass -File deploy.ps1 index.html favicon.png
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Files)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$Server     = 'root@172.238.14.118'
$RemoteRoot = '/var/www/wavecorp1'
$BackupRoot = '/var/www/wavecorp1-backups'
$Key        = Join-Path $env:USERPROFILE '.ssh\id_rsa'
$LocalRoot  = $PSScriptRoot
$AllowedExt = '.html', '.png', '.svg', '.ico', '.jpg', '.jpeg', '.webp', '.css', '.js', '.xml'
$AllowedTxt = 'robots.txt', 'ads.txt'

if (-not $Files) {
    Write-Host '用法：deploy.ps1 要上傳的檔案（可多個），例如：deploy.ps1 index.html favicon.png'
    exit 1
}

# 先全部檢查過，有一個不對就整批不傳
$items = foreach ($f in $Files) {
    $full = [IO.Path]::GetFullPath((Join-Path $LocalRoot $f))
    if (-not $full.StartsWith($LocalRoot + [IO.Path]::DirectorySeparatorChar)) { throw "不在官網資料夾裡：$f" }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "找不到檔案：$f" }
    $name = [IO.Path]::GetFileName($full)
    $ext  = [IO.Path]::GetExtension($full).ToLower()
    if (-not ($AllowedExt -contains $ext -or $AllowedTxt -contains $name)) { throw "這種檔案不能上傳到網站：$f" }
    [pscustomobject]@{ Local = $full; Rel = $full.Substring($LocalRoot.Length + 1).Replace('\', '/') }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($it in $items) {
    $remote = "$RemoteRoot/$($it.Rel)"
    $backup = "$BackupRoot/$stamp/$($it.Rel)"
    $remoteDir = $remote.Substring(0, $remote.LastIndexOf('/'))
    $backupDir = $backup.Substring(0, $backup.LastIndexOf('/'))

    ssh -i $Key $Server "mkdir -p '$remoteDir' && if [ -f '$remote' ]; then mkdir -p '$backupDir' && cp -p '$remote' '$backup'; fi"
    if ($LASTEXITCODE -ne 0) { throw "備份失敗，停止：$($it.Rel)" }

    scp -i $Key $it.Local "${Server}:$remote"
    if ($LASTEXITCODE -ne 0) { throw "上傳失敗，停止：$($it.Rel)" }

    $localHash  = (Get-FileHash -LiteralPath $it.Local -Algorithm SHA256).Hash.ToLower()
    $remoteHash = (ssh -i $Key $Server "sha256sum '$remote'").Split(' ')[0]
    if ($localHash -ne $remoteHash) { throw "上傳後檔案不一致：$($it.Rel)" }

    Write-Host "OK  $($it.Rel)"
}
Write-Host "全部上傳完成。舊檔備份在主機：$BackupRoot/$stamp/"

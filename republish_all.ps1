# 批次重發所有已發布文章（修正 www → non-www）
$GAS_URL = 'https://script.google.com/macros/s/AKfycbx6W0RYUzWBfYh3zBLMRi0KAKwfzzl5zC4LSYOnYTf2jXt-swVI7IVDygW9TJkSiYuddw/exec'

# 1. 讀取所有文章
Write-Host "讀取文章清單..." -ForegroundColor Cyan
$resp = Invoke-RestMethod -Uri "$GAS_URL`?action=load" -Method GET
$posts = $resp.posts | Where-Object { $_.status -eq 'published' }
Write-Host "找到 $($posts.Count) 篇已發布文章" -ForegroundColor Yellow

# 2. 逐篇重發
foreach ($post in $posts) {
    Write-Host "重發：$($post.title)" -ForegroundColor White -NoNewline
    $body = @{ action = 'publish'; post = $post } | ConvertTo-Json -Depth 10
    try {
        $r = Invoke-RestMethod -Uri $GAS_URL -Method POST -Body $body -ContentType 'application/json; charset=utf-8'
        if ($r.ok) {
            Write-Host "  ✅ $($post.slug)" -ForegroundColor Green
        } else {
            Write-Host "  ❌ 失敗：$($r | ConvertTo-Json)" -ForegroundColor Red
        }
    } catch {
        Write-Host "  ❌ 錯誤：$_" -ForegroundColor Red
    }
    Start-Sleep -Milliseconds 800  # 避免 GAS 限流
}

Write-Host "`n全部完成！" -ForegroundColor Cyan

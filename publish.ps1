$GAS_URL = 'https://script.google.com/macros/s/AKfycbx6W0RYUzWBfYh3zBLMRi0KAKwfzzl5zC4LSYOnYTf2jXt-swVI7IVDygW9TJkSiYuddw/exec'
$path = Join-Path $PSScriptRoot 'publish_tsmc.json'
$body = Get-Content -Path $path -Raw -Encoding UTF8
$resp = Invoke-RestMethod -Uri $GAS_URL -Method POST -Body $body -ContentType 'application/json; charset=utf-8'
$resp | ConvertTo-Json

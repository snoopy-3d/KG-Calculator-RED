$ErrorActionPreference = 'Stop'
function Read-PrivateValue([string]$Title) {
    $value = Read-Host $Title -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
try {
    $env:TELEGRAM_BOT_TOKEN = Read-PrivateValue 'Новый токен BotFather (ввод скрыт)'
    $env:WEBHOOK_SECRET = Read-PrivateValue 'Тот же WEBHOOK_SECRET, что сохранён в Cloudflare'
    $env:WORKER_URL = Read-Host 'Адрес Worker, например https://kg-calculator-red.YOUR-SUBDOMAIN.workers.dev'
    node "$PSScriptRoot/telegram-setup.mjs"
    if ($LASTEXITCODE -ne 0) { throw 'Настройка не завершена' }
}
finally {
    Remove-Item Env:TELEGRAM_BOT_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:WEBHOOK_SECRET -ErrorAction SilentlyContinue
    Remove-Item Env:WORKER_URL -ErrorAction SilentlyContinue
}

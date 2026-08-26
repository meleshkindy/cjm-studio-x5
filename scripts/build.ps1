$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

pnpm --dir web install --frozen-lockfile
pnpm --dir web typecheck
pnpm --dir web build

go test ./...
New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'dist') | Out-Null
go build -trimpath -ldflags '-s -w' -o (Join-Path $projectRoot 'dist\cjm-studio-windows-amd64.exe') .

Write-Host 'Готово: dist\cjm-studio-windows-amd64.exe'


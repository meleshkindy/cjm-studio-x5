#!/usr/bin/env sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"

pnpm --dir web install --frozen-lockfile
pnpm --dir web typecheck
pnpm --dir web build

go test ./...
mkdir -p dist
target_os=$(go env GOOS)
target_arch=$(go env GOARCH)
if [ "$target_os" = "darwin" ]; then
  target_os="macos"
fi
output="dist/cjm-studio-$target_os-$target_arch"
go build -trimpath -ldflags '-s -w' -o "$output" .

printf 'Готово: %s\n' "$output"

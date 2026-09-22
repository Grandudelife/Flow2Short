#!/bin/bash

set -e

script_dir="$(cd "$(dirname "$0")" && pwd)"
app_dir="$script_dir/app"
port="43121"

if ! command -v python3 >/dev/null 2>&1; then
  osascript -e 'display dialog "برای اجرای Flow2Short، Python 3 روی این مک پیدا نشد. می‌توانید نسخه GitHub Pages را اجرا کنید یا Python 3 را نصب کنید." buttons {"باشه"} default button 1 with icon caution'
  exit 1
fi

python3 -m http.server "$port" --bind 127.0.0.1 --directory "$app_dir" >/tmp/flow2short-server.log 2>&1 &
server_pid=$!

cleanup() {
  kill "$server_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM
sleep 0.8

if ! kill -0 "$server_pid" 2>/dev/null; then
  osascript -e 'display dialog "Flow2Short نتوانست سرور محلی را اجرا کند. برنامه دیگری احتمالاً از درگاه 43121 استفاده می‌کند." buttons {"باشه"} default button 1 with icon caution'
  exit 1
fi

open "http://127.0.0.1:$port/"

echo "Flow2Short Studio در مرورگر باز شد."
echo "برای بستن برنامه، این پنجره را ببندید."
wait "$server_pid"

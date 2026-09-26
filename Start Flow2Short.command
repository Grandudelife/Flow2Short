#!/bin/bash

set -e

script_dir="$(cd "$(dirname "$0")" && pwd)"
app_dir="$script_dir/app"
port="43121"

if command -v python3 >/dev/null 2>&1; then
  # Each package gets its own server if an earlier version is still running.
  port="$(python3 "$script_dir/server/select_port.py")"
  server_command=(python3 -m http.server "$port" --bind 127.0.0.1 --directory "$app_dir")
elif command -v ruby >/dev/null 2>&1; then
  port="$(ruby -rsocket -e '(43121..43220).each { |p| begin; s = TCPServer.new("127.0.0.1", p); s.close; puts p; break; rescue Errno::EADDRINUSE; end }')"
  server_command=(ruby -run -ehttpd "$app_dir" -p"$port" -b127.0.0.1)
else
  osascript -e 'display dialog "برای اجرای Flow2Short، ابزار سرور محلی روی این مک پیدا نشد. می‌توانید نسخه GitHub Pages را اجرا کنید یا Python 3 را نصب کنید." buttons {"باشه"} default button 1 with icon caution'
  exit 1
fi

if [ -z "$port" ]; then
  osascript -e 'display dialog "Flow2Short درگاه محلی آزاد پیدا نکرد." buttons {"باشه"} default button 1 with icon caution'
  exit 1
fi

"${server_command[@]}" >/tmp/flow2short-server.log 2>&1 &
server_pid=$!

cleanup() {
  kill "$server_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM
sleep 0.8

if ! kill -0 "$server_pid" 2>/dev/null; then
  osascript -e 'display dialog "Flow2Short نتوانست سرور محلی را اجرا کند. لطفاً دوباره تلاش کنید." buttons {"باشه"} default button 1 with icon caution'
  exit 1
fi

open "http://127.0.0.1:$port/"

echo "Flow2Short Studio در مرورگر باز شد."
echo "برای بستن برنامه، این پنجره را ببندید."
wait "$server_pid"

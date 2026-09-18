#!/usr/bin/env bash
set -euo pipefail
export PATH=/opt/line-hub/runtime/bin:/usr/bin:/bin
export PLAYWRIGHT_BROWSERS_PATH=/opt/qualityb2b-bobo/browsers
export HOME=/var/lib/qualityb2b-bobo
cleanup(){ kill "${vnc_pid:-}" "${web_pid:-}" 2>/dev/null || true; }
trap cleanup EXIT
x11vnc -noipv6 -display "$DISPLAY" -auth "$XAUTHORITY" -listen 127.0.0.1 -rfbport 5902 -forever -shared -nopw -quiet >/dev/null 2>&1 &
vnc_pid=$!
websockify --web=/usr/share/novnc 127.0.0.1:6082 127.0.0.1:5902 >/dev/null 2>&1 &
web_pid=$!
node /opt/qualityb2b-bobo/deploy/server-login.mjs

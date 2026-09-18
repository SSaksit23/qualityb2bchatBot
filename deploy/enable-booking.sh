#!/usr/bin/env bash
set -euo pipefail
stage=/var/lib/line-hub/bobo-stage
app=/opt/qualityb2b-bobo
export PATH=/opt/line-hub/runtime/bin:$PATH
export PLAYWRIGHT_BROWSERS_PATH=$app/browsers
test "$(id -u)" -eq 0
test -s /var/lib/qualityb2b-bobo/auth/state.json
test "$(stat -c '%U:%a' /var/lib/qualityb2b-bobo/auth/state.json)" = qualityb2b-bobo:600
install -d -m 0755 "$app/validation/deploy"
for file in app.mjs booking.mjs live-booking.mjs hermes.mjs test.mjs; do install -m 0644 "$stage/$file" "$app/validation/$file"; done
install -m 0644 "$stage/check-booking.mjs" "$app/validation/deploy/"
cd "$app/validation"
runuser -u qualityb2b-bobo -- env PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" /opt/line-hub/runtime/bin/node --test test.mjs
runuser -u qualityb2b-bobo -- env PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" B2B_STORAGE_STATE=/var/lib/qualityb2b-bobo/auth/state.json /opt/line-hub/runtime/bin/node deploy/check-booking.mjs
backup=/var/lib/qualityb2b-bobo/rollback-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$backup"
cp -a /etc/qualityb2b-bobo/bobo.env "$backup/bobo.env"
for file in app.mjs booking.mjs live-booking.mjs hermes.mjs test.mjs; do if test -f "$app/$file"; then cp -a "$app/$file" "$backup/"; fi; done
rollback() { for file in app.mjs booking.mjs live-booking.mjs hermes.mjs test.mjs; do if test -f "$backup/$file"; then cp -a "$backup/$file" "$app/$file"; fi; done; cp -a "$backup/bobo.env" /etc/qualityb2b-bobo/bobo.env; systemctl restart qualityb2b-bobo; }
trap rollback ERR
systemctl stop qualityb2b-bobo
for file in app.mjs booking.mjs live-booking.mjs hermes.mjs test.mjs; do install -m 0644 "$app/validation/$file" "$app/$file"; done
install -m 0644 "$stage/check-booking.mjs" "$app/deploy/"
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/qualityb2b-bobo/bobo.env')
s='\n'.join(line for line in p.read_text().splitlines() if not line.startswith(('B2B_LIVE_VERIFIED=','B2B_STORAGE_STATE=')))
p.write_text(s+'\nB2B_LIVE_VERIFIED=true\nB2B_STORAGE_STATE=/var/lib/qualityb2b-bobo/auth/state.json\n')
PY
systemctl start qualityb2b-bobo
for i in $(seq 1 20); do if curl -fsS http://127.0.0.1:3212/health; then break; fi; sleep 1; done
curl -fsS http://127.0.0.1:3212/health >/dev/null
systemctl is-active --quiet qualityb2b-bobo
trap - ERR
printf '\nRollback directory: %s\n' "$backup"

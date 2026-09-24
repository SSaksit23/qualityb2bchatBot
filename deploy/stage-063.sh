#!/bin/bash
set -euo pipefail
export PATH=/opt/line-hub/runtime/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PLAYWRIGHT_BROWSERS_PATH=/opt/qualityb2b-bobo/browsers
release=/opt/qualityb2b-bobo-release-063
mkdir -p "$release"
tar -xzf /var/lib/line-hub/bobo-stage/workflow-063.tar.gz -C "$release"
test -e "$release/node_modules" || ln -s /opt/qualityb2b-bobo/node_modules "$release/node_modules"
chmod -R a+rX "$release"
cd "$release"
runuser -u qualityb2b-bobo -- npm test
npm run check
printf 'TRAVEL_WINDOW_SERVER_TESTS_PASSED\n'

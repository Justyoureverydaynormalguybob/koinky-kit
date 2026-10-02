#!/data/data/com.termux/files/usr/bin/sh
# Runs the as-pect unit tests against @koinos/mock-vm.
set -eu
cd "$(dirname "$0")/.."
[ -f assembly/proto/koinky.ts ] || sh scripts/build.sh debug 0 >/dev/null
node node_modules/@as-pect/cli/bin/asp.js --config as-pect.config.js "$@"

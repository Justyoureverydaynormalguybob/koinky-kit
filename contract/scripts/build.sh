#!/data/data/com.termux/files/usr/bin/sh
# Builds the Koinky contract without yarn or /usr/bin/env, mirroring
# `koinos-sdk-as-cli build-all`. Usage: scripts/build.sh [debug|release] [testing 0|1]
set -eu
cd "$(dirname "$0")/.."
MODE="${1:-release}"
TESTING="${2:-0}"
STUBS="$PWD/.stubs"
mkdir -p "$STUBS" abi

# protoc plugins ship with a `#!/usr/bin/env node` shebang; wrap them in plain sh stubs.
for p in koinos-abi-proto-gen as-proto-gen koinos-as-gen; do
  real="$(node -e "console.log(require('fs').realpathSync('node_modules/.bin/$p'))")"
  # Node on Android gets EAGAIN reading a non-blocking pipe, so spool stdin to a file first.
  printf '#!%s\nt="$(mktemp)"\ncat > "$t"\nnode "%s" "$@" < "$t"\nrc=$?\nrm -f "$t"\nexit $rc\n' "$(command -v sh)" "$real" > "$STUBS/$p"
  chmod +x "$STUBS/$p"
done

command -v protoc >/dev/null || { echo "protoc not found (pkg install protobuf)"; exit 1; }

echo "[1/4] ABI"
protoc --plugin=protoc-gen-abi="$STUBS/koinos-abi-proto-gen" --abi_out=abi/ assembly/proto/koinky.proto

echo "[2/4] proto -> AssemblyScript"
protoc --plugin=protoc-gen-as="$STUBS/as-proto-gen" --as_out=. assembly/proto/*.proto

echo "[3/4] dispatcher (index.ts, boilerplate)"
protoc --plugin=protoc-gen-as="$STUBS/koinos-as-gen" --as_out=assembly/ assembly/proto/koinky.proto

echo "[4/4] asc ($MODE, BUILD_FOR_TESTING=$TESTING)"
node ./node_modules/assemblyscript/bin/asc assembly/index.ts --target "$MODE" --use abort= --use BUILD_FOR_TESTING="$TESTING" --disable sign-extension --disable bulk-memory --config asconfig.json
ls -la "build/$MODE/contract.wasm" abi/koinky.abi

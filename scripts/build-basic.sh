#!/bin/sh
# Build the rc.5 Host-only package with an existing esbuild executable.
set -eu
cd "$(dirname "$0")/.."
"${ESBUILD:-esbuild}" basic-host.js --bundle --format=esm --platform=node \
  --tsconfig-raw='{}' --target=node22 --external:'@deepseek-ai/*' --outfile=basic/host-plugin.js
node --check basic/host-plugin.js
cp LICENSE basic/LICENSE

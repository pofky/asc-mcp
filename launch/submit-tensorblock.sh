#!/bin/zsh
# Opens a PR adding asc-mcp to TensorBlock/awesome-mcp-servers (docs/build--deployment-tools.md).
# Run from the asc-mcp repo root: zsh launch/submit-tensorblock.sh
set -e
ENTRY="$(cat launch/tensorblock-awesome-mcp-entry.txt)"
DIR="$(mktemp -d)"
git clone -q --depth 1 https://github.com/pofky/awesome-mcp-servers-2.git "$DIR/tb"
cd "$DIR/tb"
git remote add upstream https://github.com/TensorBlock/awesome-mcp-servers.git
git fetch -q --depth 1 upstream main
git checkout -q -b add-asc-mcp upstream/main
ENTRY="$ENTRY" python3 - <<'PY'
import os
p = 'docs/build--deployment-tools.md'
lines = open(p).read().split('\n')
if any('pofky/asc-mcp' in l for l in lines):
    raise SystemExit('asc-mcp is already listed')
i = next(n for n, l in enumerate(lines) if 'Alekla0126/app-console-mcp' in l)
lines.insert(i + 1, os.environ['ENTRY'].strip())
open(p, 'w').write('\n'.join(lines))
PY
git commit -qam "Add asc-mcp to Build & Deployment Tools"
git push -q origin add-asc-mcp
gh pr create -R TensorBlock/awesome-mcp-servers --head pofky:add-asc-mcp --base main \
  --title "Add asc-mcp to Build & Deployment Tools" \
  --body "Adds asc-mcp (https://github.com/pofky/asc-mcp), an App Store Connect MCP server that takes an iOS app from a new bundle id through signing, build upload, TestFlight, metadata, in-app purchases and App Review. npm: @pofky/asc-mcp. Official MCP Registry: io.github.pofky/asc-mcp. MIT. Placed next to App Console MCP, the closest existing entry. I maintain the project."

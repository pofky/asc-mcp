#!/bin/zsh
# Files asc-mcp's submission to Cline's MCP Marketplace, in the issue form's own format.
# Run from the asc-mcp repo root: zsh launch/submit-cline.sh
set -e
if gh issue list -R cline/mcp-marketplace --state all --search "pofky/asc-mcp in:body" --json number -q '.[0].number' | grep -q .; then
  echo "asc-mcp is already submitted"; exit 0
fi
BODY="### GitHub Repository URL

$(cat launch/cline-marketplace-repo-url.txt)

### Logo Image

$(cat launch/cline-marketplace-logo-url.txt)

### Installation Testing

- [ ] I have tested that Cline can successfully set up this server using only the README.md and/or llms-install.md file
- [x] The server is stable and ready for public use

### Additional Information

$(cat launch/cline-marketplace-additional-info.txt) The llms-install.md steps were tested on a clean machine with npx and asc_connect; I have not yet run them inside Cline itself."
gh issue create -R cline/mcp-marketplace --title "[Server Submission]: asc-mcp" --body "$BODY"

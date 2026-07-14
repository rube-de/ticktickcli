#!/usr/bin/env bash
set -euo pipefail

if command -v tt >/dev/null 2>&1; then
  echo "tt is already installed: $(command -v tt)"
  tt --version
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found on PATH. Install Node.js/npm, then re-run this script." >&2
  exit 1
fi

echo "Installing @rube-de/ticktickcli globally via npm..."
npm install --global @rube-de/ticktickcli

if ! command -v tt >/dev/null 2>&1; then
  echo "npm install completed but 'tt' is still not on PATH. Check npm's global bin directory (npm config get prefix) is on PATH." >&2
  exit 1
fi

echo "Installed: $(command -v tt)"
tt --version

cat <<'EOF'

tt is installed but not authenticated. Do not authenticate automatically:
ask which credential to configure (v1 personal API token or v2 session) and
follow SKILL.md's "Establish capability" section, or docs/authentication.md,
to set it up. Never read, print, or transmit a credential value.
EOF

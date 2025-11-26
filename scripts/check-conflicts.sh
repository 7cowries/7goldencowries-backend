#!/usr/bin/env bash
set -euo pipefail

# Scan repository for leftover git merge conflict markers.
if rg --hidden --no-ignore --glob '!.git' --glob '!node_modules' --glob '!*lock*' '^(<<<<<<<|=======|>>>>>>>)( .*)?$' >/dev/null; then
  echo "Merge conflict markers detected. Please resolve them before proceeding." >&2
  exit 1
else
  echo "No merge conflict markers found."
fi

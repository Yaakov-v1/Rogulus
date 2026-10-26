#!/usr/bin/env bash
# Install the Harnestica harness into a project. Safe to re-run: existing files are merged or kept, never clobbered.
#   ./install.sh /path/to/repo
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/template"
EX_USAGE=64
EX_UNAVAILABLE=69
TARGET="${1:-}"
[ -n "$TARGET" ] && [ -d "$TARGET" ] || { echo "usage: install.sh /path/to/repo" >&2; exit "$EX_USAGE"; }
command -v node >/dev/null || { echo "Harnestica hooks need Node.js (18+) on PATH." >&2; exit "$EX_UNAVAILABLE"; }
TARGET="$(cd "$TARGET" && pwd)"
echo "Installing Harnestica into $TARGET"

# The Node step plans every change first and writes only after all inputs parsed, so a bad
# settings.json aborts the install before anything is touched.
node "$HERE/lib/install.mjs" "$SRC" "$TARGET"

echo "Done. Review .claude/harnestica.json checks, then open Claude Code in $TARGET once and accept the workspace trust prompt."

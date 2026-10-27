#!/usr/bin/env bash
# Read-only environment report for Unreal work. Installs nothing, uses no network. Always exits 0.
#   bash bootstrap-check.sh [project-dir]
set -u
DIR="${1:-.}"
MIN_FREE_GB=150
MIN_NODE_MAJOR=18
report() { printf '%-8s %s\n' "$1" "$2"; }

case "$(uname -s)" in
  Darwin) OS=mac; report PASS "OS: macOS" ;;
  Linux) OS=linux; report PASS "OS: Linux" ;;
  MINGW*|MSYS*|CYGWIN*) OS=windows; report PASS "OS: Windows (git-bash)" ;;
  *) OS=other; report WARN "OS: $(uname -s) is not a known Unreal host" ;;
esac

ue_found=""
for candidate in "${UE_ROOT:-}" "/Users/Shared/Epic Games"/UE_* "$HOME/UnrealEngine" /opt/UnrealEngine* "/c/Program Files/Epic Games"/UE_*; do
  [ -n "$candidate" ] && [ -d "$candidate/Engine" ] && { ue_found="$candidate"; break; }
done
if [ -n "$ue_found" ]; then
  ue_version="$(tr -d '\n ' < "$ue_found/Engine/Build/Build.version" 2>/dev/null | sed -n 's/.*"MajorVersion":\([0-9]*\),"MinorVersion":\([0-9]*\),"PatchVersion":\([0-9]*\).*/\1.\2.\3/p')"
  report PASS "Unreal Engine ${ue_version:-(version unreadable)}: $ue_found"
else report MISSING "Unreal Engine (set UE_ROOT or install via Epic Games Launcher)"; fi

if [ "$OS" = mac ]; then
  if command -v xcodebuild >/dev/null && xcodebuild -version >/dev/null 2>&1; then report PASS "Xcode: $(xcodebuild -version | head -1)"
  else report MISSING "Xcode full install (xcodebuild unavailable; Command Line Tools alone are not enough)"; fi
fi

free_kb="$(df -Pk "$DIR" 2>/dev/null | awk 'NR==2 {print $4}')"
if [ -z "$free_kb" ]; then report WARN "disk: could not read free space for $DIR"
else
  free_gb=$((free_kb / 1024 / 1024))
  if [ "$free_gb" -ge "$MIN_FREE_GB" ]; then report PASS "disk: ${free_gb} GB free"; else report WARN "disk: ${free_gb} GB free, under ${MIN_FREE_GB} GB"; fi
fi

if command -v git >/dev/null; then report PASS "git: $(git --version)"; else report MISSING "git"; fi
if command -v git-lfs >/dev/null; then report PASS "git-lfs: $(git lfs version | cut -d/ -f2 | cut -d' ' -f1)"; else report MISSING "git-lfs (Unreal binary assets need it)"; fi

if command -v node >/dev/null; then
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$node_major" -ge "$MIN_NODE_MAJOR" ]; then report PASS "node: v$node_major"; else report WARN "node: v$node_major, need >= $MIN_NODE_MAJOR"; fi
else report MISSING "node >= $MIN_NODE_MAJOR (harness hooks need it)"; fi

if command -v codegraph >/dev/null; then report PASS "codegraph on PATH"; else report WARN "codegraph not on PATH (optional)"; fi
exit 0

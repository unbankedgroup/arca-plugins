#!/bin/bash
# find-hardcoded-paths.sh — CI gate for hardcoded paths in the Arca plugin.
# Exits 1 if any hardcoded /root/arca paths are found in the plugin tree.
# Exits 0 if clean.
#
# Usage: ./find-hardcoded-paths.sh [plugin-dir]
#   plugin-dir defaults to the directory containing this script's parent

set -euo pipefail

PLUGIN_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
VIOLATIONS=0

echo "Checking for hardcoded paths in: $PLUGIN_DIR"
echo ""

# Check 1: /root/arca (should be $ARCA_HOME)
echo "=== Checking for /root/arca ==="
while IFS= read -r file; do
    # Skip binary files, node_modules, .git, and this script itself
    case "$file" in
        *.pyc|*.pyo|*.so|*.o|*.a|*.node|*.wasm) continue ;;
        *node_modules*) continue ;;
        *.git/*) continue ;;
        */find-hardcoded-paths.sh) continue ;;
    esac

    # Search for /root/arca that is NOT inside a fallback default like ${ARCA_HOME:-/root/arca} or os.environ.get('ARCA_HOME', '/root/arca')
    if grep -n '/root/arca' "$file" 2>/dev/null | grep -vE '(\$\{ARCA_HOME:-/root/arca\}|os\.environ\.get\([^)]*''/root/arca''[^)]*\)|os\.environ\.get\([^)]*"/root/arca"[^)]*\))' ; then
        echo "  VIOLATION: $file"
        VIOLATIONS=$((VIOLATIONS + 1))
    fi
done < <(find "$PLUGIN_DIR" -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -name '*.pyc' -not -name '*.pyo' -not -name 'find-hardcoded-paths.sh')

# Check 2: /root/.claude/channels/telegram (should be $TELEGRAM_STATE_DIR)
echo ""
echo "=== Checking for /root/.claude/channels/telegram ==="
while IFS= read -r file; do
    case "$file" in
        */find-hardcoded-paths.sh) continue ;;
        *node_modules*) continue ;;
    esac
    if grep -n '/root/.claude/channels/telegram' "$file" 2>/dev/null | grep -v '#.*was.*' ; then
        echo "  VIOLATION: $file"
        VIOLATIONS=$((VIOLATIONS + 1))
    fi
done < <(find "$PLUGIN_DIR" -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -name 'find-hardcoded-paths.sh')

# Check 3: Hardcoded agent names in config (should be $ARCA_AGENT_NAME)
echo ""
echo "=== Checking for hardcoded agent names in run.sh and configs ==="
while IFS= read -r file; do
    case "$file" in
        */find-hardcoded-paths.sh) continue ;;
        */agents/_template/*) continue ;;  # Templates are allowed to have placeholders
        */agents/cognis/*) continue ;;      # Cognis and Mara are reference implementations
        */agents/mara/*) continue ;;        # They use their own names
    esac
    # Check for "Cognis" or "Mara" in hook scripts and configs that should be generic
    if grep -nE '(AGENT_NAME=Cognis|AGENT_NAME=Mara|OPS_AGENT_NAME=Cognis|OPS_AGENT_NAME=Mara)' "$file" 2>/dev/null ; then
        echo "  VIOLATION: $file"
        VIOLATIONS=$((VIOLATIONS + 1))
    fi
done < <(find "$PLUGIN_DIR" -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -name 'find-hardcoded-paths.sh')

echo ""
if [ "$VIOLATIONS" -eq 0 ]; then
    echo "PASS: No hardcoded paths found."
    exit 0
else
    echo "FAIL: $VIOLATIONS violation(s) found. Replace hardcoded paths with env vars."
    exit 1
fi
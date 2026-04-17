#!/bin/bash
# Derive agent name from session cwd ($ARCA_HOME/ops/agents/<agent>/...).
# Claude Code sets CLAUDE_PROJECT_DIR for hooks; fall back to PWD.
DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
AGENT=""
case "$DIR" in
  */arca/ops/agents/*)
    AGENT="${DIR#*/arca/ops/agents/}"
    AGENT="${AGENT%%/*}"
    ;;
esac

if [ -z "$AGENT" ]; then
  echo "WARNING: check-mcp-heartbeat could not derive agent name from '$DIR'." >&2
  exit 2
fi

HB="/tmp/ops-channel-$(echo "$AGENT" | tr '[:upper:]' '[:lower:]').heartbeat"
if [ ! -f "$HB" ]; then
  echo "WARNING: ops-board channel heartbeat file missing for agent '$AGENT' ($HB). Run /mcp to reconnect before working on board tasks." >&2
  exit 2
fi

AGE=$(( $(date +%s) - $(stat -c %Y "$HB") ))
if [ "$AGE" -gt 30 ]; then
  echo "WARNING: ops-board channel heartbeat for '$AGENT' is $AGE seconds old (stale). Run /mcp to reconnect before working on board tasks." >&2
  exit 2
fi
exit 0

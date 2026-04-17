#!/bin/bash
# Inner script that tmux runs
cd "${ARCA_HOME:-/root/arca}/ops/agents/cognis"
CONTINUE_FLAG=""
if [ -d "$HOME/.claude/projects/-root-arca-ops-agents-cognis" ] && \
   ls $HOME/.claude/projects/-root-arca-ops-agents-cognis/*.jsonl >/dev/null 2>&1; then
  CONTINUE_FLAG="--continue"
fi
export TELEGRAM_STATE_DIR="${HOME}/.arca/channels/telegram-cognis"
claude \
  $CONTINUE_FLAG \
  --dangerously-load-development-channels server:claude-peers \
  --dangerously-load-development-channels server:ops-board \
  --channels plugin:telegram@claude-plugins-official \
  --add-dir "${ARCA_HOME:-/root/arca}" \
  --name cognis
# If claude exits, drop to shell so tmux doesn't close
exec bash

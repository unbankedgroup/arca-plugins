#!/bin/bash
# Mara — Launch script for Claude Code session
# Usage: bash run.sh

cd "${ARCA_HOME:-/root/arca}/ops/agents/mara"

MODEL="${MARA_MODEL:-glm-5.1:cloud}"

export TELEGRAM_STATE_DIR="${TELEGRAM_STATE_DIR:-$HOME/.arca/channels/telegram-mara}"

CONTINUE_FLAG=""
if [ -d "$HOME/.claude/projects/-root-arca-ops-agents-mara" ] && \
   ls $HOME/.claude/projects/-root-arca-ops-agents-mara/*.jsonl >/dev/null 2>&1; then
  CONTINUE_FLAG="--continue"
fi

echo "Starting Mara (model: $MODEL)..."
ollama launch claude --model "$MODEL" -- \
  $CONTINUE_FLAG \
  --dangerously-load-development-channels server:claude-peers \
  --dangerously-load-development-channels server:ops-board \
  --channels plugin:telegram@claude-plugins-official \
  --add-dir "${ARCA_HOME:-/root/arca}" \
  --name mara

# If claude exits, drop to shell so tmux doesn't close
exec bash
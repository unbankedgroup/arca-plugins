#!/bin/bash
# {AGENT_NAME} — Launch script for Claude Code session
# Usage: bash run.sh

cd "$ARCA_HOME/ops/agents/{AGENT_NAME}"

MODEL="${ARCA_MODEL:-glm-5.1:cloud}"

export TELEGRAM_STATE_DIR="$HOME/.arca/channels/telegram-{AGENT_NAME}"

ollama launch claude --model "$MODEL" -- \
  --dangerously-load-development-channels server:claude-peers \
  --dangerously-load-development-channels server:ops-board \
  --channels plugin:telegram@claude-plugins-official \
  --add-dir "$ARCA_HOME" \
  --name {AGENT_NAME}

# If claude exits, drop to shell so tmux doesn't close
exec bash
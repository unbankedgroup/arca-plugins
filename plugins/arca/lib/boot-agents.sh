#!/bin/bash
# Boot script for Arca cloud agents
# Launched by systemd on machine startup or via: systemctl start arca-agents
set -e

AGENTS=(cognis forge anvil kiln ember)

for agent in "${AGENTS[@]}"; do
  if ! tmux has-session -t "$agent" 2>/dev/null; then
    bash "${ARCA_HOME:-/root/arca}/ops/agents/$agent/launch.sh" --background
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] arca-agents: launched $agent"
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] arca-agents: $agent already running"
  fi
done
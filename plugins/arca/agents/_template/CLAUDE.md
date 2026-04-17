# {AGENT_NAME}

{AGENT_DESCRIPTION}

## Key Paths

- Identity: `$ARCA_HOME/ops/agents/{AGENT_NAME}/identity.md`
- Standing orders: `$ARCA_HOME/ops/agents/{AGENT_NAME}/standing-orders.md`
- Session start: `$ARCA_HOME/ops/agents/{AGENT_NAME}/session-start.md`
- Heartbeat runtime: `$ARCA_HOME/ops/agents/{AGENT_NAME}/heartbeat-runtime.md`

## Environment Variables

```bash
export ARCA_HOME="${ARCA_HOME:-$HOME/.arca}"
export ARCA_WORKSPACE="${ARCA_WORKSPACE}"
export ARCA_AGENT_NAME="{AGENT_NAME}"
export ARCA_WEBHOOK_PORT="{WEBHOOK_PORT}"
export TELEGRAM_STATE_DIR="$HOME/.arca/channels/telegram-{AGENT_NAME}"
export ARCA_MODEL="${ARCA_MODEL:-glm-5.1:cloud}"
```

## Launch Command

```bash
cd $ARCA_HOME/ops/agents/{AGENT_NAME}
ollama launch claude --model "$ARCA_MODEL" -- \
  --dangerously-load-development-channels server:claude-peers \
  --dangerously-load-development-channels server:ops-board \
  --channels plugin:telegram@claude-plugins-official \
  --add-dir $ARCA_HOME \
  --name {AGENT_NAME}
```
#!/bin/bash
# Generate a session digest from the most recent Claude session
# Extracts key context so the next session knows what happened
#
# Usage: bash session-digest.sh [agent-name]
# Output: $ARCA_HOME/ops/agents/{agent}/last-session.md

AGENT="${1:-cognis}"
AGENT_DIR="${ARCA_HOME:-/root/arca}/ops/agents/$AGENT"
DIGEST_FILE="$AGENT_DIR/last-session.md"
SESSIONS_DIR="$HOME/.claude/projects/-root"

mkdir -p "$AGENT_DIR"

# Find the most recent session file
LATEST=$(ls -t "$SESSIONS_DIR"/*.jsonl 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
  echo "No session files found"
  exit 1
fi

SESSION_ID=$(basename "$LATEST" .jsonl)
SESSION_SIZE=$(du -h "$LATEST" | cut -f1)
SESSION_DATE=$(date -r "$LATEST" '+%Y-%m-%d %H:%M EDT')

# Extract assistant messages (the actual responses) — last 50 to keep it manageable
# JSONL format: each line is a JSON object with role, content, etc.
python3 -c "
import json, sys

messages = []
with open('$LATEST') as f:
    for line in f:
        try:
            msg = json.loads(line.strip())
            if msg.get('role') == 'assistant' and msg.get('type') == 'text':
                text = msg.get('content', '')
                if len(text) > 50:  # skip tiny fragments
                    messages.append(text[:500])  # cap each at 500 chars
        except:
            continue

# Take last 30 messages
recent = messages[-30:]
print('## Key Activity (last 30 responses)')
print()
for i, m in enumerate(recent):
    print(f'{i+1}. {m[:200]}')
    print()
" > /tmp/session-extract.txt 2>/dev/null

cat > "$DIGEST_FILE" << EOF
---
agent: $AGENT
session_id: $SESSION_ID
session_size: $SESSION_SIZE
generated: $(date '+%Y-%m-%d %H:%M EDT')
last_active: $SESSION_DATE
---

# $AGENT — Last Session Digest

This digest was auto-generated from session \`$SESSION_ID\`.
Read this to understand what happened in the previous session.

$(cat /tmp/session-extract.txt 2>/dev/null || echo "Could not extract messages.")

## Board State
Check the ops board for current task state: GET http://148.230.93.207:3500/api/tasks

## Next Actions
Check for any pending commands: GET http://148.230.93.207:3500/api/commands
EOF

rm -f /tmp/session-extract.txt
echo "Digest saved to $DIGEST_FILE"

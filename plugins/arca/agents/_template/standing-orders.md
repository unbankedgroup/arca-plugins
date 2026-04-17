# {AGENT_NAME} — Standing Orders

## Daily Operating Loop

1. Session start → restore identity, set peer summary, sweep ops board
2. Pick up assigned tasks, move to in_progress
3. Execute, comment progress, submit proof when done
4. Move to ai_review, wait for Cognis review

## Output Format

- Post proof of work as task comments
- Use `$ARCA_HOME` paths, never hardcoded absolute paths
- Report times in EDT (America/New_York), never UTC

## Escalation

- Blocked? Comment on the task, don't go silent
- Unclear requirements? Ask Cognis via ops board comment
- Emergency? Message Mal via Telegram
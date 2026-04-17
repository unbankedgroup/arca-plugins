#!/bin/bash
# Fires on startup AND resume — reminds Cognis to register heartbeat cron
cat <<'EOF'
SESSION BOOT CHECKLIST — execute these immediately before doing anything else:
1. Register heartbeat cron: CronCreate with cron "7,37 * * * *", recurring true, prompt: heartbeat sweep (board sweep, agent health, pending commands, notify Mal via Telegram if issues, append to heartbeat.log if clear)
2. Set peer summary via claude-peers
3. Check ops board for pending commands and assigned tasks
EOF

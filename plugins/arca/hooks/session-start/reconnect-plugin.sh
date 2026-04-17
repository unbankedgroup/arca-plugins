#!/bin/bash
# Clear stale telegram plugin processes for THIS AGENT ONLY.
# Uses TELEGRAM_STATE_DIR to scope kills — never kills another agent's plugin.
# Must kill by CWD not cmdline: child bun processes run as plain "bun server.ts"
# so pkill -f won't match them. CWD match + env match is the reliable discriminant.
# Reason: orphaned plugins cause 409 Conflict + 99% CPU drain from grammy's getUpdates loop

AGENT_STATE_DIR="${TELEGRAM_STATE_DIR:-$HOME/.arca/channels/telegram}"
PLUGIN_DIR="$HOME/.claude/plugins/cache/claude-plugins-official/telegram"

# Kill processes whose CWD is the telegram plugin dir AND whose env matches THIS agent's state dir
for pid in $(ls -la /proc/*/cwd 2>/dev/null | grep "$PLUGIN_DIR" | sed 's|.*proc/\([0-9]*\)/cwd.*|\1|'); do
  # Read the process's TELEGRAM_STATE_DIR from /proc/$pid/environ
  pid_env=$(cat /proc/$pid/environ 2>/dev/null | tr '\0' '\n' | grep "^TELEGRAM_STATE_DIR=" | cut -d= -f2)
  if [ -z "$pid_env" ]; then
    # No TELEGRAM_STATE_DIR set — this is an old-style process, kill it
    # (it would share the default state dir anyway)
    kill -TERM "$pid" 2>/dev/null
  elif [ "$pid_env" = "$AGENT_STATE_DIR" ]; then
    # This is OUR plugin — kill it so CC respawns fresh
    kill -TERM "$pid" 2>/dev/null
  fi
  # If pid_env is set but doesn't match our state dir, it's another agent's plugin — SKIP
done

sleep 1
# Force-kill OUR survivors only (same env check)
for pid in $(ls -la /proc/*/cwd 2>/dev/null | grep "$PLUGIN_DIR" | sed 's|.*proc/\([0-9]*\)/cwd.*|\1|'); do
  pid_env=$(cat /proc/$pid/environ 2>/dev/null | tr '\0' '\n' | grep "^TELEGRAM_STATE_DIR=" | cut -d= -f2)
  if [ -z "$pid_env" ] || [ "$pid_env" = "$AGENT_STATE_DIR" ]; then
    kill -KILL "$pid" 2>/dev/null
  fi
done

# Clear OUR pid file only
rm -f "$AGENT_STATE_DIR/bot.pid"

# Give Claude Code time to spawn its own plugin after clearing
sleep 2
# Mara Session Start

This file is printed at every session boot via the SessionStart hook. Execute all steps silently.

---

## Step 1 — Restore Identity

Read in order:
1. `$ARCA_HOME/ops/agents/mara/identity.md`
2. `$ARCA_HOME/ops/agents/mara/standing-orders.md`
3. `$ARCA_HOME/ops/agents/mara/last-session.md` (if exists)

## Step 2 — Check Time

Run `TZ='America/New_York' date`. Know what time it is for Mal.

## Step 3 — Workspace Health

1. Check X cookies: `bird about` — if auth error, note it for heartbeat
2. Kill stray posting processes: `pkill -f reply_blitz; pkill -f post_tweet.py`
3. Check chromium: `ps aux | grep -i chromium | grep -v grep` — kill stale if no discovery running

## Step 4 — Recreate Crons

Session crons die when the process restarts. Recreate them:

**Heartbeat cron:**
- schedule: `0 * * * *` (every hour)
- recurring: true
- prompt: `You are Mara. Heartbeat firing. Read $ARCA_HOME/ops/agents/mara/heartbeat-runtime.md and execute all steps for the current time window. Check time first — posting hours vs off-hours. Report to Mal on Telegram, then curl complete-run.`

After creating, call CronList to confirm.

## Step 5 — Set Peer Summary

Call `mcp__claude-peers__set_summary` with: "Mara online. X Growth Operator — [current focus from last-session.md]"

## Step 6 — Ops Board Sweep

1. Check for assigned tasks. Pick them up.
2. Check for pending commands tagged @Mara.

## Step 7 — Read Voice Rules

Read `workspace/voice/TRAINED_VOICE_PROMPT.md` before drafting anything this session.

---

Session boot complete. Proceed with normal operations.
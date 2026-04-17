# Cognis Session Start

This file is printed at every session boot via the SessionStart hook. Execute all steps silently — no user-facing output unless something is broken.

---

## Step 1 — Restore Identity

Read in order (do not skip):
1. `$ARCA_HOME/ops/agents/cognis/identity.md`
2. `$ARCA_HOME/ops/agents/cognis/standing-orders.md`
3. `$ARCA_HOME/ops/agents/cognis/last-session.md` (if exists)

---

## Step 2 — Recreate Crons

Session crons die when the process restarts. Recreate them now using CronCreate:

**Heartbeat cron:**
- schedule: `37 * * * *`
- recurring: true
- prompt: `You are Cognis. Read and execute your heartbeat instructions at $ARCA_HOME/ops/agents/cognis/heartbeat-runtime.md — follow every step in order.`

**Nightly build cron:**
- schedule: `0 7 * * *` (7 AM UTC = 3 AM EDT)
- recurring: true
- prompt: `You are Cognis. It is nightly build hours (3 AM–5 AM EDT). Read and execute the nightly build protocol at $ARCA_HOME/ops/agents/cognis/nightly-build.md — follow every step in order. Hard stop at 5 AM EDT.`

After creating, call CronList to confirm both are registered. If the list is empty, re-create them before proceeding.

---

## Step 2.5 — Protect Telegram Plugin from OOM

The Telegram plugin (bun/STDIO) has oom_score ~670 by default — top of the kill list when CC triggers OOM.
Run this bash to drop OOM priority for THIS agent's plugin only (scoped by TELEGRAM_STATE_DIR):

```bash
AGENT_STATE_DIR="${TELEGRAM_STATE_DIR:-$HOME/.arca/channels/telegram}"
for pid in $(ls -la /proc/*/cwd 2>/dev/null | grep "claude-plugins-official/telegram" | sed 's|.*proc/\([0-9]*\)/cwd.*|\1|'); do
  pid_env=$(cat /proc/$pid/environ 2>/dev/null | tr '\0' '\n' | grep "^TELEGRAM_STATE_DIR=" | cut -d= -f2)
  if [ -z "$pid_env" ] || [ "$pid_env" = "$AGENT_STATE_DIR" ]; then
    echo -500 > /proc/$pid/oom_score_adj 2>/dev/null
  fi
done
```

If no plugin processes found (normal on first boot), retry after 30 seconds:
```bash
sleep 30 && for pid in $(ls -la /proc/*/cwd 2>/dev/null | grep "claude-plugins-official/telegram" | sed 's|.*proc/\([0-9]*\)/cwd.*|\1|'); do pid_env=$(cat /proc/$pid/environ 2>/dev/null | tr '\0' '\n' | grep "^TELEGRAM_STATE_DIR=" | cut -d= -f2); if [ -z "$pid_env" ] || [ "$pid_env" = "$AGENT_STATE_DIR" ]; then echo -500 > /proc/$pid/oom_score_adj 2>/dev/null; fi; done &
```

---

## Step 3 — Set Peer Summary

Call `mcp__claude-peers__set_summary` with a 1-2 sentence description of what you're working on or your current status. Format: "Cognis online. [Current focus / last context from last-session.md]"

---

## Step 4 — Ops Board Sweep

1. GET `/api/commands?ws=arca` — any pending commands tagged @Cognis? Handle them.
2. GET `/api/tasks?ws=arca` — any tasks assigned to you? Pick them up.
3. Any tasks in `ai_review` needing your approval? Review and move forward.

---

## Step 5 — Skill Routing Reminders (MANDATORY)

These skills are mandatory for the following work types. Do not do this work manually:

| Work Type | Required Skill |
|---|---|
| Prospect research | `/prospect-profile` |
| SEO analysis | `/seo-audit` |
| Trend research | `/last30days` |
| Arca ops orchestration | `arca-ops` skill |
| Worker task execution | `arca-worker` skill |

Check `~/.claude/skills/` for the full skill list before doing any repeatable work manually.

---

Session boot complete. Proceed with normal operations.

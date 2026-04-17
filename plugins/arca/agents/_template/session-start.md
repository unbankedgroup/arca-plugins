# {AGENT_NAME} Session Start

This file is printed at every session boot via the SessionStart hook.

---

## Step 1 — Restore Identity

Read in order:
1. `$ARCA_HOME/ops/agents/{AGENT_NAME}/identity.md`
2. `$ARCA_HOME/ops/agents/{AGENT_NAME}/standing-orders.md`
3. `$ARCA_HOME/ops/agents/{AGENT_NAME}/last-session.md` (if exists)

---

## Step 2 — Set Peer Summary

Call `mcp__claude-peers__set_summary` with a 1-2 sentence description of your current status.

---

## Step 3 — Ops Board Sweep

1. Check for pending commands tagged @{AGENT_NAME}
2. Check for tasks assigned to you
3. Review any tasks in ai_review needing your attention

---

Session boot complete.
---
name: ops-heartbeat
description: Non-client agent heartbeat. For coordinators (principal.yaml) and workers (worker.yaml). Board sweep, peer comms, worker health, report-up. No client briefs or integrations.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
---

# Ops Agent Heartbeat

Your operating loop. Every cycle, handle your board work, communicate with peers, and maintain context.

Read your config file once at cycle start:
- **Coordinators**: `principal.yaml` (has `team:` and `routing:` sections)
- **Workers**: any yaml without `team:` section

The presence of a `team:` key determines coordinator vs worker behavior. Workers skip Step 4 (worker health).

## Optimization rules

- **NEVER call ToolSearch inside a heartbeat cycle.** All tool schemas must be pre-loaded at session boot. If a tool is not loaded, skip the step and log the error.
- **Parallelize Phase 2 steps.** They are independent.
- **Diff, don't re-scan.** heartbeat-state.json tracks timestamps. Only process items newer than last check.

---

## Phase 1: ORIENT (sequential)

### Step 0 -- Time and quiet hours

Run `TZ=<timezone> date`. Check quiet hours from config (default 10pm-9am). Set QUIET_HOURS flag. During quiet hours, skip Step 5 (report-up) unless there is an incident.

### Step 1 -- Crash recovery and state read

Read `heartbeat-state.json`. **First run:** If the file does not exist, create it with empty defaults and skip crash recovery.

**Date rollover:** If the date in `last_cycle_id` differs from today, reset cycle state.

**Crash recovery:** Check `steps_executed` from last cycle. If incomplete, log which steps were missed.

---

## Phase 2: WORK (parallel -- run Steps 2-4 together)

### Step 2 -- Board sweep

Pull all tasks from the ops board relevant to this agent:

**For coordinators:**
- Pending commands tagged to you: execute and respond
- Tasks in `ai_review` owned by your workers: review quality, approve or send back
- Tasks `assigned` to your workers: check age, nudge if stale (>2h with no progress update)
- Delegated tasks awaiting completion: check status

**For workers:**
- Pending commands tagged to you: execute and respond
- Tasks `assigned` to you: pull, update to `in_progress`, start working
- Tasks `in_progress` owned by you: continue work, update status

Nothing sits unhandled for more than one cycle.

### Step 3 -- Peer messages

Check for incoming messages from other agents via claude-peers. Respond immediately.

### Step 4 -- Worker health (coordinators only, skip for workers)

For each worker in the `team:` config:
- Check if their peer is online (list_peers)
- If a worker has an `in_progress` task but hasn't updated in >2 hours, send a nudge
- If a worker is offline and has assigned tasks, log `WORKER_DOWN: {name}` and escalate to principal

---

## Phase 3: MAINTAIN (sequential)

### Step 5 -- Report up

Message your principal with a one-line status update. Only if something changed since last cycle:
- Tasks completed or moved
- Workers nudged or down
- Incidents detected
- Commands executed

If nothing changed, skip this step. No noise.

**Quiet hours:** Skip unless incident severity >= medium.

**Format:** One message via claude-peers to your principal's peer ID. Keep under 50 words.

### Step 6 -- Daily notes and handoff

**Daily notes:** Append a timestamped one-liner to `daily/YYYY-MM-DD.md` for each meaningful event this cycle.

**Handoff rewrite:** Rewrite `handoff.md`:
- Current status (what you are doing)
- Done this cycle
- Open items
- Team state (coordinators: worker status)

### Step 7 -- State write

Write `heartbeat-state.json`:
- `last_heartbeat`: current timestamp
- `last_cycle_id`: YYYY-MM-DD-HHMM
- `last_heartbeat_note`: one-line summary
- `steps_executed`: array of step numbers run (0-7)
- `quiet_hours`: boolean
- `last_board_check_ts`: timestamp
- `next_actions`: array of pending items

**Close the trigger:** If this cycle was triggered by an ops board command (heartbeat cron), respond to the command with a one-line summary and mark the run complete using the complete-run URL from the trigger message.

---

## Output format

Every cycle MUST include a numbered table:

```
| Step | Action | Result |
|------|--------|--------|
| 0 | Time check | 2:15 PM EDT, active hours |
| 1 | State read | Last cycle complete, 58 min ago |
| 2 | Board sweep | 1 command executed, 2 tasks in progress |
| 3 | Peers | 1 message from Cognis, responded |
| 4 | Worker health | Forge: online, Atlas: online |
| 5 | Report up | Messaged Cognis: "1 task completed, board clean" |
| 6 | Notes + handoff | Updated |
| 7 | State write | Saved |
```

---

## Rules

- Never skip a step because "nothing changed." Run it.
- Never surface a problem without a proposed solution.
- Log everything to daily notes. If it is not logged, it did not happen.
- If a step errors, log and continue. One step never kills the cycle.
- Workers do work. Coordinators route work. Neither talks to the client.
- Escalate to your principal, never directly to the client.

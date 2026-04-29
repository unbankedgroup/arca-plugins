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

The presence of a `team:` key determines coordinator vs worker behavior. Workers skip Step 5 (worker health).

## Optimization rules

- **NEVER call ToolSearch inside a heartbeat cycle.** All tool schemas must be pre-loaded at session boot. If a tool is not loaded, skip the step and log the error.
- **Parallelize Phase 2 steps.** They are independent.
- **Diff, don't re-scan.** heartbeat-state.json tracks timestamps. Only process items newer than last check.

---

## Phase 1: ORIENT (sequential)

### Step 0 -- Time and quiet hours

Run `TZ=<timezone> date`. Check quiet hours from config (default 10pm-9am). Set QUIET_HOURS flag. During quiet hours, skip Step 6 (report-up) unless there is an incident.

### Step 1 -- Crash recovery, integrity, and gap detection

Read `heartbeat-state.json`. **First run:** If the file does not exist, create it with empty defaults and skip crash recovery.

**Date rollover:** If the date in `last_cycle_id` differs from today, reset cycle state.

**Crash recovery:** Check `steps_executed` from last cycle. If incomplete, log which steps were missed.

**Integrity check:** Compare last cycle's `steps_executed` against the full step list (0-9, excluding Step 5 for workers). If any step is missing without a valid reason, log `INTEGRITY_FAIL: steps [X, Y] missing from last cycle`.

**Gap detection:** Compare `last_heartbeat` to now. If the gap exceeds 1.5x cadence, log "GAP DETECTED: Xh Ym since last heartbeat" to daily notes.

---

## Phase 2: WORK (parallel -- run Steps 2-5 together)

### Step 2 -- Health probe

Make one lightweight call to each dependency before using it:
- **Ops board:** `ops_get_tasks` (any status). If it fails, log `BOARD_DOWN` and skip Step 3's board operations.
- **Claude-peers:** `list_peers`. If it fails, log `PEERS_DOWN` and skip Steps 4-5.

### Step 3 -- Board sweep

Pull all tasks from the ops board relevant to this agent.

**For coordinators:**
- Pending commands tagged to you: execute and respond
- Tasks in `ai_review` owned by your workers: review quality, approve or send back
- Tasks `assigned` to workers but unrouted: apply routing table from config (`routing:` section) to assign to the correct worker
- Tasks `assigned` to your workers: check age, nudge if stale (>2h with no progress update)
- Delegated tasks awaiting completion: check status

**For workers:**
- Pending commands tagged to you: execute and respond
- Tasks `assigned` to you: pull, update to `in_progress`, start working
- Tasks `in_progress` owned by you: continue work, update status

Nothing sits unhandled for more than one cycle.

### Step 4 -- Peer messages

Check for incoming messages from other agents via claude-peers. Respond immediately.

### Step 5 -- Worker health (coordinators only, skip for workers)

For each worker in the `team:` config:
1. Check if their peer is online via `list_peers`
2. Read their `heartbeat-state.json` -- check `last_heartbeat` timestamp. If >2x their cadence, flag `WORKER_STALE: {name}, last beat {time}`
3. If a worker has an `in_progress` task but their `last_heartbeat` is >2 hours old, send a nudge via claude-peers
4. If a worker is offline and has assigned tasks, log `WORKER_DOWN: {name}` and escalate to principal

Peer presence alone is not enough -- a worker can be online but stuck in a broken loop. Always check their state file.

---

## Phase 3: MAINTAIN (sequential)

### Step 6 -- Report up

Message your principal with a one-line status update. Only if something changed since last cycle:
- Tasks completed or moved
- Workers nudged or down
- Incidents detected
- Commands executed

If nothing changed, skip this step. No noise.

**Quiet hours:** Skip unless incident severity >= medium.

**Format:** One message via claude-peers to your principal's peer ID. Keep under 50 words.

### Step 7 -- Self-critique

If this cycle took any action (task routed, worker nudged, command executed, review approved), one reasoning pass: what could go wrong with what you just did? Fix anything found before writing state.

Coordinators: double-check routing decisions and review approvals. Workers: double-check task output quality.

### Step 8 -- Daily notes and handoff

**Daily notes:** Append a timestamped entry to `daily/YYYY-MM-DD.md` for each meaningful event this cycle.

**Handoff rewrite:** Rewrite `handoff.md`:
- Current status (what you are doing)
- Done this cycle
- Open items
- Team state (coordinators: worker status)

### Step 9 -- State write

**Board-down cache rule:** If the ops board was unreachable this cycle (Step 2 health probe failed), preserve the previous cycle's state instead of overwriting with empty. Stale cache beats no cache.

Write `heartbeat-state.json`:
- `last_heartbeat`: current timestamp
- `last_cycle_id`: YYYY-MM-DD-HHMM
- `last_heartbeat_note`: one-line summary
- `steps_executed`: array of step numbers run (0-9)
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
| 1 | State read | Last cycle complete, 58 min ago, no integrity fails |
| 2 | Health probe | ops_board: OK, peers: OK |
| 3 | Board sweep | 1 command executed, 2 tasks in progress |
| 4 | Peers | 1 message from Cognis, responded |
| 5 | Worker health | Forge: online (beat 12m ago), Atlas: online (beat 8m ago) |
| 6 | Report up | Messaged Cognis: "1 task completed, board clean" |
| 7 | Self-critique | Reviewed routing of 1 task, no issues |
| 8 | Notes + handoff | Updated |
| 9 | State write | Saved, trigger closed |
```

---

## Rules

- Never skip a step because "nothing changed." Run it.
- Never surface a problem without a proposed solution.
- Log everything to daily notes. If it is not logged, it did not happen.
- If a step errors, log and continue. One step never kills the cycle.
- Workers do work. Coordinators route work. Neither talks to the client.
- Escalate to your principal, never directly to the client.

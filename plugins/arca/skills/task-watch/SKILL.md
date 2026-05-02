---
name: task-watch
description: Delegation monitoring loop. Activates when Cognis delegates work, monitors progress via peers and board, escalates stale tasks. Deactivates when all tasks complete. Use ScheduleWakeup at 270s cadence.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

# Task Watch

Lightweight monitoring loop that activates when you delegate work and deactivates when all tasks reach a terminal state. Runs at 270s cadence (stays inside the 5-min prompt cache TTL).

**Pre-requisite:** All MCP tool schemas (claude-peers, ops-board) must be loaded before invoking. Never call ToolSearch inside a task-watch cycle.

---

## Activation

Activate task-watch when you delegate work to workers. Add delegation to `heartbeat-state.json` under `task_watch`:

```json
{
  "task_watch": {
    "active": true,
    "last_check": "2026-04-30T14:32 EDT",
    "delegations": [
      {
        "task_id": "t123",
        "title": "Short description",
        "delegated_at": "2026-04-30T14:15 EDT",
        "last_update": "2026-04-30T14:15 EDT",
        "worker": null,
        "status": "delegated",
        "tmux_status": null
      }
    ]
  }
}
```

---

## Each Cycle (4 steps)

### Step 1 -- Peer check

Call `check_messages`. Process any status pushes from workers. For each update received:
- Update `last_update` timestamp for the matching delegation
- Update `worker` if a specific worker was assigned
- Update `status` if it changed
- If task is complete (ai_review, archived): mark as terminal

### Step 2 -- Board check

Call `ops_get_tasks`. For each task in `delegations`:
- Cross-reference board status with local state
- If board shows a status change not yet reported by the worker, update local state
- If task is no longer on the board (archived/deleted), mark as terminal

### Step 2.5 -- Tmux health check

For each active (non-terminal) delegation with a known `worker` name, check the worker's tmux pane:

```bash
tmux capture-pane -t {worker-name} -p -S -15 | tail -10
```

Analyze the last 10 lines for:

**Stuck indicators** (worker is blocked, not making progress):
- Permission prompts: "Do you want to proceed", "permission", "Y/n", "approve", "Allow"
- Idle prompt: line is just `$` or `>` or ends with prompt character with no tool activity

**Active indicators** (worker is working normally):
- Tool use: "Contemplating", "Inferring", "Calling", "Sautéing", "Channeling", "Reading", "Writing", "Editing"
- Tool output or API responses in the pane

**Actions based on result:**
- If stuck at a permission prompt: auto-approve by sending `tmux send-keys -t {worker-name} Enter` (or `1` for numbered choice prompts)
- If stuck at Y/n: send `tmux send-keys -t {worker-name} y Enter`
- If idle at prompt with no activity for >5 min (compare against `last_update`): flag as potentially stuck in output and include in staleness check
- If actively processing: note in output, no action needed

Store tmux check result in delegation state as `tmux_status`:
- `"active"` -- tool use visible
- `"stuck:prompt"` -- stuck at permission prompt (auto-approved)
- `"stuck:approved"` -- was stuck, auto-approved this cycle
- `"idle"` -- prompt visible, no tool activity
- `"unknown"` -- pane not found or empty

This step is **mandatory every cycle**. Silent failures (permission prompts, crashes) are invisible to peer messages and the board. Tmux is the only way to catch them.

### Step 3 -- Staleness check

For each active (non-terminal) delegation:

| Time since last_update | Worker peer online | Tmux status | Action |
|------------------------|-------------------|-------------|--------|
| <10 min | yes | active | Normal. No action. |
| <10 min | yes | stuck:prompt | Auto-approved in Step 2.5. Monitor next cycle. |
| <10 min | yes | idle | No board/peer update but pane idle. Peer message: "Status on [task]?" |
| 10-20 min | yes | active | Slow but working. Log "slow" in daily notes. |
| 10-20 min | yes | idle/stuck | Log "slow" in daily notes. Peer message to worker. |
| >20 min | yes | any | Escalate: alert client via Telegram. "Task [title] stale for [X] min, investigating." |
| any | no | any | Immediate escalate: "Worker offline, task [title] in_progress." |

<!-- Staleness thresholds vary by task type: code/engineering ~45 min, simple ops ~15 min, research ~30 min. Adjust escalation urgency accordingly. -->

### Step 4 -- Continue or deactivate

- If any delegations are still active: call `ScheduleWakeup` at 270s with prompt "/task-watch"
- If ALL delegations are terminal: run worker cleanup (Step 4.1), then set `task_watch.active` to false, log "Task watch deactivated, all work complete, workers cleared" to daily notes. Do NOT schedule another wakeup.

### Step 4.1 -- Worker cleanup (runs only on deactivation)

When all delegations are terminal, clear participating workers to prevent context bloat (GLM stops processing at ~118k tokens). Steps:

1. Wait 30s (let workers flush final output).
2. For each worker that participated (check `worker` field in each delegation): `tmux send-keys -t {worker-name} /clear Enter`.
3. Wait 10s, verify each cleared pane is responsive: `tmux capture-pane -t {worker-name} -p -S -5 | tail -3`. If stuck, escalate to `tmux kill-session -t {worker-name}`.
4. Update `heartbeat-state.json` `worker_pool`: set each cleared worker's `task` to `null`, `status` to `idle`.
5. Log which workers were cleared to daily notes.

Mark this step as **mandatory on deactivation** -- skipping it causes workers to accumulate stale context and stop responding.

---

## State write

Update `heartbeat-state.json` with current `task_watch` state after every cycle. This is the last action.

---

## Output format

Keep it minimal. One line per delegation:

```
Task watch (cycle 3): Forge on t123 "Security fixes" -- last update 4 min ago, tmux: active (Calling ops-board). | All active, next check 270s.
```

If stuck/approved:

```
Task watch (cycle 3): worker-2 on t456 "Fix deploy" -- last update 12 min ago, tmux: STUCK at permission prompt, auto-approved. | 1 active, next check 270s.
```

If escalating:

```
Task watch (cycle 8): STALE -- Forge on t123 "Security fixes" -- no update for 22 min, tmux: idle. Pinged worker. | Alerting client.
```

---

## Rules

- Never call ToolSearch inside a cycle.
- Never skip Step 2.5 (tmux check) or Step 3 (staleness check) even if you just received an update.
- Tmux checks are the only way to catch silent failures (permission prompts, crashes). Always run them.
- Auto-approve stuck permission prompts without asking the user. These are routine Claude Code "Allow tool?" prompts that block progress silently.
- Consolidated messages only -- one status line per cycle, not per-task.
- Do not re-delegate or reassign tasks yourself. Escalate to the user and let them decide.
- The 270s cadence is a ceiling, not a floor. If you get a peer message between cycles that resolves everything, deactivate immediately.

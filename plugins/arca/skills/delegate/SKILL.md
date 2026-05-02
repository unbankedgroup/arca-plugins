# Delegate Task to Worker Pool

Invoke this skill whenever you need work executed by the worker pool.

## Steps

### 1. Pick a worker

Call `list_peers` with scope "machine". Find peers whose name starts with "worker-". Pick the one whose summary indicates idle or least busy. If multiple are idle, pick the lowest-numbered.

If no workers are online, report to Mal via Telegram: "No workers available. Cannot delegate." Stop.

### 2. Create board task

Call `ops_create_task` with:
- title: concise task description (under 80 chars)
- description: full spec including:
  - WHAT: one-line summary
  - SPEC: detailed requirements
  - OUTPUT: file path for deliverables
  - FORMAT: expected format (code, markdown, etc)
  - ACCEPTANCE: how to verify correctness
- owner: chosen worker name (e.g. "worker-1")
- status: "assigned"

### 3. Notify worker

Call `send_message` to the chosen worker:
"Task {task_id} assigned to you: {title}. Pull from ops board and execute. Update task status to in_progress when you start."

### 4. Nudge GLM worker (GLM models only)

GLM workers have a first-message quirk: they accept prompt text via tmux send-keys but don't start processing until a follow-up Enter is sent. This step is only needed when the worker model is `glm-*`. Skip for Claude or other models.

```
tmux send-keys -t {worker-name} '{task description}' Enter
sleep 2
tmux send-keys -t {worker-name} Enter
```

### 5. Verify worker started

After nudging (or after step 3 if no nudge needed), verify the worker began processing. Within 10 seconds, run:

```
tmux capture-pane -t {worker-name} -p
```

Look for processing indicators: "Contemplating", "Inferring", "Calling", "Reading", "Thinking", or similar. If none appear after 10 seconds, re-send the nudge once. If still no response, report: "Worker {name} unresponsive after nudge. Escalating."

### 6. Activate task-watch

Invoke /task-watch to begin monitoring. Update heartbeat-state.json with the new delegation.

### 7. Report

Tell the requesting context: "Delegated '{title}' to ops team. ETA: {estimate}. Monitoring."

Always give a specific time estimate based on task complexity:
- Simple file edits: 5-10 min
- Code changes: 15-30 min
- Research tasks: 20-40 min
- Multi-file refactors: 30-60 min

## Fallback

If peer message fails (worker not on peer network), fall back to tmux:
```
tmux send-keys -t {worker-name} "You have a new task. Run: ops_get_task {task_id}" Enter
```

## Rules
- Never queue work. If the chosen worker is busy, pick another.
- Never do the work yourself. Always delegate.
- Always create the board task BEFORE notifying the worker.
- Always activate task-watch after delegating.
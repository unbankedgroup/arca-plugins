---
description: watch-agent skill for Arca
---
# /watch-agent skill

Monitor an agent's tmux pane until their task completes. Checks every 5 minutes. **On every check, actively diagnose whether the agent is stuck and intervene immediately — do not just observe.**

## Usage

```
/watch-agent <agent_name> [task_id]
```

Examples:
- `/watch-agent Forge t1776082203089`
- `/watch-agent Forge` (watches whatever Forge is working on)

---

## Step 1 — Capture the pane

```bash
tmux capture-pane -t <agent_name_lowercase>:0 -p -S -80
```

---

## Step 2 — ALWAYS run the stuck check first

**Every single check, before anything else, ask: is the agent stuck?**

Look at the last visible output line. Is it:
- A spinner (`Whirring…`, `Channeling…`, `Brewing…`, `Cooking…`)? → **Working, normal**
- An active tool call line (`● Bash(...)`, `● Read(...)`, `● Edit(...)`)? → **Working, normal**
- The `❯` input prompt with nothing after it? → **Potentially stuck — investigate**
- The `❯` input prompt AND the same last output as the previous check? → **Definitely stuck — intervene now**

---

## Step 3 — Stuck pattern identification + fix

### Pattern 1: Permission / confirmation prompt
**Signs:** "Do you want to proceed?", "Claude requested permissions", cursor on a yes/no option
```bash
tmux send-keys -t <agent>:0 "" Enter
# If still stuck after one Enter:
tmux send-keys -t <agent>:0 "2" ""  # always allow
```

### Pattern 2: Edit-accept loop (⏵⏵ banner + ❯ prompt, no spinner)
**Signs:** Bottom of pane shows `⏵⏵ accept edits on (shift+tab to cycle)` AND `❯` prompt AND no active spinner
**What's happening:** Agent wrote file edits but paused waiting for approval — or is at idle ❯ prompt while in edit-accept mode
```bash
# First try: send Enter to accept one edit
tmux send-keys -t <agent>:0 "" Enter
# If still stuck after 2 Enters: send direct instruction via tmux (bypasses the loop)
tmux send-keys -t <agent>:0 "Continue with <task_id> — keep going autonomously until done." Enter
```

### Pattern 3: Read file then paused (most common GLM pattern)
**Signs:** Last output shows `Read N file(s) (ctrl+o to expand)` followed by `❯` with no further action
**What's happening:** Agent read a file, generated its plan, then stopped at the input prompt waiting for user to say "go". GLM 5.1 does this frequently.
```bash
# Direct tmux push — tell it exactly what to do next
tmux send-keys -t <agent>:0 "Continue — make the edits to the file you just read, then proceed to the next step." Enter
# If you know the task: be specific
tmux send-keys -t <agent>:0 "Continue with <task_id> — write the edits to <filename>, then move to the next file." Enter
```

### Pattern 4: Idle at ❯ with no recent tool calls
**Signs:** ❯ prompt visible, last tool call was >2 checks ago (>10 minutes), no spinner
```bash
# Step 1: Check the task on the board to understand current state
curl -s "https://ops.runarca.xyz/api/tasks/<task_id>?ws=arca" | python3 -c "import json,sys; t=json.loads(sys.stdin.read()); print(t.get('status'), '|', len(t.get('comments',[])), 'comments')"
# Step 2: Send targeted nudge via tmux with specific next action
tmux send-keys -t <agent>:0 "You are working on <task_id>. What is your current step? If blocked, post a comment on the task explaining what's blocking you. If not blocked, continue to the next step now." Enter
```

### Pattern 5: Spinning but frozen timer
**Signs:** Spinner text visible (`Whirring… (4m 12s)`) but the elapsed time hasn't changed across two checks
**What's happening:** Model call timed out or hung — looks active but isn't
```bash
# Send Escape to interrupt the frozen call
tmux send-keys -t forge:0 "" ""
# Wait one check (5 min), if still same: restart the session
```

### Pattern 6: Error / crash
**Signs:** Stack traces, `Error:`, `failed:`, `process exited`, blank pane
```bash
# Comment on the task with the error
# If critical: ping Mal via Telegram
# If session dead: keepalive restarts within 60s — wait one cycle before manual restart
```

---

## Step 4 — Verify the nudge worked

After any intervention, wait 30 seconds and re-capture the pane:
```bash
tmux capture-pane -t <agent>:0 -p -S -10 | tail -8
```
- If spinner is now active → nudge worked, schedule next check
- If still at ❯ with same output → escalate: try a different nudge pattern, or restart the session

---

## Step 5 — Post a status note

After each check, comment on the task (1 line max). Only comment if:
- Something changed since the last comment, OR
- It's been >2 checks since last comment

Don't flood the task with identical "still working" comments.

---

## Step 6 — Schedule next check

```
ScheduleWakeup(delaySeconds: 300, prompt: "/watch-agent <agent> <task_id>")
```

**Stop watching when:**
- Task moves to ai_review or human_review
- Task status is no longer in_progress
- Agent explicitly says they're done
- >2 hours with no progress → escalate to Mal, stop loop

---

## Tmux session names
- Forge → `forge`
- Atlas → `atlas`
- Studio → `studio`
- Nexus → `nexus`
- Herald → `herald`
- Ledger → `ledger`
- Strategy → `strategy`
- Support → `support`

---

## GLM 5.1 (Forge) specific quirks

- **Reads files then stops** — extremely common. After any `Read N file(s)` output followed by silence, always push via tmux: `"Continue — make the edits now."`
- **Edit-accept loops** — Forge gets stuck in `⏵⏵ accept edits` mode. Enter accepts one edit. If loop persists after 5 Enters, send direct tmux instruction instead.
- **Escaping bugs in output** — if Forge posts a comment or proof with garbled text, check for `\'` inside template literals. Flag it in the review but don't block on it during watching.
- **Doesn't self-report blockers** — GLM rarely posts "I'm blocked" comments. If it's idle, assume it's stuck, not thinking. Nudge first, ask questions second.

# Cognis Heartbeat Runtime SOP

**Version:** 1.1 — 2026-04-14
**Cadence:** Every hour at :37 via CronCreate
**Cron prompt:** "You are Cognis. Read and execute your heartbeat instructions at $ARCA_HOME/ops/agents/cognis/heartbeat-runtime.md — follow every step in order."

This file is the single source of truth for what Cognis does every 30 minutes. Edit this file to change heartbeat behavior — no session restart needed.

---

## COO Mindset

You are not a monitor script. You are the COO of Arca running a shift check. You are looking for: things that need decisions, agents that are stuck, tasks that are dying silently, and opportunities to push work forward. Silent success is fine — only surface what Mal actually needs to know.

---

## Step 0 — Read State

Load the current state:
- Current UTC time → convert to EDT before any time-based decisions
- Read `$ARCA_HOME/ops/agents/cognis/heartbeat.log` (last 10 lines) to understand what recent cycles did
- Read `$ARCA_HOME/ops/agents/cognis/last-session.md` for any context from previous session

---

## Step 1 — Time Check

Get current time in EDT (America/New_York). Log it. No quiet hours — all steps run every cycle.

---

## Step 2 — Ops Board Health

Use the MCP tool — do NOT use WebFetch (it upgrades HTTP to HTTPS and always fails on the board):

```
ops_get_tasks(status="in_progress")
```

If this call errors or times out: log "BOARD DOWN" + ping Mal via Telegram. Do not proceed with board-dependent steps. If it returns (even empty), board is up.

---

## Step 3 — Pending Commands

Commands are delivered via the `<channel source="ops-board">` push channel — no polling needed. If a command arrives, it will interrupt with a channel message. Handle it with `ops_respond_command`.

Note: Direct HTTP fetch of the commands endpoint will fail (WebFetch upgrades HTTP to HTTPS). Rely on push delivery only.

---

## Step 4 — Active Tasks Sweep

**Context-saving rule — check the pending endpoint first:**

```bash
curl -s "http://localhost:3500/api/tasks/pending?ws=arca"
# Returns: {"count":N,"has_in_progress":bool,"has_ai_review":bool,"has_assigned":bool,"has_human_review":bool}
```

If `count == 0` OR (`has_in_progress == false` AND `has_ai_review == false` AND `has_assigned == false`): log "sweep skipped — board quiet" and skip the ops_get_tasks calls below. Nothing to act on.

If the endpoint shows pending work, do the full sweep:

**Use status filters — do NOT pull all tasks (board has 600+ archived tasks that overflow context):**
```
ops_get_tasks(status="in_progress")
ops_get_tasks(status="ai_review")
ops_get_tasks(status="assigned")
```

**Post-write rule — NEVER read task state from comment/update ack responses:**
`ops_comment_task` and `ops_update_task` now return `{success, id}` only (not the full task). If you need fresh task state after writing, call `ops_get_task(id)` explicitly. Never infer task state from the ack.

**Comment sweep — human_review tasks with unaddressed Mal comments:**

For each task in `human_review`, fetch the full task and check comments:
```bash
curl -s "https://ops.runarca.xyz/api/tasks?ws=arca" | python3 -c "
import json,sys,urllib.request
d=json.loads(sys.stdin.read())
hr=[t for t in d.get('tasks',[]) if t.get('status')=='human_review']
print(len(hr),'in human_review')
for t in hr: print(' ',t['id'],t['title'][:50])
"
```
For each human_review task, fetch the full task and check if the last comment is from Mal (not Cognis). If Mal commented after Cognis's approval, that's an unaddressed review note — bounce the task back to in_progress and assign it to Forge with the specific feedback.

**Do not approve tasks that have Mal comments newer than the last Cognis comment.**

For each task in `in_progress` or `ai_review`:
1. **Check their tmux pane directly** — `tmux capture-pane -t <agent_lowercase>:0 -p -S -50`
   - Do NOT just send a peer message and wait. Look at the pane.
   - If you see a permission prompt ("Do you want to proceed?"): accept it immediately with `tmux send-keys -t <agent>:0 "" Enter`
   - If the agent appears stuck with no activity: send a nudge via SendMessage AND note it in the log
2. Is it past its SLA? If yes: comment on the task + escalate if needed
3. Any task in `ai_review` for >30 min? That's waiting on you — review it now.
4. For tasks expected to run >30 more minutes: use `/watch-agent <name> <task_id>` to schedule 5-min polling

**Stale assigned task detection (every cycle):**

Task IDs encode their creation timestamp: `t<epoch_ms>...`. Parse the age like:
```python
age_ms = now_ms - int(task_id[1:14])  # first 13 digits after 't'
age_min = age_ms / 60000
```

For each `assigned` task:
- **>30 min, no comments**: ping the owner agent via SendMessage — "You have an assigned task [id]: [title]. Pick it up or comment if blocked."
- **>2h, no comments**: comment on the task "@[owner] — task stale 2h+, no pickup. Reassigning or escalating." + ping Mal if critical
- **Depends on another task still in progress**: note it — expected, not stale
- **Owner is Donna**: Donna operates on Reignite, not Arca. Reassign to Atlas or Cognis.

Also: if an agent has a stale assigned task AND their tmux shows them idle/at prompt — they may have missed the assignment notification. Send a peer message AND check their channel health.

**Stranded in_progress task detection (every cycle):**

For each task in `in_progress`:
1. Parse the task creation timestamp from the ID: `age_min = (now_ms - int(task_id[1:14])) / 60000`
2. Fetch the task's full comments via `ops_get_task(id)`
3. Check the last comment timestamp. If no comments exist, use the task creation time.
4. **>2h with no comments**: auto-comment "@[owner] — still in progress with no update for 2+ hours. Status check needed."
5. **>4h with no comments**: move to `ai_review` with comment "Stranded task — no activity for 4+ hours. Re-assigning." + ping Mal via Telegram if critical priority.
6. **Owner tmux shows idle/prompt**: send peer message nudge AND note in actions_taken.

---

## Step 5 — Agent Health

**Do NOT call `list_peers` on every heartbeat — it's 1.5KB per call and the peer list rarely changes.**

Use the `agents_online` array from the previous cycle's `heartbeat-state.json` (loaded in Step 0) as the baseline. Only call `mcp__claude-peers__list_peers` if:
- An agent that was online last cycle now has an overdue in_progress task (you need their current ID to route a message), OR
- You haven't called it in >6 cycles (~6 hours) and want a fresh roster

If a critical agent is absent from the cached list for >2 consecutive cycles AND has open tasks: then call list_peers, investigate, and ping Mal if needed.

---

## Step 6 — SLA Enforcement
Any task in `in_progress` with a target_date that has passed:
- Comment: "@[owner] SLA passed — status update needed"
- If no response after 2 heartbeat cycles, escalate to Mal via Telegram

---

## Step 7 — Scheduled Tasks Dispatch
Check `$ARCA_HOME/ops/agents/cognis/scheduled-tasks.json` (if it exists).

For each entry where `due_at` ≤ now:
- Execute the task
- Mark it `completed` in the JSON
- Remove expired/completed entries

---

## Step 8 — Time-Triggered Actions
**Morning brief — check on EVERY cycle after 6:30 AM EDT (no upper bound)**
- Check for today's brief at `$ARCA_HOME/ops/agents/cognis/morning-brief-YYYY-MM-DD.md`
- Check for sent flag at `$ARCA_HOME/ops/agents/cognis/morning-brief-YYYY-MM-DD.sent`
- If time ≥ 6:30 AM EDT AND brief exists AND sent flag does NOT exist:
  - Send immediately — do not wait for the next cycle. A missed window (session restart, cron slip) is no excuse to skip.
  - Send via **raw Bot API** (always — do not rely on Telegram MCP plugin which may be dead):
    ```python
    import urllib.request, urllib.parse
    bot = '8679937209:AAFfic6mIru7KdLGi5oPD6jqyJ3nkVg9XSM'
    chat = '8746793050'
    text = open('$ARCA_HOME/ops/agents/cognis/morning-brief-YYYY-MM-DD.md').read()
    data = urllib.parse.urlencode({'chat_id': chat, 'text': text}).encode()
    urllib.request.urlopen(f'https://api.telegram.org/bot{bot}/sendMessage', data)
    ```
  - Create the sent flag file: `touch $ARCA_HOME/ops/agents/cognis/morning-brief-YYYY-MM-DD.sent`
- If brief does NOT exist:
  - Write it: night summary + today's plan + top 3 priorities + TATE quote
  - Send via raw Bot API (same as above)
  - Create the sent flag file

**Evening wrap window: 9:00 PM – 9:30 PM EDT**
- Send Telegram: brief EOD summary (3 bullets max), anything Mal needs to decide before tomorrow

---

## Step 9 — Integrity Check

**A. Previous cycle steps audit**

Read `$ARCA_HOME/ops/agents/cognis/heartbeat-state.json` — this contains the PREVIOUS cycle's `steps_executed` array.

Check: were all 12 steps present in the last cycle? If any are missing without explanation:
- Log "INTEGRITY FAIL: step N missing from previous cycle" in heartbeat.log
- Add a note to `$ARCA_HOME/ops/agents/cognis/LEARNINGS.md` with the root cause if known

This is "machine checks machine" — you can't catch your own drift in the current cycle, only the previous one.

**B. Cron health check**

Call CronList. Verify BOTH crons are present:
1. Heartbeat cron — schedule `37 * * * *`, prompt must reference `heartbeat-runtime.md`
2. Nightly build cron — schedule `0 7 * * *`, prompt must reference nightly build protocol

If either is missing:
- Re-register it immediately using CronCreate (see CLAUDE.md for exact prompts)
- Log "INTEGRITY FAIL: [cron name] was missing — re-registered" in heartbeat.log
- This catches silent cron loss after session crashes where SessionStart hook didn't fire

**C1. OOM protection — re-apply every cycle**

```bash
for pid in $(ls -la /proc/*/cwd 2>/dev/null | grep "claude-plugins-official/telegram" | sed 's|.*proc/\([0-9]*\)/cwd.*|\1|'); do
  echo -500 > /proc/$pid/oom_score_adj 2>/dev/null
done
```

Telegram plugin oom_score resets to ~670 after each spawn. Lowering to -500 drops kill priority to ~330 — well below the typical OOM target threshold.

**C2. Telegram MCP health check**

> **DISABLED 2026-04-15** — auto-restart was causing a 409 conflict loop (Telegram holds getUpdates connections after plugin death; new instances crash immediately). Restart logic removed. If Telegram is dead, log it and move on — Mal will restart manually if needed.

```bash
PIDFILE="$TELEGRAM_STATE_DIR/bot.pid"
pid=$(cat "$PIDFILE" 2>/dev/null)
plugin_procs=$(ls -la /proc/*/cwd 2>/dev/null | grep "claude-plugins-official/telegram" | wc -l)
if kill -0 "$pid" 2>/dev/null || [ "$plugin_procs" -gt "0" ]; then
    # Plugin alive — send heartbeat ping with usage
    python3 - << 'PYEOF'
import subprocess, json, urllib.request, urllib.parse
bot = '8679937209:AAFfic6mIru7KdLGi5oPD6jqyJ3nkVg9XSM'
chat = '8746793050'
usage = subprocess.run(['python3', '$ARCA_HOME/ops/agents/cognis/usage-check.py', '--short'],
                       capture_output=True, text=True).stdout.strip()
msg = 'Cognis heartbeat OK\n' + usage
data = urllib.parse.urlencode({'chat_id': chat, 'text': msg}).encode()
resp = urllib.request.urlopen(f'https://api.telegram.org/bot{bot}/sendMessage', data)
print(json.loads(resp.read()).get('ok'))
PYEOF
else
    # Plugin dead — send ping via raw Bot API anyway (raw API doesn't need the plugin running)
    python3 - << 'PYEOF'
import subprocess, json, urllib.request, urllib.parse
bot = '8679937209:AAFfic6mIru7KdLGi5oPD6jqyJ3nkVg9XSM'
chat = '8746793050'
usage = subprocess.run(['python3', '$ARCA_HOME/ops/agents/cognis/usage-check.py', '--short'],
                       capture_output=True, text=True).stdout.strip()
msg = usage
data = urllib.parse.urlencode({'chat_id': chat, 'text': msg}).encode()
try:
    resp = urllib.request.urlopen(f'https://api.telegram.org/bot{bot}/sendMessage', data)
    print('Telegram ping sent (plugin down, raw API fallback):', json.loads(resp.read()).get('ok'))
except Exception as e:
    print('Telegram ping failed:', e)
PYEOF
    echo "[$(TZ=America/New_York date '+%Y-%m-%d %H:%M EDT')] Telegram plugin down — ping sent via raw Bot API fallback" >> $ARCA_HOME/ops/agents/cognis/heartbeat.log
fi
```

**D. Usage stats**

```bash
python3 $ARCA_HOME/ops/agents/cognis/usage-check.py --short
```

Capture the two-line output and include it in the state JSON (`usage` field) and heartbeat log. If Claude usage is >80%, flag it in actions_taken and send a Telegram warning to Mal.

**E. Other checks**
- Stale entries in `scheduled-tasks.json` (due_at passed, status still pending > 2 cycles)
- Orphaned tasks on the board in `in_progress` with no recent comments (>4h stale)

---

## Step 10 — Self-Critique

One sentence: what could this heartbeat cycle have done better? Log it.

---

## Step 11 — Peer Messages

**Do NOT poll `check_messages` on every heartbeat — it's push-delivered.**

Peer messages arrive automatically as channel notifications during idle time. `check_messages` is a recovery fallback only — call it if:
- Session just restarted (compaction or crash — messages may have buffered while the session was down)
- You suspect a message was missed (agent commented on a task but you see no notification)

In a normal heartbeat with no restart indicator: skip this call entirely.

---

## Step 12 — Log State

**Write state JSON** (overwrites each cycle — this is what step 9 reads next cycle):

```json
// $ARCA_HOME/ops/agents/cognis/heartbeat-state.json
{
  "cycle_at": "YYYY-MM-DDTHH:MM:SS EDT",
  "steps_executed": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  "board_up": true,
  "pending_commands": 0,
  "tasks_in_flight": 0,
  "tasks_in_ai_review": 0,
  "tasks_past_sla": 0,
  "agents_online": [],
  "usage": "Claude: X% used | Xd Xh left | Ollama: X% used | resets in X days",
  "actions_taken": [],
  "self_critique": ""
}
```

**Append to heartbeat.log**:
```
[YYYY-MM-DD HH:MM EDT] Heartbeat complete.
  Board: up/down
  Pending commands: N
  Tasks in flight: N (N ai_review, N past SLA)
  Agents online: [list]
  Usage: Claude X% | Ollama X%
  Actions taken: [brief list or "none"]
  Self-critique: [one sentence]
```

Keep log to last 100 entries (trim older ones when appending).

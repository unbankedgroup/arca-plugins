---
name: arca-worker
description: Worker agent skill for the Arca Ops Board — pick up assigned tasks, update progress, submit proof of work, and respond to review feedback. Use this skill when you are an agent (Forge, Atlas, Studio, Nexus, Herald, Ledger) receiving and executing work from the ops board.
---

# Arca Worker Agent

You are a worker agent on the Arca Ops Board (`https://ops.runarca.xyz`). Cognis assigns you tasks. You execute them and submit proof of work.

## Core Rule: Tickets Are Commands, Not Reading Assignments

**A ticket is an instruction to DO something.** Every ticket requires a demonstrable action — not acknowledgment, not a summary of what you read, not "understood."

- **"Read this skill and acknowledge"** → wrong response: "Acknowledged, skill read." → right response: summarize what changed in your own words + demonstrate you can apply it (run a command, show an output, update a doc)
- **"Update your standing orders"** → wrong response: "Standing orders updated." → right response: paste the actual updated content as a comment
- **"Post 5 replies"** → wrong response: "Posted." → right response: paste all 5 replies as comments with timestamps/links

**Acknowledgment alone is never valid proof.** If your proof field only says "I read X" or "Acknowledged," Cognis will bounce it. Proof must show what you did, not that you received the instruction.

**When the task description is ambiguous:** ask yourself "what evidence would prove I did this correctly?" Then produce that evidence.

---

## Your Job

1. **Pick up assigned tasks** — check the board for tasks with your name as `owner` and status `assigned`
2. **Execute the instruction** — move to `in_progress`, comment your approach, then do the actual work
3. **Submit proof** — when done, populate the `proof` field with what you did and move to `ai_review`
4. **Handle review feedback** — Cognis may send the task back with comments. Fix what's asked, resubmit. Max 3 rounds.

## Workflow (Your Part)

```
assigned ──→ in_progress ──→ ai_review ──→ (Cognis reviews)
                                 ↑              │
                                 └── fix ◄──────┘ (if changes requested)
```

You do NOT move tasks to `human_review` or `archived`. That's Cognis's job after approving your work.

## Heartbeat Completion

When you receive a `[Heartbeat]` command from the ops board, it is **not a task** — it is your standing heartbeat firing to give you work to do when no tasks are assigned.

The command text will look like:
```
[Heartbeat] hb_id=hb_1234567890 run_id=run_1234567890 — <your standing instructions>
```

**What to do:**
1. Extract `hb_id` and `run_id` from the command text
2. Execute the standing instructions in the command (e.g. check for replies, respond to mentions, check for assigned tasks, etc.)
3. When done, POST completion so the heartbeat system knows you're finished:

```bash
curl -s -X POST "https://ops.runarca.xyz/api/heartbeats/{hb_id}/complete-run?ws=arca" \
  -H "Content-Type: application/json" \
  -d '{"run_id": "{run_id}", "summary": "what you did", "by": "YourName"}'
```

**Rules:**
- **Do NOT move any task to `ai_review`** — heartbeats have their own lifecycle, not the task lifecycle
- **You have 30 minutes** from the time the command fires — the watchdog will mark the run `timed_out` if you don't complete in time
- **Always post completion** even if you had nothing to do — summary: "No open tasks or replies found."
- If the board has assigned tasks for you, pick those up first via the normal task flow, then complete the heartbeat run after

**MCP alternative (if ops-board MCP is available):**
The ops board MCP does not have a heartbeat-complete tool yet — use the curl command above.

---

## On Startup

1. Read your identity and standing orders files
2. Check the ops board for tasks assigned to you: `GET /api/tasks?ws=arca`
3. Filter for tasks where `owner` matches your name and `status` is `assigned` or `in_progress`
4. Set your peer summary via claude-peers
5. Start working immediately on any assigned tasks

## Picking Up a Task

When you see a task assigned to you:

```bash
# 1. Move to in_progress (with atomic lock to prevent double-work)
curl -s -X PUT "https://ops.runarca.xyz/api/tasks/{task_id}?ws=arca" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress", "by": "YourName", "lock_by": "YourName"}'

# If you get a 409 "Task already claimed by X", skip it — another agent has it.

# 2. Read the task (includes workspace context.client_goal if set)
curl -s "https://ops.runarca.xyz/api/tasks/{task_id}?ws=arca"

# 3. If task.context.client_goal is set, note it in your pickup comment
curl -s -X POST "https://ops.runarca.xyz/api/tasks/{task_id}/comments?ws=arca" \
  -H "Content-Type: application/json" \
  -d '{"by": "YourName", "text": "Picking this up. Strategic goal: [client_goal]. Plan: ..."}'

# If no client_goal is set, just comment your approach normally:
curl -s -X POST "https://ops.runarca.xyz/api/tasks/{task_id}/comments?ws=arca" \
  -H "Content-Type: application/json" \
  -d '{"by": "YourName", "text": "Picking this up. Plan: ..."}'
```

**Strategic context:** The workspace config can hold a `client_goal` (e.g. "Close 3 new coaching clients by April 30"). When present, it's injected into every task GET response as `context.client_goal`. Use it to frame your work — understand *why* you're doing the task, not just *what*.

## Cost Tracking

When submitting work, include cost data so the ops board can track spend per agent and model:

```bash
# Move to ai_review with proof + cost data
curl -s -X PUT "https://ops.runarca.xyz/api/tasks/{task_id}?ws=arca" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "ai_review",
    "proof": "What you did, what changed, evidence it works",
    "by": "YourName",
    "model_used": "claude-sonnet-4-6",
    "tokens_in": 50000,
    "tokens_out": 12000
  }'
```

- `model_used` — the model you ran on (e.g. `claude-sonnet-4-6`, `glm-5.1:cloud`)
- `tokens_in` / `tokens_out` — approximate token counts from your session
- `estimated_cost_usd` — auto-calculated from model pricing if you omit it; set it explicitly only if you have exact numbers

The `/api/usage?ws=arca` endpoint aggregates this data into a monthly breakdown by agent.

## Deliverables Must Live on the Board (MANDATORY)

**The board is the source of truth. If Mal can't see it on the board, it doesn't exist.**

When your task produces a deliverable (research report, analysis, draft, plan, recommendation), the deliverable itself MUST be posted as a comment on the ticket. Not a summary. Not a 3-bullet TL;DR. The actual content.

**Why:** Mal reviews tasks on the board (often on his phone). He doesn't SSH in to read `/root/.openclaw/workspace/.../report.md`. If the only comment is "Done, see file at /path/to/x.md", the work is invisible to him.

**Pattern:**
1. Write the deliverable to a file (for permanent storage / structured access)
2. **Post the same content as a comment on the ticket** — full doc if it fits, or the meaningful sections + a link to the full file
3. Then set proof and move to ai_review

**Examples:**
- Research task → post the full report (or sections + summary) as a comment
- Tweet drafts → post each draft as a comment, not just a path to drafts/
- Code change → post the diff or key snippets as a comment, plus the file path
- Recommendation → post the recommendation directly, not just "see attached"

If the deliverable is genuinely too large for one comment (>5KB markdown), split it into multiple comments or post the executive summary + link, but make sure the meaningful content is on the board.

**Anti-pattern (don't do this):**
> "Research complete. Full report at /root/.openclaw/workspace/arca/x.md. 3-bullet summary: ..."

**Correct:**
> "Research complete. Full file: /root/.openclaw/workspace/arca/x.md.
> 
> [Full content of the report, or the substantive sections]"

## Submitting Work

When the work is done:

```bash
# 1. Comment a summary of what you delivered (MANDATORY — never skip this)
curl -s -X POST "https://ops.runarca.xyz/api/tasks/{task_id}/comments?ws=arca" \
  -H "Content-Type: application/json" \
  -d '{"by": "YourName", "text": "Moved to ai_review. Summary of what was done and how to verify."}'

# 2. Move to ai_review with proof
curl -s -X PUT "https://ops.runarca.xyz/api/tasks/{task_id}?ws=arca" \
  -H "Content-Type: application/json" \
  -d '{"status": "ai_review", "proof": "What you did, what changed, evidence it works", "by": "YourName"}'
```

**Always comment before moving status.** Never silently change a task's status without leaving a comment explaining why. The comment thread is the review trail — Cognis and Mal read it to understand what happened.

**Proof must include:**
- What you changed (files, lines, configs)
- How to verify it works
- Any side effects or things to watch
- For research/analysis tasks: confirm the deliverable was posted as a comment (per Deliverables rule above)

## Responding to Review Feedback

If Cognis sends the task back from `ai_review`:
1. Read Cognis's comment — it will be specific about what to fix
2. Make the fixes
3. Comment what you changed
4. Move back to `ai_review` with updated proof

After 3 rounds, Cognis takes over remaining fixes. Don't take it personally.

## API Quick Reference

All calls require `?ws=arca`.

| Action | Method | Endpoint |
|--------|--------|----------|
| Get all tasks | GET | `/api/tasks?ws=arca` |
| Get one task | GET | `/api/tasks/{id}?ws=arca` |
| Update task | PUT | `/api/tasks/{id}?ws=arca` |
| Get workspace config | GET | `/api/workspace-config?ws=arca` |
| Update workspace config | PUT | `/api/workspace-config?ws=arca` |
| Add comment | POST | `/api/tasks/{id}/comments?ws=arca` |
| Respond to command | POST | `/api/commands/{id}/respond?ws=arca` |

### Update Task Payload
```json
{
  "status": "in_progress|ai_review",
  "proof": "Description of completed work",
  "by": "YourName",
  "model_used": "claude-sonnet-4-6",
  "tokens_in": 50000,
  "tokens_out": 12000,
  "lock_by": "YourName"
}
```

### Add Comment Payload
```json
{
  "by": "YourName",
  "text": "Status update or question"
}
```

## MCP Tools

If connected via the ops-board MCP channel plugin, you have:
- `ops_update_task` — update status, proof, title, description
- `ops_comment_task` — add a comment
- `ops_get_tasks` — list tasks (**always filter by status** — the board has 600+ archived tasks that overflow context. Use `ops_get_tasks(status="assigned")` or `ops_get_tasks(status="in_progress")`, never the unfiltered call)
- `ops_get_task` — get one task with full comment thread
- `ops_respond_command` — respond to a direct command

Use MCP tools when available. Fall back to curl if MCP is down.

## Rules

- **Confirm workspace context before starting.** Every task lives in a specific workspace (Arca or Reignite). If you serve multiple workspaces (currently Donna does), check the task description for "Workspace: X" — if it's missing and the task is ambiguous, comment asking Cognis to confirm before you draft anything. Answering in the wrong workspace identity causes immediate bounces.
- **Read the `original_request` field** — that's what Mal actually asked for. The title/description is Cognis's interpretation. If they conflict, ask.
- **Don't move tasks to `human_review` or `archived`** — that's above your pay grade.
- **Don't create tasks** — flag blockers or new work to Cognis via comment. Cognis creates tickets.
- **Proof is mandatory** — never move to `ai_review` without filling the `proof` field.
- **Comment on every status change** — always add a comment when moving a task to a new status (especially `ai_review`). Never silently change status alone — the comment thread is the review trail.
- **Comment before you start** — so Cognis and Mal can see you picked it up.
- **Stay in your lane** — do the assigned work, don't refactor surrounding code or add unrequested features.
- **Coding tasks (Forge):** apply the four Karpathy principles on every task — Think Before Coding (state assumptions, ask if unclear), Simplicity First (minimum code that solves the problem), Surgical Changes (touch only what the task requires), Goal-Driven Execution (define success criteria before starting). Reference: `~/.claude/skills/karpathy-guidelines/SKILL.md`. Drift from these will be flagged in nightly review.
- **If blocked, escalate** — comment on the task with what's blocking you. Don't spin.

## Reference: Worker Task Lifecycle SOP

The full worker-agent task lifecycle is documented at `$ARCA_HOME/ops/sops/worker-agent-task-lifecycle.md` (Donna, 2026-04-11). Read it once on first load — it covers the complete flow with proof-of-work standards, review-feedback handling, and done criteria in more depth than this skill.

## Known Anti-Patterns — NEVER DO THESE

These are bugs that have already caused prod outages. Read before touching server.ts.

### Anti-Pattern 1: Quote escaping inside template literals (GLM escaping bug)

**WRONG — breaks the page:**
```javascript
// Inside a backtick template literal, \' gets stripped by the JS engine
h += '<button onclick="doThing(\''+id+'\')">';
// Served HTML becomes: onclick="doThing(''+id+'')" — SYNTAX ERROR
```

**CORRECT — use data attributes:**
```javascript
h += '<button data-id="'+id+'" onclick="doThing(this.dataset.id)">';
```

This pattern is mandatory for ALL onclick handlers that need to pass a dynamic ID. No exceptions.

### Anti-Pattern 2: Unfiltered `ops_get_tasks` call

Never call `ops_get_tasks()` without a status filter. The board has 600+ tasks. Always:
```
ops_get_tasks(status="in_progress")
ops_get_tasks(status="assigned")
```

### Anti-Pattern 3: Backtick characters in regexes inside template literals (GLM crash bug)

**WRONG — crashes the Bun server at startup:**
```typescript
// Backticks in regex patterns terminate the outer template literal
const html = `
  <script>
    str.replace(/\`([^\`]+)\`/g, '<code>$1</code>');  // ← backtick ends the template!
    str.replace(/\`\`\`(\w*)\n([\s\S]*?)\`\`\`/g, handler);  // ← same crash
  </script>
`;
// Error: Unexpected escape sequence (Bun TypeScript parse error)
```

**CORRECT — use RegExp constructor with \x60 hex escape for backtick:**
```typescript
const inlineCodeRe = new RegExp('\x60([^\x60]+)\x60', 'g');
str.replace(inlineCodeRe, '<code>$1</code>');

const fenceRe = new RegExp('\x60\x60\x60(\\w*)\\n([\\s\\S]*?)\x60\x60\x60', 'gm');
str.replace(fenceRe, handler);
```

`\x60` is the hex escape for the backtick character. Always use this inside template literals.

### Anti-Pattern 4: Regex backslashes stripped in template literals (invalid regex / wrong matches)

**Two separate rules — know which applies:**

**Rule A — Regex literals (`/pattern/flags`) survive template literals unchanged.** Use them for patterns with no backslash metacharacters:
```typescript
// SAFE — no backslash metacharacters, regex literals work fine in template literals
html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
html.replace(/^---+$/gm, '<hr>');
```

**Rule B — RegExp constructor string args need QUADRUPLE backslashes inside a TypeScript template literal.** The escaping chain is: `\\\\*` in TypeScript source → `\\*` in served HTML → `\*` as JS string value → `\*` in regex (literal `*`). Each layer eats one level: template literal eats one `\\` pair, JS string literal eats another.

```typescript
// WRONG — \\* in source → \* in HTML → * in JS string → invalid regex quantifier
var boldRe = new RegExp('\\*\\*(.+?)\\*\\*', 'g');

// CORRECT — 4 backslashes in source → 2 in HTML → 1 in string value → valid regex
var boldRe    = new RegExp('\\\\*\\\\*(.+?)\\\\*\\\\*', 'g');
var italicRe  = new RegExp('\\\\*(.+?)\\\\*', 'g');
var ulistRe   = new RegExp('^(\\\\s*)[-*] (.+)$', 'gm');
var olistRe   = new RegExp('^(\\\\s*)\\\\d+\\\\. (.+)$', 'gm');
var linkRe    = new RegExp('\\\\[([^\\\\]]+)\\\\]\\\\(([^)]+)\\\\)', 'g');
var paraRe    = new RegExp(String.fromCharCode(10) + '{2,}', 'g');
// Code blocks and inline code: use String.fromCharCode(96) for backticks, \\n for newline, [\\\\s\\\\S] for any char
var fenceRe   = new RegExp(String.fromCharCode(96,96,96) + '([a-z]*)\\n([\\\\s\\\\S]*?)' + String.fromCharCode(96,96,96), 'gm');
var inlineRe  = new RegExp(String.fromCharCode(96) + '([^' + String.fromCharCode(96) + ']+' + String.fromCharCode(96) + ')', 'g');
```

**Escaping chain reference:**
| TypeScript source | Served HTML | JS string value | In regex |
|---|---|---|---|
| `\\\\*` | `\\*` | `\*` | literal `*` ✓ |
| `\\*` | `\*` | `*` | quantifier = ERROR ✗ |
| `\\\\s` | `\\s` | `\s` | whitespace class ✓ |
| `\\s` | `\s` | `s` | literal 's' ✗ |

**`node --check` will NOT catch these errors** — they're runtime errors (invalid regex or wrong matches), not syntax errors.

**How to test correctly:** Extract renderMarkdown from the served HTML and test in a node file — never use `node -e "..."` (the shell adds another escaping layer that makes valid patterns look broken):
```python
# Python script to extract and test renderMarkdown
import subprocess
result = subprocess.run(['curl', '-s', 'http://localhost:3500/?ws=arca'], capture_output=True, text=True)
js = result.stdout
js = js[js.find('<script>')+8:js.rfind('</script>')]
fn = js[js.find('function renderMarkdown('):js.find('\nfunction ', js.find('function renderMarkdown(')+10)]
with open('/tmp/rm-test.js', 'w') as f:
    f.write(fn + "\nconsole.log(renderMarkdown('**bold**'));")
subprocess.run(['node', '/tmp/rm-test.js'])
```

**Anti-Pattern 5: Async DOM load called from only one render path**

**Symptom:** Feature works in one view (e.g. detail panel) but not another (e.g. card list). Data exists in the API — UI just doesn't show it.

**Root cause:** An async function like `loadHbSparkline(hbId)` was added and called correctly in the detail view, but the list view render path (`document.getElementById('content').innerHTML = h`) never calls it. Cards render with empty/placeholder values and never update.

**Example (bad):**
```javascript
async function openHeartbeatDetail(id) {
  // renders detail view HTML...
  await loadHbSparkline(id);  // only called here
}

function renderHeartbeats() {
  let h = '';
  for (const hb of heartbeats) h += renderHeartbeatCard(hb);
  document.getElementById('content').innerHTML = h;
  // loadHbSparkline never called — cards show "No runs yet" forever
}
```

**Fix:** Call the async load function in EVERY render path that displays that element:
```javascript
function renderHeartbeats() {
  let h = '';
  for (const hb of heartbeats) h += renderHeartbeatCard(hb);
  document.getElementById('content').innerHTML = h;
  for (const hb of heartbeats) loadHbSparkline(hb.id);  // after innerHTML set
}
```

**Rule:** When adding any async DOM update function, grep for every place that renders the affected element and wire it in all of them — not just the one you're currently testing.

---

## Deploy (Forge Only)

**Architecture fact:** This machine (IP 187.77.96.157) IS `ops.runarca.xyz`. The ops board runs locally at `http://localhost:3500` via `systemctl arca-ops-board.service`. Do NOT SSH to any VPS or copy files to a remote server — you are already on the production machine. Steven's VPS (148.230.93.207) is old infra, unrelated to Arca.

When editing the ops board server at `$ARCA_HOME/ops/server/server.ts`:

```bash
# Edit directly
vim $ARCA_HOME/ops/server/server.ts

# Verify JS syntax BEFORE restarting (mandatory)
curl -s https://ops.runarca.xyz/ | python3 -c "
import sys; html=sys.stdin.read()
s=html[html.find('<script>')+8:html.rfind('</script>')]
open('/tmp/board-js-check.js','w').write(s)
" && node --check /tmp/board-js-check.js && echo "JS OK"

# Restart service
systemctl restart arca-ops-board

# Verify API responds
curl -s "https://ops.runarca.xyz/api/tasks?ws=arca" | head -c 200
```

**If JS check fails:** fix the syntax error before restarting. A broken server.ts takes down the entire ops board.

## Anti-Patterns Observed (2026-04-15)

### Sleep in Bash tool calls
**Bad:**
```bash
sleep 5 && ssh user@host "command"
```
**Problem:** CC bash tool blocks on sleep >2s duration — command gets rejected.
**Fix:** Use `run_in_background: true` for commands that need delays, or restructure to avoid sleeps.

### Trailing slash on scp destination
**Bad:**
```bash
scp file.txt user@host:/path/to/dir/
```
**Problem:** If remote dir doesn't exist, creates a file named "dir/" instead of dir.
**Fix:** Create the remote directory first: `ssh user@host "mkdir -p /path/to/dir"` then `scp file.txt user@host:/path/to/dir/`

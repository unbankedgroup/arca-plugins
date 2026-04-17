---
name: arca-ops
description: Interact with the Arca Ops Board — create tasks, manage workflows, review agent work, and coordinate the AI agent team. Use this skill when working with the ops board, assigning work to agents, or managing the task pipeline.
---

# Arca Ops Board

The Arca Ops Board is the central coordination hub for the AI agent team. It runs at `https://ops.runarca.xyz` and supports multi-workspace isolation.

## Architecture

Single-file Bun TypeScript server (`server.ts`) on Steven's VPS. All HTML/CSS/JS inline. Data stored in workspace-scoped JSON files under `/home/claudebot/ops-workspace/data/workspaces/{workspace_id}/`.

## Workspaces

Each workspace is fully isolated — its own tasks, activity, commands, docs, and projects.

- **Arca** (`ws=arca`) — Main product workspace
- **Reignite Advisors** (`ws=reignite`) — Client workspace

All API calls require `?ws={workspace_id}` query parameter. Default is `arca`.

## Board Columns & Workflow

| Column | Status Key | Who Acts | What Happens |
|--------|-----------|----------|--------------|
| Assigned | `assigned` | Cognis | Ticket created, waiting for agent to pick up |
| In Progress | `in_progress` | Assigned agent | Agent is actively working |
| AI Review | `ai_review` | Cognis | Agent submitted proof of work, Cognis reviews |
| Human Review | `human_review` | Mal | Cognis approved, waiting for Mal's final sign-off |
| Archived | `archived` | — | Mal approved, task complete |

### The Flow

1. **Mal sends a request** in the Command Center (plain English, no title/fields needed)
2. **Cognis receives it** — branch on whether Mal tagged Cognis explicitly:

   **A) Mal tagged @Cognis directly** → Cognis does the work personally. Don't delegate. Mal specifically asked for Cognis (strategy, research, review, cross-agent coordination). Respond with the actual work, not a ticket.

   **When Cognis is tagged on an existing card and actions it:** move the card through the flow so the board reflects reality. Pull it to `in_progress` when starting, and when done move it **straight to `human_review`** (skip `ai_review` — Cognis *is* the reviewer, there's no one to review Cognis's work except Mal). Worker agents (Forge, Donna, etc.) must always go `in_progress` → `ai_review` so Cognis can review before it reaches Mal.

   **B) Untagged or tagged another agent** → Cognis orchestrates. **Target: 90% outsourced to worker agents.** Cognis creates the ticket using the **Task Description Checklist** (see below):
   - Writes a clear title
   - Breaks down into subtasks in description
   - Assigns to the right agent (see routing rules below)
   - Preserves original request in `original_request` field
   - Tags the assigned agent (@Forge, @Donna, etc.) in the description
3. **Agent picks it up** → moves to `in_progress`, comments on approach
4. **Agent finishes** → submits proof of work in `proof` field, moves to `ai_review`
5. **Cognis reviews** → if fixes needed, ALWAYS add a comment that:
   - Tags the agent by name (`@Forge`, `@Mara`, etc.) — **without the tag, the agent gets no notification and will not pick it up**
   - Lists the exact issues (line numbers, code snippets, what's wrong and what the fix is)
   Then move the task back to `in_progress` and increment `review_count`.
   Max 3 rounds — after 3, Cognis does remaining fixes themselves. Only push to `human_review` when the work is actually clean.

   **Rule: never bounce a task without @tagging the agent.** A bounce without a tag is a silent failure — the agent has no way to know the task came back. This rule is not optional.
6. **Cognis approves** → moves to `human_review` with a plain English summary for Mal
7. **Mal approves** → clicks Approve button → task moves to `archived`

### Agent Routing Rules (for Untagged Commands)

When Cognis orchestrates, route work by **capability first, load second**:

**Capability (who's best at this):**
- **Forge** — all code, server changes, deployments, bug fixes, infrastructure, refactors, UI work, MCP/plugin edits
- **Donna** — operations, SOPs, workflow design, research writeups, ops board non-code changes (dashboard content, docs)
- **Cognis (self)** — strategy, competitive analysis, prospect research, SEO/content strategy oversight, cross-agent coordination, work that requires reading multiple research docs
- **Atlas** — deep research, market analysis, competitor intel (when live)
- **Studio** — content writing, blog posts, copy (when live)
- **Nexus** — distribution, social posts, email sequences (when live)
- **Herald** — outreach, prospect messages, cold emails (when live)
- **Ledger** — finance, pricing, projections, expense tracking (when live)

**Load balancing (when multiple agents could do it):**
- Before assigning, call `ops_get_tasks` and count in-flight work per agent (`assigned` + `in_progress` statuses)
- Prefer the agent with fewer in-flight tasks
- But **never sacrifice capability for balance** — if Forge is the right agent and has 5 tasks, still give it to Forge. Don't route code to Donna just to balance the queue.

**The 90% rule:** If Cognis is doing the work personally on more than 10% of untagged commands, something is wrong. Either the work should be delegated or a new agent role needs to exist. Flag it to Mal.

## Task Description Checklist

Every task description you write must pass this checklist before `ops_create_task` fires. Implicit context causes drift — especially for multi-workspace agents (currently Donna, who serves both Arca and Reignite).

1. **Workspace context stated explicitly.** First line or top of description: "Workspace: Arca" (or similar). Never assume the agent knows which workspace they're operating in. This is mandatory for Donna; skippable only for single-workspace agents like Forge.
2. **Agent domain reminder.** For any task that touches routing or identity, restate who owns what in this workspace: "In Arca, Forge owns code/infra/UI, Donna owns ops/SOPs/workflows/content ops, Cognis orchestrates and reviews." Prevents the agent from answering in a stale mental model.
3. **Explicit NOT framing when drift risk is high.** If the agent has a known default that's wrong for this task, say so: "Do NOT use Reignite routing." "Do NOT route code decisions to Cognis — Forge owns that in Arca." Negative framing is cheap and eliminates a whole class of bounces.
4. **Concrete paths and artifacts, not abstractions.** Write `$ARCA_HOME/ops/sops/worker-agent-task-lifecycle.md` not "the sops folder." Write `server.ts line 1125` not "the refresh logic." Agents can't guess what you mean.
5. **Explicit "done" criteria.** What file, what comment, what proof counts as complete. What should the reviewer (Cognis) be checking when the agent submits? If you can't write the done criteria, the task isn't ready to assign yet.
6. **Workflow block at the bottom** — a short numbered list showing the expected flow: "1. Pull to in_progress. 2. Do X. 3. Post as comment. 4. Set proof and move to ai_review." This is scaffolding for newer agents and a compressed contract for experienced ones.

**Why this exists:** On 2026-04-11 I gave Donna her first Arca task (role card) without items 1-3. She answered in her Reignite identity — wrong routing, wrong framing, Steven-facing when she should have been Arca-facing. The second attempt passed the checklist in full and worked first try. This pattern will repeat with every multi-workspace agent.

---

## Delegation Quality Standard — Anticipate the Agent's Failure Mode

Before writing a task, ask: **what will this agent do if they follow the instructions literally?** Non-coding agents (Mara, Donna, Atlas) often default to the minimum interpretation — they acknowledge rather than execute, summarize rather than demonstrate, and close tickets without verifiable proof.

**Design tasks backward from the proof you want to receive.** If the only valid proof is a curl output showing a record was created, say that. If the proof is a comment with the full deliverable, say that. If the proof is a before/after diff, say that. The agent should be able to read the task and know exactly what "done" looks like before they start.

### Bad delegation (produces acknowledgment, not work):
> "Read the updated skill at `/path/to/skill.md` and acknowledge."

What happens: agent reads it, posts "Acknowledged — skill understood," closes ticket. Zero verifiable change.

### Good delegation (produces demonstrable work):
> "Read the updated heartbeat skill at `/path/to/skill.md`. Then:
> 1. Post a comment here summarizing the 3 key changes in your own words (not a copy-paste)
> 2. If you have a running heartbeat, execute one run using the new complete-run endpoint and paste the API response as a comment
> 3. Update your standing orders or any local notes to reflect the new behavior
>
> **Proof:** Comment with your summary + the curl response. Cognis will verify the endpoint was actually called before moving to human_review."

What happens: agent demonstrates understanding + execution. Cognis can verify the endpoint call happened via the heartbeats API.

**Rule:** If a task can be "completed" just by reading and typing "acknowledged," rewrite it. Every task must require the agent to DO something verifiable, not just consume information.

---

## Proof Verification Before Closing

When a task arrives in `ai_review`, don't just read the proof field — **actively verify it**.

| Task type | What to verify |
|-----------|----------------|
| Code/server change | JS syntax check, API responds, curl test of new endpoint |
| Skill/doc update | Read the actual file — confirm the content was written, not just "updated" |
| Content/draft | Content is posted as a comment on the ticket, not just a file path |
| Research | Substantive findings in a comment, not a summary of what they searched |
| Heartbeat/run | Hit `/api/heartbeats/:id/runs` to confirm a run entry with `status: done` |
| Acknowledgment task | Explicitly look for evidence of action beyond acknowledgment text |

**If proof is missing or only says "done" without evidence:**
1. Comment on the task with exactly what's missing: `"@Mara — proof incomplete. Need: [specific thing]. Post it as a comment and move back to ai_review."`
2. Move task back to `in_progress`
3. Don't approve on the honor system

**The Mara precedent (2026-04-15):** Cognis gave Mara a skill update task that only said "read and acknowledge." Mara acknowledged correctly per the instructions, but no behavioral change was demonstrated. The fix: always write tasks that require demonstrable action, and always verify that the action happened, not just that the agent said it happened.

## Own Every Dependency You Create

When you create a task with a dependency ("blocks on t<id>", "waiting on t<id>"), you own its progression. Do not leave it to the assigned agent to notice the blocker has cleared — agents rarely re-sweep their blocked tickets on their own. When the blocking task moves to `human_review` or `archived`, immediately comment on the dependent task tagging the owner with an explicit unblock + scoped next step.

**Pattern for the unblock comment:**
> "@<owner> — your blocker <id> has cleared (status: <X>). Safe to start <specific scope, e.g. Phase 1 read-only audit>. If the unblock is partial, I'll flag the remaining gate."

**Why (2026-04-16):** Forge's Arca-plugin-packaging ticket sat `assigned` for 2+ hours after Mara's migration ticket moved to human_review. Mal: *"forge has a pending ticket initially blocked.... @Cognis you need to be actively dealing with these so don't just poll for your tickets, see what's on the board and hasn't moved since last heartbeat and nudge or reassign."* The miss wasn't "I didn't notice the Mara ticket moved" — it was *"I never went back to check if Forge's blocker had cleared."* That's the orchestrator job.

**Rule:** include "check blocked-downstream progression" in every heartbeat Step 4 sweep. The trigger is blocker clearing, not the downstream agent asking.

## Never Idle-Wait on a Blocker

Cognis is the orchestrator, not a single-threaded worker. If one ticket is blocked (waiting on an agent's redeploy, waiting on Mal's input, waiting on a cron tick), that is **never** a reason to sit still. There is always parallel work:

- Other pending tickets you haven't created yet
- Tickets in `ai_review` that need review
- Untagged commands in the Command Center queue
- Morning brief / heartbeat / SOP updates
- Benchmark profile updates for the coding-comparison agents
- Memory hygiene, reflection debt from prior encounters

**Rule:** whenever you catch yourself saying "I'll wait until X lands before doing Y," check whether Y actually depends on X. If Y only *benefits* from X (e.g., nicer UX, cleaner routing, better highlight color) but can still work without it, **do Y now.** Ship the 80% path; come back and polish once the blocker clears.

**Why:** On 2026-04-11, after bouncing Forge's wiring ticket, Cognis told Mal "holding the three queued tickets until Forge redeploys so the benchmark agents are taggable." Mal corrected: *"while you are waiting you have other tickets waiting for you, why wait?"* Right — the polling path already delivers @mentions even without the UI highlight. The queued tickets could ship immediately and route to benchmark agents in parallel with Forge's round 2. Idle-waiting burned orchestration tempo for zero gain.

**Test for a real blocker:** can the downstream work complete *at all* without the upstream? If yes → go. If no → use the wait window for different work, never nothing.

## Mandatory /watch-agent When Tasks Are In Progress

**As soon as any task moves to `in_progress`, start a /watch-agent loop. No exceptions.**

```
ScheduleWakeup(delaySeconds: 300, prompt: "/watch-agent <AgentName> <task_id>")
```

This is not optional monitoring — it is the primary mechanism for catching stuck agents, permission prompts, edit-accept loops, and silent failures. Without it, tasks can sit frozen for an hour before the next heartbeat cycle.

**Rules:**
- Start the loop the moment you dispatch work to an agent, not after the first check-in
- For client-facing or tight-SLA tasks: start immediately when the agent picks up the card
- If multiple tasks are in_progress, start a separate /watch-agent for each
- The loop self-terminates when the task reaches `ai_review`, `human_review`, or `archived`
- If >2 hours with no progress: escalate to Mal, stop the loop

**Why this was added (2026-04-15):** A ticket was bounced back to in_progress without a /watch-agent started. Forge had no active monitoring. The ticket sat unworked until the next heartbeat cycle. Mal: *"if there is stuff on pending you need to deploy agent watch skill always."*

---

## Post-Encounter Reflection Protocol

After every ops-board encounter (command response, task creation, task review — both bounces and approvals), do a 30-second retrospective before moving on:

1. **What happened** — one-line summary of the interaction
2. **Where was the friction** — what slowed things down, caused a bounce, or confused the agent
3. **What could be better next time** — concretely, which skill or memory file should change
4. **Apply the fix immediately** — edit `arca-ops/SKILL.md`, `arca-worker/SKILL.md`, or save a memory file in the same turn. Don't batch reflections.

If no change is needed, note the pattern anyway — even successes reveal which framings worked. Skills decay from underuse; active refinement keeps them sharp.

**Scope:** Runs on Arca board encounters AND Reignite board encounters (orchestration practice counts).

## API Reference

Base URL: `https://ops.runarca.xyz`

### Tasks

```
GET    /api/tasks?ws={id}                    — Get all tasks + board config
POST   /api/tasks?ws={id}                    — Create task
PUT    /api/tasks/{task_id}?ws={id}          — Update task
DELETE /api/tasks/{task_id}?ws={id}          — Delete task
POST   /api/tasks/{task_id}/move?ws={id}     — Move task to column
POST   /api/tasks/{task_id}/comments?ws={id} — Add comment
```

#### Create Task (POST /api/tasks)
```json
{
  "title": "Clear, actionable title",
  "description": "Detailed breakdown with subtasks",
  "owner": "Forge",
  "priority": "high|medium|low",
  "status": "assigned",
  "by": "Cognis",
  "original_request": "The exact text Mal sent",
  "proof": ""
}
```

#### Update Task (PUT /api/tasks/{id})
```json
{
  "status": "in_progress|ai_review|human_review|archived",
  "proof": "What was done, links, evidence",
  "review_count": 1,
  "by": "Forge"
}
```

#### Add Comment (POST /api/tasks/{id}/comments)
```json
{
  "by": "Cognis",
  "text": "Review feedback or status update"
}
```

### Commands

```
GET  /api/commands?ws={id}&status=pending    — Get pending commands
POST /api/commands?ws={id}                   — Send command
POST /api/commands/{cmd_id}/respond?ws={id}  — Respond to command
```

Commands with no @mention default to @Cognis.

### Activity

```
GET /api/activity?ws={id}  — Get changelog/activity feed
```

### Workspaces

```
GET    /api/workspaces        — List all workspaces
POST   /api/workspaces        — Create workspace {name, color}
DELETE /api/workspaces/{id}   — Delete workspace
```

### Other

```
GET /api/docs?ws={id}              — List docs
GET /api/docs/{name}?ws={id}       — Read doc
PUT /api/docs/{name}?ws={id}       — Write doc
GET /api/projects?ws={id}          — List projects
GET /api/dashboard?ws={id}         — Dashboard data
GET /api/mcp-status                — MCP health check
```

## MCP Tools

When connected via MCP server (`ops-board`), these tools are available:

- `ops_create_task` — Create a task
- `ops_update_task` — Update task status/title/description/owner
- `ops_comment_task` — Add comment to a task
- `ops_get_tasks` — Get all tasks
- `ops_get_task` — Get single task with full comment thread
- `ops_respond_command` — Respond to a command center message

**Note:** MCP tool status enums may lag behind the actual API. Use the REST API directly (via curl) for fields like `proof`, `review_count`, `original_request`, or the new status values (`assigned`, `ai_review`, `human_review`, `archived`).

## Agent Team

| Agent | Role | Color | Status |
|-------|------|-------|--------|
| Cognis | Strategy & Orchestration | Green | Live |
| Forge | Engineering | Red | Live |
| Donna | Operations (feedback only) | Amber | Live — **Steven's agent, not ours**. Feedback requests → create on `ws=reignite` (her board). Never assign Arca execution work to Donna — route to Atlas or Cognis instead. |
| Atlas | Research | Blue | — |
| Studio | Content | — | — |
| Nexus | Distribution | — | — |
| Herald | Outreach | — | — |
| Ledger | Finance | — | — |

## Agent Recovery Playbook

All agents (Forge, Atlas, Studio, etc.) run via `ollama launch claude` in tmux sessions managed by a keepalive cron. When an agent is unresponsive or its ops-board MCP is failing, follow this sequence:

### 1. Check what's actually happening
```bash
tmux capture-pane -t <agent>:0 -p -S -20
```
Look for: dev-channels approval prompt, tool approval block, "ops-board · ✘ failed" in /mcp output, API error in response.

### 2. Dev-channels approval stuck
Session shows: "I am using this for local development" prompt.
Fix: `tmux send-keys -t <agent>:0 "" Enter`

### 3. Ops-board MCP failed (`ops-board · ✘ failed`)
Means the channel plugin (port 880X) failed to start.
Check: `ss -tlnp | grep 880` and `stat -c "%Y" /tmp/ops-channel-<agent>.heartbeat`
Fix: Exit and restart using the proper launch command (see §4 below).
**Do NOT use `claude --model` directly** — agents require `ollama launch claude --model <model>:cloud`.

### 4. Proper restart command
```bash
# Atlas (qwen3.5:cloud)
tmux send-keys -t atlas:0 "/exit" Enter
# wait for bash prompt, then:
tmux send-keys -t atlas:0 "ollama launch claude --model qwen3.5:cloud -- --dangerously-load-development-channels server:claude-peers --dangerously-load-development-channels server:ops-board --add-dir $ARCA_HOME --add-dir /tmp --name atlas" Enter
# accept dev channels prompt:
tmux send-keys -t atlas:0 "" Enter
```
Each agent has a `run.sh` in `$ARCA_HOME/ops/agents/<agent>/` — that's the authoritative startup command.

### 5. Corrupt thinking block (API 400: "Invalid signature in thinking block")
This happens when `--continue` or `--resume` loads a session that ended mid-thought.
**Never** use `--continue` or `--resume` to restart an agent — always start fresh.
The `run.sh` files have had `CONTINUE_FLAG` removed for this reason (Apr 2026).

### 6. Keepalive rate limit hit
Keepalive crons cap at 5 restarts/hour. If an agent is stuck in a restart loop, the cron pauses.
Check: `tail -20 $ARCA_HOME/ops/agents/<agent>/keepalive.log`
Reset counter: `echo "$(date '+%Y%m%d%H')" > /tmp/keepalive-<agent>-restarts && echo "0" >> /tmp/keepalive-<agent>-restarts`
Then manually restart via §4.

### Port assignments (ops-board webhook)
| Agent | Port |
|-------|------|
| Cognis | 8799 |
| Forge | 8800 |
| Atlas | 8808 |
| (others follow sequential assignment) |

## Deploying Changes

The server file lives at `/home/claudebot/ops-workspace/server.ts` on Steven's VPS.

```bash
# Copy updated file
scp /tmp/ops-board-server-new.ts root@148.230.93.207:/home/claudebot/ops-workspace/server.ts

# Restart (NEVER pkill bun — it kills MCP)
ssh root@148.230.93.207 'fuser -k 3500/tcp 2>/dev/null; sleep 2; cd /home/claudebot/ops-workspace && nohup bun server.ts > server.log 2>&1 &'
```

## Key Rules

- **Command center is the only entry point** for new work. No standalone task creation UI.
- **Cognis is the triage layer.** All unaddressed commands go to Cognis.
- **Max 3 review rounds.** After 3 back-and-forths in AI Review, Cognis does remaining fixes and pushes to Human Review.
- **Proof of work is mandatory.** Agents must populate the `proof` field before moving to `ai_review`.
- **Human Review = plain English.** When pushing to Human Review, Cognis should comment with a clear summary of what was done so Mal can quickly decide.
- **Never kill bun globally** — `fuser -k 3500/tcp` only.
- **Always create a card for every work item, no exceptions.** Even small fixes, quick cleanups, and one-liners get a task on the board. Direct peer messages to agents without a card are invisible to Mal — the board is the source of truth. Create the card first, then delegate.

## Strategy Item Workflow

Strategy items live at `GET/POST https://ops.runarca.xyz/api/strategy?ws=arca`.

**When Cognis receives a vision or strategy comment and manually creates a task from it:**

1. Create the task on the board (`ops_create_task`)
2. **Immediately PATCH the strategy item** to move it out of "drafting" and link the task:
```bash
curl -X PATCH "https://ops.runarca.xyz/api/strategy/{STRATEGY_ID}?ws=arca" \
  -H "Content-Type: application/json" \
  -d '{"spawned_task_ids": ["TASK_ID"], "status": "approved", "reviewed_by": "Cognis"}'
```

**Status flow:** `drafting` → `approved` (tasks spawned) → `completed` (tasks done)

**Critical:** The `approved` status only auto-spawns tasks if `proposed_actions` is populated. Vision items (raw text, no formal actions) have empty `proposed_actions` — Cognis must manually PATCH `spawned_task_ids` after creating the task. **If you skip this step, the strategy item stays in "drafting" forever.**

**After the PATCH:** Verify the strategy item shows the correct status and `spawned_task_ids` contains the new task ID.

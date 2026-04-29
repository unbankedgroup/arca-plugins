---
name: heartbeat
description: Client agent heartbeat. Runs every cycle (default 30 min). Read client.yaml once at start to determine integrations, timing, and brief config. Never skip steps.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - WebSearch
  - WebFetch
---

# Client Agent Heartbeat

Your operating loop. Every cycle, act like a proactive ops person managing your client's day.

Read `client.yaml` once at cycle start. Extract integration flags, timezone, brief windows, and quiet hours into working context. Do not re-read client.yaml in later steps.

**All time fields in client.yaml are CLIENT-LOCAL, not server time.** Convert using the `timezone` field before comparing against system clock. Deploying a UTC server with a US client without conversion will fire briefs 4-5 hours early.

Steps gated on a disabled integration do not exist for that cycle -- skip instantly with no reasoning.

## Optimization rules

- **Parallelize independent steps.** Phases mark which steps can batch.
- **Diff, don't re-scan.** heartbeat-state.json tracks per-check timestamps. Only process items newer than the last timestamp. No new items = one-line result.
- **Zero-cost integration skip.** `enabled: false` = step does not exist.
- **Per-step timeout.** If any step hangs or errors, log the error and continue.

---

## Phase 1: ORIENT (sequential)

### Step 0 -- Time and quiet hours

Run `TZ=<timezone from client.yaml> date`. Determine if quiet hours apply (from client.yaml `quiet_hours`, default 10pm-9am client local). Set QUIET_HOURS flag. Outbound client messages are suppressed during quiet hours -- queue for the next brief.

### Step 1 -- Crash recovery and date rollover

Read `heartbeat-state.json`.

**Date rollover:** If the date in `last_cycle_id` (YYYY-MM-DD) differs from today, reset all daily flags to false: `morning_brief_sent_today`, `evening_wrap_sent_today`, and any per-brief `{id}_sent_today`.

**Crash recovery:** Check `steps_executed` from the last cycle. If incomplete, log which steps were missed and check for half-finished state (pending files without notifications, delegations without responses).

**Integrity check:** Compare last cycle's `steps_executed` against expected steps for that time of day. If any step is missing without a valid reason (disabled integration, quiet hours), log `INTEGRITY_FAIL: steps [X, Y] missing from last cycle`.

### Step 2 -- Gap detection

Compare `last_heartbeat` to now. If the gap exceeds 1.5x cadence (e.g. >45 min for 30-min cadence), log "GAP DETECTED: Xh Ym since last heartbeat" to daily notes.

---

## Phase 2: INGEST (integration-gated)

Gather external state before processing internal state. **Run Steps 3-7 in parallel.** Disabled integrations skip instantly.

### Step 3 -- Integration health probe (ungated)

For each enabled integration, make one lightweight probe call (e.g. list 0 items). If it fails, log `INTEGRATION_DOWN: {name}` and escalate immediately. Skip that integration's work for this cycle -- it will fail and waste tokens.

### Step 4 -- Email (requires: email)

Poll inbox since `last_email_check_ts`. For each real email needing a reply:
1. **De-dup first.** Search sent folder (last 72h) across ALL configured aliases for matching recipient/subject. If the client uses multiple email aliases (e.g. personal + business + team), configure them in `client.yaml` under `email.aliases[]`. The de-dup must search every alias's sent folder -- otherwise the agent nudges the client for things already replied to from a different alias.
2. Draft a reply in the client's voice
3. Save draft to a pending file
4. Queue for surfacing in Phase 4

Never send an email directly. Draft only. Every draft needs explicit client approval before sending. No exceptions.

If any email sparks a content idea or process improvement, append to the ideas log (default: `ideas.jsonl` in the agent directory, override via `client.yaml` `ideas_path`).

### Step 5 -- Calendar (requires: calendar)

- Next 2 hours: alert 30 min before any meeting with 2+ attendees
- Last 60 minutes: if a multi-attendee meeting ended and no follow-up logged, prompt the client for follow-ups
- Tomorrow preview: pull 2-3 key items for the evening wrap

### Step 6 -- Leads and CRM (requires: crm OR lead_tracker)

For each active lead:
- New leads (alerted: false): queue alert for client
- Follow-up aging: if >5 days since last contact and follow-up committed, draft follow-up, save to pending
- Stale leads: if >7 days with no outbound and follow-up promised, flag as cold

### Step 7 -- Follow-ups (ungated)

Read most recent daily notes and memory. Flag overdue named items. If overdue 3+ days, draft the follow-up and save to pending.

---

## Phase 3: PROCESS (parallel)

Handle internal queue. **Run Steps 8-10 in parallel.**

### Step 8 -- Ops board sweep

- Pending commands tagged to you: execute and respond
- Tasks assigned to you: pull, update status, start working
- Delegated tasks: check for completion, review output

Nothing sits unhandled for more than one cycle.

### Step 9 -- Peer messages

Check for incoming messages from other agents via claude-peers. Respond immediately.

### Step 10 -- Scheduled tasks and promises

**Proactive miss detection:** Read `next_fire_times` from heartbeat-state.json (written last cycle). For each entry where fire time is past and task is still pending, flag as missed immediately.

For each task:
- Trigger time passed + pending: execute now
- >60 min late: execute with "catch-up" prefix, log delay
- Created a promise to client: verify it shipped

**Chat promise scanner:** Scan your recent outbound messages (Telegram, email, ops board comments) for commitments: "I will," "I'll have," "by [time]," "ready by," "expect it by." For each commitment found that does not already have a tracked task, create one. Promises made in chat are invisible to the promise ledger unless they are captured here.

**Promise ledger:** Review all pending promises by age. For anything past 72 hours, assign an action: KEEP (with reason), NUDGE (message client), ESCALATE (ops board), or DEFER (with reason). No promise ages silently past 72h.

---

## Phase 4: ACT (sequential)

### Step 11 -- Surface and resolve

Review everything from INGEST and PROCESS. For each item needing client attention:
- Active hours: surface as YES/NO approval
- Quiet hours: queue for next brief

Prioritize: top 3 urgent items get individual messages. Everything else goes to the brief.

### Step 12 -- Proactive ops

1. What is coming in the next 48 hours? Is the client prepped?
2. Follow-up to draft, connection to make, content to create -- without being asked?
3. Deliverables aging past 72 hours without movement?
4. Highest-leverage thing to do right now?

Draft it or delegate it. Log what you did. During quiet hours, this is build time -- launch the work yourself.

---

## Phase 5: DELIVER (time-gated)

Check heartbeat-state.json flags to avoid duplicates.

### Step 13 -- Briefs

client.yaml can define multiple briefs under `briefs[]`. Each brief has: `id`, `recipient`, `channel`, `send_window_start`, `send_window_end`, `catch_up_until`, and `format`. Default if `briefs[]` not defined: morning brief 09:00-09:30, evening wrap = last 60 min before quiet hours.

**For each brief in `briefs[]`:**
- If current time is in `[send_window_start, send_window_end]` and `{id}_sent_today` is false: send
- If current time is in `[send_window_end, catch_up_until]` and `{id}_sent_today` is false and draft exists: catch-up send with delay note
- Otherwise: skip

**Morning brief** assembles:
- Overnight activity summary
- Today's calendar with optimized schedule
- YES-gates from Step 11 (de-dup against sent folder first)
- Pending drafts (emails, follow-ups)
- Effort estimate: "X items to approve (~Y min)"
- End with: "Anything else on your mind today?"

Under 200 words, tight bullets, action items first.

### Step 14 -- Evening wrap

- What got done today
- Overnight queue (including anything from Step 12)
- Tomorrow preview (2-3 calendar items)
- "Anything you want me to tackle while you sleep?"

Under 150 words. Conversational, not a status report.

---

## Phase 6: MAINTAIN

Always last so it captures everything the cycle produced. **Run Steps 15-16 in parallel, then 17, then 18.**

### Step 15 -- Daily notes

**Per-event entries (throughout the cycle):** Append a timestamped one-liner to daily notes for every meaningful event as it happens: email drafted, task fired, decision made, promise created, item surfaced. Inline during the cycle, not batched.

**Cycle summary (end of cycle):** One paragraph in `daily/YYYY-MM-DD.md`: cycle time, steps run, action count, flags.

### Step 16 -- Handoff rewrite

Rewrite `handoff.md`:
- Active thread (what is in progress)
- Done this session
- Open threads
- Client's current headspace
- In-flight delegations

### Step 17 -- Self-critique

If this cycle took any outbound action (message drafted, task delegated, file created), one reasoning pass: what could go wrong with what you just did? Fix anything found before writing state.

### Step 18 -- State write

Write in this order. If the cycle crashes mid-write, earlier files are still fresh.

**External monitoring files first (if configured in client.yaml `monitoring`):**
1. Liveness file: `last_write_utc`, `cycle_id`, `steps_missing`
2. Snapshot file: human-readable markdown of current state

**Then heartbeat-state.json (written last -- proof the cycle completed):**
- `last_heartbeat`: current timestamp
- `last_cycle_id`: YYYY-MM-DD-HHMM
- `last_heartbeat_note`: one-line summary
- `steps_executed`: array of step numbers run
- `morning_brief_sent_today`: boolean (+ date)
- `evening_wrap_sent_today`: boolean (+ date)
- `quiet_hours`: boolean
- `next_actions`: array of pending items
- `next_fire_times`: pending task IDs mapped to trigger timestamps
- `last_email_check_ts`, `last_board_check_ts`, `last_calendar_check_ts`: timestamps

---

## Output format

Every cycle MUST include a numbered table with ALL steps and their result. Show scheduled time or "Sent at HH:MM" for briefs -- never just "skipped."

```
| Step | Action | Result |
|------|--------|--------|
| 0 | Time check | 2:15 PM EDT, active hours |
| 1 | Crash recovery | Last cycle complete, no integrity fails |
| 2 | Gap detection | Clean, 28 min since last beat |
| 3 | Health probe | ops_board: OK, email: [disabled] |
| 4 | Email | [disabled] |
| 5 | Calendar | [disabled] |
| 6 | Leads | [disabled] |
| 7 | Follow-ups | 0 overdue |
| 8 | Ops board | 0 commands, 2 tasks in progress |
| 9 | Peers | 0 messages |
| 10 | Tasks | 1 fired, 0 overdue, 0 promises >72h |
| 11 | Surface | 0 items for client |
| 12 | Proactive | Drafted follow-up for Monday meeting |
| 13 | Briefs | Morning: sent at 9:05 AM. Evening: fires at 9:30 PM |
| 14 | Evening wrap | Not yet (9:30 PM) |
| 15 | Daily notes | Updated (3 events logged) |
| 16 | Handoff | Rewritten |
| 17 | Self-critique | No outbound actions, skipped |
| 18 | State write | Saved |
```

---

## Rules

- Never skip a step because "nothing changed." Run it.
- Never surface a problem without a proposed solution.
- NEVER send emails without explicit client approval. Draft only.
- Log everything to daily notes. If it is not logged, it did not happen.
- If a step errors, log and continue. One step never kills the cycle.

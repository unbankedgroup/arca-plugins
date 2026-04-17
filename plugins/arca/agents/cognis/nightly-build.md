# Cognis Nightly Build Protocol

**Window:** 3 AM – 5 AM EDT (07:00–09:00 UTC)
**Hard stop:** 5 AM EDT or budget exhausted, whichever comes first.

---

## Budget Check (before anything else)

```bash
python3 $ARCA_HOME/ops/agents/cognis/usage-check.py --short
```

- Claude Max resets Sunday 9 PM EDT
- Daily budget = weekly remaining ÷ remaining working days (Mon–Sat)
- Plenty of budget → ambitious scope
- Near limit → trim or pause
- Hard stop: 5 AM EDT OR usage about to finish

---

## Protocol Steps

**0. Strategic loop** — before building anything:
- What does Mal's week look like? Any commitments, deadlines, or calls ahead?
- What would genuinely WOW him tomorrow morning?
- What's the highest-leverage thing I can build alone tonight?
- What did I build recently that I haven't yet connected to the broader strategy?

**1. 48-hour review** — scan the last 48 hours for:
- Promises made that aren't yet scheduled or tracked
- Opportunities surfaced that haven't been drafted or assigned
- Commitments Mal made that need follow-up or reply drafted
- Fix all of these before the morning brief

**Skill hardening (every night):**
- Read `~/.claude/skills/arca-ops/SKILL.md` and `~/.claude/skills/arca-worker/SKILL.md`
- Where did friction occur today? Any step that required >2 tool calls the skill didn't anticipate?
- Sharpen the relevant section — tighter instructions, better examples, clearer decision logic
- Check `hooks/skill-rules.json` — are trigger keywords still accurate?
- Goal: every agent running arca-worker should execute a full task with zero clarification needed

**Coding quality review (every night):**
- Review Forge's completed tasks from the day. For each — did the output follow the four Karpathy principles?
  1. Think Before Coding — stated assumptions or asked before running?
  2. Simplicity First — minimal code, or over-engineered?
  3. Surgical Changes — touched only what was asked?
  4. Goal-Driven Execution — defined verifiable success criteria before starting?
- Log specific drift examples to `~/.claude/skills/arca-worker/SKILL.md` as anti-patterns with fixes

**2. Review the day** — what happened on the board, what worked, what didn't, where the friction was

**3. Retrospect on the skill** — is arca-ops/arca-worker tighter than yesterday? If not, find a sharpening opportunity.

**4. Daily research — assign to Atlas** — create a task assigned to Atlas (owner=Atlas, workspace=arca):
- Use the `/last30days` skill
- Rotate topics nightly: competitor features → ICP pain points → new AI ops use cases → SMB owner frustrations → pricing/positioning signals → adjacent tool communities
- Subreddits: r/smallbusiness, r/Entrepreneur, r/consulting, r/freelance, r/Coaches, r/AIAssistants, r/ChatGPT, r/ClaudeAI, r/artificial, r/salesforce, r/hubspot, r/crm, r/agencylife, r/digitalnomad, r/virtualassistant
- Also cover: X/Twitter, HN, YouTube, TikTok for the same topics
- Output: 3–5 fresh insights, each with source + implication for Arca
- Log to `$ARCA_HOME/research/daily-YYYY-MM-DD.md`
- Read output before writing the morning brief

**5. Competitor feature deep-dive** (separate from daily research) — once per night:
- Primary: paperclip.ai (closest competitor)
- Others: relevance.ai, relay.app, lindy.ai, zapier AI, make.com AI, taskade, notion AI
- What features do they have that Arca doesn't? What are users asking for?
- Output: 1–3 specific implementable feature ideas for Arca, prioritized by effort vs impact
- Log to `$ARCA_HOME/ops/agents/cognis/competitor-research-YYYY-MM-DD.md`

**6. "What would make Arca better?" pass** — first-principles:
- What friction exists for Donna right now that Arca should solve?
- What's missing from the Arca skill/infrastructure stack?
- What would a new client agent struggle with on day one?
- Output: 1–3 concrete improvement ideas, prioritized by impact vs effort

**7. One feedback request to Donna** — assign her a ticket on the reignite board:
- One specific question per night (not a brain dump)
- Frame around her live experience
- Rotate topics: workflow friction → missing tools → communication patterns → principal trust-building → system reliability
- Translate her pain into product decisions

**8. Strategic plan for tomorrow/this week** — highest-leverage move with 5D: not just tomorrow's action, but 2–3 moves downstream.

**9. Assign work to the team** — create tickets for Forge and any workers. Pre-draft briefs so agents can execute without clarification.

**10. Build** — do your own work. Improve the board, improve the skills, ship features you believe in.

**11. Write the morning brief**
- Send time: 6:30 AM EDT (heartbeat at :37 detects the file and sends it)
- File: `$ARCA_HOME/ops/agents/cognis/morning-brief-YYYY-MM-DD.md`
- Send via Telegram

---

## Morning Brief Format

```
[Day], [Date]. [One sentence on the state of play — momentum or concern.]

THE MOVE TODAY
[The single highest-leverage action for today. Specific. Why it matters now.]

LAST NIGHT
[2-3 bullets: what shipped, what was researched, what moved forward]
[Any blocker or issue — with proposed fix, not just the problem]

TEAM
[Agent: what they're on] × 3-4 active agents only. Skip idle ones.

INTEL
[Competitor: one specific feature or move + what it means for Arca]
[Market: one signal from Atlas's research — source, insight, implication]

BUILD IDEA
[One concrete Arca improvement. Format: "X would let clients do Y, effort ~Z days"]

YOUR CALL
[Hard decision only — one sentence framing the choice. If none: "Clear to execute."]

THIS WEEK
[One sentence on the strategic arc — where we're headed by Friday]

TATE
[One quote written in Tate's voice — punchy, declarative, directly relevant to what Mal is facing today. Not a real Tate quote — written fresh in his style.]
```

**Strategic cadence:**
- Daily plan — every morning brief
- Weekly plan — every Monday morning brief
- Monthly plan — first of the month

All plans should be well-researched, detailed, and use real business reasoning.

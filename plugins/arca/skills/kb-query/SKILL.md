---
name: kb-query
version: "2.0.0"
description: "Query the Arca knowledge base before answering any factual question. Enforced skill — prevents hallucination by grounding responses in team memory (vault). Returns cited answers from wiki pages, not general knowledge."
argument-hint: 'kb-query what did we decide about pricing?'
allowed-tools: Read, Grep, Glob, Bash
user-invocable: true
metadata:
  arca:
    mandate: M-013b
    enforcement: UserPromptSubmit hook (M-013a)
    priority: HIGH
    ship-deadline: 2026-04-25
---

# /kb-query

Query the Arca knowledge base before answering any factual question about the project, team, competitors, or prior decisions. Prevents hallucination by grounding responses in team memory.

**Why this exists:** Agents that answer from general knowledge contradict team memory — wrong pricing, outdated positioning, reversed decisions. kb-query forces a vault check before answering. Skipping it = unforced error.

---

## 1. Purpose

kb-query answers questions against the shared Arca vault (`/root/arca/vault/`). It reads the wiki INDEX, searches via `kb_search_smart` (hybrid FTS + semantic), reads the most relevant pages, and synthesizes an answer with citations.

Every agent on the Arca team should invoke kb-query (or its auto-fire hook) before answering any question that references:
- Past decisions, rationale, or reversals
- Product specs, pricing, or positioning
- Competitor intelligence
- Architecture choices or infrastructure state
- SOPs or operational procedures

**Skipping kb-query when relevant pages exist = hallucination risk.** The vault is the team's memory. General knowledge is not a substitute.

---

## 2. When to Invoke

### Trigger patterns (ALWAYS query the vault)

The user prompt matches ANY of these patterns:

| Pattern | Examples |
|---------|---------|
| **Question words** about project specifics | "what are...", "how does...", "why did we...", "when was...", "where is..." |
| **Lookup verbs** | "find", "show me", "look up", "recall", "remember", "check" |
| **Entity references** — named things in the project | Agent names (Cognis, Forge, Atlas...), task IDs (t1776...), mandate IDs (M-007...), slugs (deploy-rollback), SOP names, tool names (ops board, qmd, Hermes) |
| **Decision language** | "decided", "approved", "killed", "chose", "picked", "going with", "rejected" |
| **Comparison/positioning** | "how does X compare to Y", "what's our position on", "vs Paperclip", "vs Lindy" |
| **Process/SOP** | "how do we deploy", "what's the SOP for", "restart procedure" |
| **Status/history** | "what happened with", "what went wrong", "what's the current state of" |
| **"Did we..." / "Have we..."** | "did we decide", "have we discussed", "did anyone look into" |

### Skip patterns (DO NOT invoke kb-query)

| Pattern | Examples | Why skip |
|---------|---------|----------|
| **Pure acknowledgments** | "ok", "got it", "thanks", "ack" | No question being asked |
| **Single-word affirmation/negation** | "yes", "no", "correct" | Not a query |
| **Status pings** | "still there?", "you alive?" | Not a knowledge question |
| **Directive commands** (no question) | "deploy it", "fix that bug", "write the tests" | Action, not a question |
| **Code generation** | "write a function that...", "implement the API" | Execution, not recall |
| **Creative/content** | "draft a tweet", "write landing copy" | Generative, not recall-based |
| **Chat/meta** | "what model are you?", "how are you?" | Not project knowledge |

**Ambiguous case:** If the prompt contains ANY question word (what/how/why/when/where) about the project, ALWAYS query. False positives (querying when unnecessary) are cheap; false negatives (skipping when the vault had the answer) cause hallucination.

---

## 3. Query Patterns (how to query well)

For manual invocation or when constructing queries for `kb_search_smart`:

### Good queries

| Type | Example | Why it works |
|------|---------|-------------|
| **Specific entity + attribute** | "what are arca's subscription pricing tiers" | Exact FTS match on "subscription pricing tiers" |
| **Decision keywords** | "what did we decide about credit-based pricing" | Matches `type: decision` pages |
| **Competitor + dimension** | "how does arca compare to paperclip" | Surfaces comparison pages |
| **SOP + action** | "how do we deploy runarca.xyz to cloudflare" | Matches how-to pages with deploy keywords |
| **Agent + role** | "which agent handles distribution and x posts" | Matches agent topology pages |
| **Topic cluster** | "fractional ops pricing landscape" | Broad enough to catch synthesis pages |
| **Proper nouns** | "M-007 callback handler", "t1776989095820" | Exact FTS match on unique identifiers |

### Bad queries

| Type | Example | Why it fails |
|------|---------|-------------|
| **Too vague** | "how do we do things" | No FTS anchors, semantic noise |
| **Single common words** | "pricing" | Returns every page mentioning pricing |
| **General knowledge** | "what is a CRM" | Vault has no general encyclopedia |
| **Overly specific** | "what did forge decide about the api.js refactoring on april 21 at 3pm" | Too narrow, likely 0 results |

**Rephrase rule:** If first query returns 0 useful results, rephrase with different keywords before declaring a gap. Try synonyms, broader terms, or the entity name alone.

---

## 4. Result Handling

### Top-3 results contain relevant pages

1. Read the snippets from `kb_search_smart` results
2. For the most relevant result, call `kb_read` to get full content
3. If the snippet answers the question, cite it directly
4. If multiple pages are relevant, read top 2-3 and synthesize

**Citation format:** `"Claim text [wiki: page-slug]"` — always attribute to the source page.

### 0 results or no useful results

1. **Rephrase** the query with different keywords (see Query Patterns above)
2. If still 0 results: **log a team memory gap** — the answer should exist but doesn't
3. Suggest `/kb-ingest` to capture the missing knowledge
4. State clearly: "The vault has no information on [topic]. This may be a gap worth capturing."

### Conflicting results

If two wiki pages give contradictory answers:

1. **Do not pick a winner** — flag the conflict
2. Surface both claims with citations: `"Page A says X [wiki: slug-a]. Page B says Y [wiki: slug-b]. These conflict."`
3. Route to Cognis for resolution: "Wiki pages disagree on [topic] — needs decision to resolve."
4. If the conflict is a decision-blocker (e.g., two different pricing structures), escalate immediately

### Stale results

If a wiki page hasn't been updated in > 30 days:

1. Annotate with `[stale — last updated YYYY-MM-DD]` when citing
2. Flag that the information may be outdated
3. Do NOT treat stale information as current truth

---

## 5. "Did It Run?" Signal (Testability)

A reviewer (Ultron, Cognis, Mal) must be able to verify that kb-query was used in a given session using grep alone.

### Primary signals

| Signal | How to verify | Grep pattern |
|--------|---------------|--------------|
| **kb_search_smart tool calls** | Present in agent's session JSONL | `grep "kb_search_smart" <session.jsonl>` |
| **Hook log entries** | Forge's hook writes to per-agent log | `grep "kb-query-hook" /root/arca/ops/agents/<agent>/hooks/kb-query-hook.log` |
| **Self-report tag** | Agent appends to response when using kb-query results | `grep "\[kb-query:" <session.jsonl>` |

### Self-report format

When an agent uses kb-query results in its answer, it appends:

```
[kb-query: N results from <topic>]
```

Examples:
- `[kb-query: 3 results from arca-pricing]`
- `[kb-query: 0 results from lindy-ai-integration — gap flagged]`
- `[kb-query: 2 results from deploy-sop — stale flagged]`

**This tag is MANDATORY** when the agent's answer depends on vault content. Omitting it when vault content was used = compliance failure.

### When the hook auto-fires

If Forge's M-013a UserPromptSubmit hook auto-fires kb-query, the hook itself logs:

```
[YYYY-MM-DD HH:MM] kb-query-hook: prompted=<query>, results=N, fired_for=<user-prompt>
```

Reviewers check the hook log, not the session JSONL, for auto-fire verification.

---

## 6. Failure Modes + Recovery

| Failure | Behavior | Recovery |
|---------|----------|----------|
| **KB server down** (MCP tools return errors) | Fall back to direct vault file reads: `Read vault/_wiki/INDEX.md` → grep for keywords → read matching pages | Log: `[kb-query: KB server down, fell back to vault reads]`. Report to Forge for server restart. |
| **0 useful results** after rephrasing | Declare team memory gap, suggest `/kb-ingest` | Log: `[kb-query: 0 results from <topic> — gap candidate]`. Suggest capture. |
| **Stale results** (page > 30 days old) | Annotate with `[stale]`, treat as potentially outdated | Flag in response. Do not rely on stale info for current decisions. |
| **Contradictory pages** | Flag conflict, route to Cognis | Do not resolve independently. Surface both claims. |
| **Duplicate results** (kb_ingest creates duplicates) | Use the highest-ranked result, ignore duplicates by title | Known issue — duplicates from kb_ingest alongside wiki originals. |
| **Wrong page type** (decision typed as reference) | Still use the content, but note the mistyping | Report to Atlas for retype. Wrong type = lower recall for type-filtered queries. |

### Graceful degradation priority

1. `kb_search_smart` (best — hybrid FTS + semantic)
2. `qmd search` (keyword-only fallback)
3. Direct `INDEX.md` scan + `Read` of matching pages (last resort)
4. State "no vault data available" and answer from general knowledge ONLY if explicitly permitted by the user

---

## Coordination with M-013a (Forge's Hook)

This SKILL.md defines the **behavior** of kb-query. Forge's M-013a wires the **enforcement** via a UserPromptSubmit hook that auto-detects when to fire.

**Trigger/skip patterns above are the spec for Forge's intent detection.** Forge's hook script must implement:
- **Trigger list** from Section 2 → auto-fire `kb_search_smart` before the agent generates its response
- **Skip list** from Section 2 → suppress auto-fire for acks, commands, creative prompts
- **Bypass mechanism** → user prefix `!` or agent signal `no-kb-query` to skip for this prompt only

**Coordination protocol:** When Atlas updates trigger/skip patterns, comment on M-013a task so Forge mirrors in code. When Forge changes the detection heuristic, comment on M-013b so Atlas updates this spec.

---

## Output Format

### Short answers (Telegram, quick lookups)

Lead with the answer, then one-line citation per claim:
```
Arca pricing is $97-497/mo flat, no credits. [wiki: arca-pricing-and-plans]
Foundation is $97, Structure $247, Fortress $497. [wiki: arca-pricing-and-plans]
[kb-query: 3 results from arca-pricing]
```

### Long answers (research, competitive analysis)

Write to `vault/outputs/<slug>-YYYY-MM-DD.md`, return the file path + 3-bullet summary.
```
Saved to vault/outputs/competitor-pricing-landscape-2026-04-24.md

- Arca ($97-497 flat) undercuts fractional ops ($2-10K/mo) by 5-50x [wiki: competitor-pricing-patterns]
- Credit-based pricing (Lindy $49-60) has 2.4/5 Trustpilot from billing complaints [wiki: lindy-ai-competitive-intelligence]
- GoHighLevel's $97 sticker price balloons to $150-300/mo with overages [wiki: competitor-pricing-patterns]

[kb-query: 5 results from competitor-pricing]
```

## Don't

- Answer from general knowledge if the wiki has relevant pages — always cite
- Read all of `raw/` — the wiki is the index, use it
- Skip `kb_search_smart` — it catches pages the INDEX might have dropped off
- Silently paraphrase — attribute to the source page
- Omit the `[kb-query: N results]` self-report tag when using vault content
- Resolve contradictory pages independently — escalate to Cognis
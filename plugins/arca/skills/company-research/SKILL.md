---
name: company-research
description: |
  Company discovery and deep research skill. Researches a company's product and ICP,
  discovers target companies to sell to, deeply researches each, and scores ICP fit —
  compiled into a scored research report and CSV. Supports depth modes for balancing
  scale vs intelligence. Uses Claude native tools (WebSearch, WebFetch) — no external
  API keys required.
  Use when: find companies to sell to, research potential customers, discover companies
  matching an ICP, build a target company list, market research on prospects, lead gen.
  Triggers: "find companies to sell to", "company research", "find prospects",
  "ICP research", "target companies", "who should we sell to", "market research",
  "lead research", "prospect list".
license: MIT
allowed-tools: Bash Agent WebSearch WebFetch
metadata:
  author: Unbanked
  version: "1.0.0"
---

# Company Research

Discover and deeply research companies to sell to. Uses Claude's WebSearch for discovery and WebFetch for page content — no external API keys needed. Follows a Plan→Research→Synthesize pattern, outputting scored research reports and a CSV.

**No external API keys required.** Uses Playwright (headless Chromium) for JS-rendered page extraction, Claude's WebSearch for discovery, and Node.js for report compilation.

**Output directory**: All research output goes to `~/Desktop/{company_slug}_research_{YYYY-MM-DD}/`. Contains one `.md` file per company plus final report and CSV.

**CRITICAL — Tool restrictions (applies to main agent AND all subagents)**:
- All web searches: use `WebSearch` tool. Never use bash-based search.
- All page content extraction: use `node {SKILL_DIR}/scripts/extract_page.mjs "<url>"`. This uses Playwright (headless Chromium) to render JavaScript-heavy pages (Framer, Next.js, React SPAs) and extracts title + meta tags + headings + visible body text. Never use WebFetch for company homepage/product page content — it misses JS-rendered SPAs.
- Small structured files (sitemap.xml, robots.txt, llms.txt): use `WebFetch` or `curl` — these don't need JS rendering.
- All research output: subagents write **one markdown file per company** to `{OUTPUT_DIR}/{company-slug}.md` using bash heredoc. NEVER use the Write tool or `python3 -c`. See `references/example-research.md` for format.
- Report + CSV compilation: use `node {SKILL_DIR}/scripts/compile_report.mjs {OUTPUT_DIR}` — generates HTML report and CSV.
- URL deduplication: use `node {SKILL_DIR}/scripts/list_urls.mjs /tmp` after discovery.
- **Subagents may use ONLY WebSearch and Bash tools. No other tools.** WebFetch is banned for subagents — all page content extraction goes through `extract_page.mjs` via Bash. Only the main agent uses WebFetch for sitemap/robots/llms.txt.
- **Main agent NEVER reads raw discovery JSON batch files.** Use `list_urls.mjs` for dedup.

**CRITICAL — Anti-hallucination rules (main agent AND all subagents)**:
- NEVER infer `product_description`, `industry`, or `target_audience` from a site's fonts, framework (Framer/Next.js/React), design system, or typography.
- NEVER let the user's own ICP leak into a target's description. If you don't know what the target does, write `Unknown`.
- `product_description` MUST quote or closely paraphrase a specific phrase from `extract_page.mjs` output (TITLE, META_DESCRIPTION, OG_DESCRIPTION, HEADINGS, or BODY). If none yield a recognizable product statement, write `Unknown`.
- If `product_description` is `Unknown`, cap `icp_fit_score` at 3 and set `icp_fit_reasoning` to `Insufficient evidence`.

**CRITICAL — Minimize permission prompts**:
- Subagents MUST batch ALL file writes into a SINGLE Bash call using chained heredocs.
- Batch ALL searches and ALL fetches into single commands where possible.

## Pipeline Overview

Follow these 5 steps in order.

1. **Company Research** — Deeply understand the user's company, product, and ICP
2. **Depth Mode Selection** — Choose research depth based on target count
3. **Discovery** — Find target companies using diverse search queries
4. **Deep Research & Scoring** — Research each company, score ICP fit
5. **Report & CSV** — Present findings, compile scored CSV

---

## Step 0: Setup Output Directory

```bash
OUTPUT_DIR=~/Desktop/{company_slug}_research_{YYYY-MM-DD}
mkdir -p "$OUTPUT_DIR"
```

Replace `{company_slug}` with the user's company (lowercase, hyphenated) and `{YYYY-MM-DD}` with today's date. Use the full literal path (no `~`) in all subagent prompts.

Also clean up prior discovery batch files:
```bash
rm -f /tmp/company_discovery_batch_*.json
```

## Step 1: Deep Company Research

1. Ask the user for their company name or URL

2. **Check for existing profile**:
   - List files in `{SKILL_DIR}/profiles/` (ignore hidden files)
   - If a matching profile exists, present to user: "I have your profile from {date}. Still accurate?" If yes, skip to Step 2.
   - If no profile, proceed with deep research below.

3. **Full deep research on the user's company**:
   - WebSearch `"{company name}"` — get overview
   - Extract homepage: `node {SKILL_DIR}/scripts/extract_page.mjs "{company website}"` (Playwright renders JS, extracts title/meta/headings/body)
   - **Discover site pages**: Fetch sitemap via `curl -sL "{company website}/sitemap.xml"` or WebFetch and scan for URLs with keywords: `customer`, `case-stud`, `pricing`, `about`, `use-case`, `industry`, `solution`. Pick 3-5 most relevant and extract with `extract_page.mjs`.
   - Search for external context and competitors
   - See `references/research-patterns.md` for sub-question templates

   **Synthesize into a profile**:
   Company, Product, Existing Customers, Competitors, Use Cases.
   Do NOT include ICP or sub-verticals — those are per-run decisions.

4. Present profile to user for confirmation. Do not proceed until confirmed.

5. **Save confirmed profile** to `{SKILL_DIR}/profiles/{company-slug}.json`

6. **Ask clarifying questions**:
   - "Which segments are you targeting?" (derived from research)
   - "Company stage?" — Startups, Mid-market, Enterprise, All
   - "How many companies / depth?" — Quick (~100), Deep (~50), Deeper (~25)
   - This is the ONLY user interaction. After this, execute silently.

## Step 2: Depth Mode Selection

| Mode | Research per company | Best for |
|------|---------------------|----------|
| `quick` | Homepage + 1-2 searches | ~100 companies, broad scan |
| `deep` | 2-3 sub-questions, 5-8 tool calls | ~50 companies, solid research |
| `deeper` | 4-5 sub-questions, 10-15 tool calls | ~25 companies, full intelligence |

## Step 3: Discovery

**Formula**: `ceil(requested_companies / 35)` search queries needed. Over-discover by ~2-3x.

Generate search queries with these patterns:
- Industry + company stage + geography
- Technology stack + use case
- Competitor adjacency ("alternatives to {known company}")
- Buyer persona + pain point

**Process**:
1. Launch ALL discovery subagents at once (up to ~6 per message). Each runs ALL its queries in a single message using WebSearch.
   Each subagent outputs results to `/tmp/company_discovery_batch_{N}.json` via Bash after completing its searches.
2. After all waves complete, deduplicate: `node {SKILL_DIR}/scripts/list_urls.mjs /tmp`
3. **Filter the URL list** — remove:
   - Blog posts, news articles
   - Directories/aggregators (tracxn, crunchbase, g2)
   - The user's own competitors and existing customers
   Keep only company homepages.

## Step 4: Deep Research & Scoring

Launch subagents to research companies in parallel. See `references/workflow.md` for subagent prompt templates and `references/research-patterns.md` for research methodology.

**Process**:
1. Split filtered URLs into groups (quick: ~10, deep: ~5, deeper: ~2-3 per subagent)
2. Launch ALL enrichment subagents at once (up to ~6 per message)
3. Each subagent uses ONLY WebSearch, WebFetch, and Bash:

   **Phase A — Plan** (skip in quick mode):
   Decompose into 2-5 sub-questions based on ICP and enrichment fields.

   **Phase B — Research Loop**:
   For each sub-question: WebSearch → pick 1-2 best URLs → WebFetch each.
   Respect step budget (quick: 2-3, deep: 5-8, deeper: 10-15 tool calls).

   **Phase C — Synthesize**:
   Score ICP fit 1-10 with evidence. Fill enrichment fields.

4. Subagents write ALL markdown files in a SINGLE Bash call using chained heredocs to `{OUTPUT_DIR}/`
5. After ALL subagents complete, proceed to Step 5

**Critical**: Include the confirmed ICP description verbatim in every subagent prompt. Pass the full literal `{OUTPUT_DIR}` path to every subagent.

## Step 5: Report & CSV

1. **Generate HTML report + CSV**:
   ```bash
   node {SKILL_DIR}/scripts/compile_report.mjs {OUTPUT_DIR}
   ```
   This generates:
   - `{OUTPUT_DIR}/index.html` — overview page with scored table
   - `{OUTPUT_DIR}/companies/*.html` — individual company pages
   - `{OUTPUT_DIR}/results.csv` — scored spreadsheet

2. **Present summary in chat**:
   - Total companies researched
   - Depth mode used
   - Score distribution (Strong 8-10 / Partial 5-7 / Weak 1-4)
   - Top companies table sorted by ICP score

3. For the top 3-5 companies, show a brief research summary — key findings, why they're a good fit, and approach angle.

Offer to dig deeper into specific companies, adjust scoring, or re-run discovery with different queries.

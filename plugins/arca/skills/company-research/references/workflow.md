# Company Research — Workflow Reference

## Discovery Batch JSON Schema

File: `/tmp/company_discovery_batch_{N}.json`

```json
{
  "query": "AI data extraction startups",
  "results": [
    { "url": "https://example.com", "title": "Example Corp", "description": "..." },
    ...
  ]
}
```

The `list_urls.mjs` script reads these files and deduplicates by URL.

## Company Research Markdown Format

File: `{OUTPUT_DIR}/{company-slug}.md`

Each research subagent writes one markdown file per company. See `references/example-research.md` for the full template.

**YAML frontmatter fields** (used for report + CSV compilation):
- `company_name` (required)
- `website` (required)
- `product_description`
- `industry`
- `target_audience`
- `key_features` (pipe-separated: `feature1 | feature2 | feature3`)
- `icp_fit_score` (integer 1-10, required)
- `icp_fit_reasoning`
- `employee_estimate`
- `funding_info`
- `headquarters`

**Body sections**:
- `## Product` — what they do
- `## Research Findings` — evidence with confidence levels and sources

**CRITICAL**: Use consistent field names across all files. The `compile_report.mjs` script reads these fields.

## Verifying Content Is Real (Not Hallucinated)

Before writing `product_description`, `industry`, or `target_audience`, confirm the claim is grounded in `extract_page.mjs` output. Quote or closely paraphrase from TITLE, META_DESCRIPTION, OG_DESCRIPTION, HEADINGS, or BODY.

If `extract_page.mjs` returns `FETCH_OK: false` (or BODY_CHARS < 50), the page is inaccessible. Do not fabricate. Write:
- `product_description: Unknown — content not accessible`
- `icp_fit_score: 3` (or lower)
- `icp_fit_reasoning: Insufficient evidence — no readable content`

## Discovery Subagent Prompt Template

```
You are a company discovery subagent. Find target companies using web search.

TOOL RULES — CRITICAL, FOLLOW EXACTLY:
1. You may use ONLY WebSearch and Bash tools. No exceptions.
2. BANNED TOOLS: WebFetch, Write, Read, Glob, Grep, Agent — ALL BANNED.
3. NEVER use ~ or $HOME in paths — use full literal paths.
4. After ALL searches are done, write results to a JSON file in one Bash call.

TASK:
Research each of the following search queries using WebSearch.
For each query, get the top 10-25 results (URLs and titles).

After completing all searches, write all results to batch files:
Use `cat << 'EOF' > /tmp/company_discovery_batch_{N}.json` for each batch.

After the command completes, report back ONLY the count of results found per batch.
Do NOT analyze, summarize, or return the actual results.
```

## Research Subagent Prompt Template

```
You are a company research subagent. For each company URL, research the company and score ICP fit.

CONTEXT:
- User's company: {user_company}
- User's product: {user_product}
- ICP description: {icp_description}
- Depth mode: {depth_mode}
- Output directory: {OUTPUT_DIR}

URLS TO PROCESS:
{url_list}

TOOL RULES — CRITICAL, FOLLOW EXACTLY:
1. You may use ONLY WebSearch and Bash tools. No exceptions.
2. All searches: use WebSearch tool.
3. All page content: use `node {SKILL_DIR}/scripts/extract_page.mjs "URL" --max-chars 3000` via Bash. This uses Playwright (headless Chromium) to render JS SPAs and returns structured TITLE / META_DESCRIPTION / OG_DESCRIPTION / HEADINGS / BODY.
4. Small structured files (sitemap.xml, robots.txt, llms.txt): use `curl -sL` via Bash — these don't need JS rendering.
5. BATCH all file writes: Write ALL markdown files in a SINGLE Bash call using chained heredocs.
6. BANNED TOOLS: WebFetch, Write, Read, Glob, Grep, Agent — ALL BANNED.
7. NEVER use ~ or $HOME in paths — use full literal paths.

ANTI-HALLUCINATION RULES — CRITICAL:
- NEVER infer product_description, industry, or target_audience from fonts, framework, design system, or visual style.
- NEVER let the sender's ICP leak into a target's description. If unknown, write "Unknown".
- product_description MUST quote or closely paraphrase extract_page.mjs output (TITLE/META_DESCRIPTION/OG_DESCRIPTION/HEADINGS/BODY). If no recognizable product statement, write "Unknown" and cap icp_fit_score at 3.

RESEARCH PATTERN (per company):

Phase A — Plan (skip in quick mode):
Decompose what you need to know into sub-questions based on ICP and enrichment fields.

Phase B — Research Loop:
For each sub-question (or just homepage in quick mode):
1. WebSearch with relevant query
2. Pick 1-2 most relevant URLs
3. Extract page content: `node {SKILL_DIR}/scripts/extract_page.mjs "URL" --max-chars 3000`
   (Playwright renders JS, extracts title/meta/headings/body)
4. For sitemap discovery: `curl -sL "URL"` — small structured files don't need Playwright
5. Extract findings: factual statements with source, confidence level
6. Accumulate findings, move to next sub-question
7. Respect step budget: quick=2-3 calls, deep=5-8, deeper=10-15

Phase C — Synthesize:
From accumulated findings:
1. Score ICP fit 1-10 (see rubric below)
2. Fill enrichment fields from findings
3. Reference specific findings in icp_fit_reasoning

ICP SCORING RUBRIC:
- 8-10: Strong match. Multiple high-confidence findings confirm fit.
- 5-7: Partial match. Some findings suggest relevance but key signals missing.
- 1-4: Weak match. Wrong segment or no apparent connection.

OUTPUT — write ALL company files in a SINGLE Bash call using chained heredocs:

cat << 'COMPANY_MD' > {OUTPUT_DIR}/{slug1}.md
---
company_name: {name}
website: {url}
product_description: {description}
industry: {industry}
target_audience: {audience}
key_features: {feature1} | {feature2} | {feature3}
icp_fit_score: {score}
icp_fit_reasoning: {reasoning}
employee_estimate: {estimate}
funding_info: {funding}
headquarters: {location}
---

## Product
{product description paragraph}

## Research Findings
- **[{confidence}]** {finding} (source: {url})
COMPANY_MD

Report back ONLY: "Batch {batch_id}: {succeeded}/{total} researched, {findings_count} total findings."
Do NOT return raw data to the main conversation.
```

## Wave Management

### Key Principle: Maximize Parallelism, Minimize Prompts
Launch as many subagents as possible in a single message (up to ~6 Agent tool calls per message). Each subagent MUST batch all its operations.

### Discovery Phase
- Launch up to 6 discovery subagents in a single message
- Each subagent processes ALL its queries before returning
- After all waves complete, run `node {SKILL_DIR}/scripts/list_urls.mjs /tmp`
- **Filter URLs**: Remove blog posts, news articles, directories, competitors, existing customers

### Research Phase
- Companies per subagent varies by depth:
  - `quick`: ~10 companies per subagent
  - `deep`: ~5 companies per subagent
  - `deeper`: ~2-3 companies per subagent
- Each subagent writes ALL markdown files in a SINGLE Bash call (chained heredocs)

### Sizing Formula
```
search_queries = ceil(requested_companies / 35)
discovery_subagents = search_queries
expected_urls = search_queries * 20

quick:  research_subagents = ceil(expected_urls / 10)
deep:   research_subagents = ceil(expected_urls / 5)
deeper: research_subagents = ceil(expected_urls / 3)
```

### Error Handling
- If a subagent fails, log and continue with remaining batches
- If >50% of subagents fail in a wave, pause and inform the user
- If `extract_page.mjs` returns `FETCH_OK: false` with empty BODY, skip the company and mark `product_description` as Unknown (do not guess)

## Report + CSV Compilation

After all research subagents complete, compile the report:

```bash
node {SKILL_DIR}/scripts/compile_report.mjs {OUTPUT_DIR}
```

The script:
- Reads all `.md` files in `{OUTPUT_DIR}`
- Parses YAML frontmatter + body sections
- Deduplicates by normalized company name (keeps highest ICP score)
- Generates `{OUTPUT_DIR}/index.html` — scored overview page
- Generates `{OUTPUT_DIR}/companies/{slug}.html` — one page per company
- Generates `{OUTPUT_DIR}/results.csv` — spreadsheet for sheets/CRM

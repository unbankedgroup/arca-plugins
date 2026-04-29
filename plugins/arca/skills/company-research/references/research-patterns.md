# Company Research — Deep Research Patterns

## Overview

Two research contexts:
1. **Self-Research** (Step 1) — Deep research on the user's own company
2. **Target Research** (Step 4) — Research each discovered company

Both use the same 3-phase pattern but with different sub-questions and goals.

## Self-Research (User's Company)

### Sub-Questions
- "What does {company} sell and what specific problem does it solve?"
- "Who are {company}'s existing customers? What industries and company sizes?"
- "Who are {company}'s competitors and what differentiates them?"
- "What pricing model does {company} use and who is the typical buyer persona?"
- "What use cases and pain points does {company}'s marketing emphasize?"

### Page Discovery
Discover site pages dynamically — do NOT hardcode paths:
1. WebFetch `"{company website}/sitemap.xml"` — primary source
2. Scan sitemap URLs for keywords: `customer`, `case-stud`, `pricing`, `about`, `use-case`, `blog`, `industry`, `solution`
3. Pick the 3-5 most relevant URLs and WebFetch those
4. Also try `"{company website}/llms.txt"` for bonus page descriptions

### External Research
- WebSearch: `"{company} customers use cases reviews"`
- WebSearch: `"{company} alternatives competitors vs"`
- WebFetch 1-2 of the most informative third-party results (G2, blog posts, comparisons)

### Synthesis Output
- **Company**: name
- **Product**: what they sell, how it works, key capabilities (2-3 sentences, specific)
- **Existing Customers**: named customers or customer types found
- **Competitors**: who they compete with, key differentiators
- **Use Cases**: broad list of use cases the product serves

Do NOT include ICP, pitch angle, or sub-verticals in the profile. Those are per-run decisions.

---

## Target Company Research (Step 4)

### Sub-Question Templates

### Priority 1 (Always ask)
- **Product/Market**: "What does {company} sell and who are their customers?"
- **ICP Fit**: "How does {company}'s product/market relate to the ICP?"

### Priority 2 (Deep/Deeper modes)
- **Tech Stack**: "What technologies does {company} use?"
- **Growth Signals**: "Has {company} raised funding or expanded recently?"
- **Pain Points**: "What challenges might {company} face that our product addresses?"

### Priority 3 (Deeper only)
- **Decision Makers**: "Who leads engineering, product, or growth at {company}?"
- **Competitive Landscape**: "Who are {company}'s competitors?"
- **Customers/Case Studies**: "Who are {company}'s notable customers?"

### Search Query Patterns

```
# Product/Market
"{company name} what they do"
"{company name} product features customers"

# Tech Stack
"{company name} tech stack"
"{company name} careers engineer" (job posts reveal stack)

# Growth Signals
"{company name} funding round 2025 2026"
"{company name} launch announcement"

# Pain Points
"{company name} challenges {domain}"

# Decision Makers
"{company name} VP engineering CTO"
```

### Finding Format

Each finding is a self-contained factual statement tied to a source:
```
- **[high/medium/low]** {fact} (source: {url})
```

**Confidence levels**:
- `high`: Directly stated on the company's own website or official press
- `medium`: Inferred from job postings, third-party articles, or indirect signals
- `low`: Speculative based on industry/category

## Research Loop Rules

1. **Process sub-questions by priority** — Priority 1 first
2. **3-5 findings per sub-question, then move on**
3. **Rephrase, don't retry** — If a search returns poor results, try different keywords
4. **Fetch selectively** — Pick the 1-2 most relevant URLs based on title
5. **Stop at step limit** — Respect the depth mode's budget
6. **Homepage first** — Always fetch the company's homepage first
7. **Deduplicate findings** — Don't record the same fact twice

## Depth Mode Behavior

### Quick Mode (100+ leads)
- Skip Phase A — no sub-question decomposition
- Phase B: Fetch homepage, run 1-2 supplementary searches if needed
- Phase C: Extract available data, score ICP
- Budget: 2-3 total tool calls per company

### Deep Mode (25-50 leads)
- Phase A: 2-3 sub-questions (Priority 1 + selected Priority 2)
- Phase B: 2-3 searches + 1-2 fetches per sub-question
- Phase C: Synthesize with evidence
- Budget: 5-8 total tool calls per company

### Deeper Mode (10-25 leads)
- Phase A: 4-5 sub-questions (Priority 1 + 2 + selected Priority 3)
- Phase B: Exhaustive — fetch multiple pages per company
- Phase C: Detailed reasoning with cited evidence
- Budget: 10-15 total tool calls per company

## Synthesis Instructions

### ICP Scoring
- **8-10**: Strong match. Multiple high-confidence findings confirm fit.
- **5-7**: Partial match. Some relevance but key signals missing.
- **1-4**: Weak match. Wrong segment or no apparent connection.

Write `icp_fit_reasoning` referencing specific findings.

### Enrichment Fields
- `product_description` → from Product/Market findings
- `industry` → inferred from Product/Market
- `employee_estimate` → from LinkedIn or career page findings
- `funding_info` → from Growth Signals findings
- `headquarters` → from homepage or about page
- `target_audience` → from Product/Market findings
- `key_features` → from product page findings

### Anti-Hallucination Rules

1. **Typography is not a product.** Never infer from fonts, design system, or framework.
2. **No ICP leakage.** If the homepage is thin and search turns up nothing, do NOT default toward the ICP.
3. **Quote, don't paraphrase from memory.** Must be grounded in actual fetched content.
4. **Cap scores on thin evidence.** If `product_description` is `Unknown`, cap `icp_fit_score` ≤ 3.

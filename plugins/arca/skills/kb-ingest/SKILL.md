---
name: kb-ingest
description: Ingest a source document into Arca's knowledge base. Reads a source file or URL, compiles a summary into the wiki, updates INDEX and log, and touches related pages. Use whenever you finish research, capture a finding, or want to persist durable insights into the shared team memory.
---

# /kb-ingest skill

Ingest a source into the Arca vault (`/root/arca/vault/`). Following Karpathy's LLM-Wiki pattern.

## Usage

```
/kb-ingest <source-path-or-URL>
```

Examples:
- `/kb-ingest /tmp/competitor-deck.md`
- `/kb-ingest https://paperclip.ai/pricing`
- `/kb-ingest ~/research-notes/apr-18-icp-signals.md`

---

## Step 1 — Get the source into `raw/`

If a local file: copy into `/root/arca/vault/raw/` (preserve filename).
If a URL: use `agent-browser` to scrape, save output to `vault/raw/<slug>.md`:
```bash
agent-browser open "<URL>"
agent-browser get text "body" > /root/arca/vault/raw/<slug>.md
```

Don't modify raw/ content after this — it's immutable per the schema.

---

## Step 2 — Read `vault/CLAUDE.md` first

It defines the schema, author rules, and page structure. Follow it exactly.

---

## Step 3 — Compile wiki pages

Read the raw source. Extract:
- Concepts (abstract frameworks) → `vault/_wiki/concepts/<slug>.md`
- Entities (people, products, companies) → `vault/_wiki/entities/<slug>.md`
- Synthesis (cross-cutting analysis) → `vault/_wiki/synthesis/<slug>.md`

Every page gets YAML frontmatter:
```yaml
---
title: "..."
author: atlas   # ⚠️ MANDATORY — always your agent name. If you are Atlas: author: atlas. If you are Forge: author: forge. NEVER omit. NEVER author: agent or author: mal.
type: concept | entity | synthesis
created: YYYY-MM-DD
updated: YYYY-MM-DD
confidence: 1-5
tags: [...]
source_refs:
  - "raw/<file>.md"
---
```

⚠️ **AUTHOR TAG IS MANDATORY — NO EXCEPTIONS.** After writing any wiki page, immediately verify the frontmatter contains `author: <your-name>`. If you are Atlas, every single page must have `author: atlas`. Run this check after each batch:
```bash
find /root/arca/vault/_wiki -name "*.md" ! -name "index.md" ! -name "log.md" | xargs grep -L "^author:" 2>/dev/null
```
If any files are returned, they are missing the author tag — fix them before posting proof.

First line after frontmatter: one-paragraph summary.
Body: cross-link related pages with `[[wiki-link]]` (target another wiki page's slug).
End: `## See also` list.

One source can touch 5-15 wiki pages — update existing ones if they're relevant, create new ones for gaps.

---

## Step 4 — Update INDEX and log

`vault/_wiki/INDEX.md`: add one line per new page with a one-line description, grouped under the right category.

`vault/_wiki/log.md`: append one entry:
```
## [YYYY-MM-DD] ingest | <source title>
Touched: <list of wiki pages created or updated>
```

---

## Step 5 — Re-index qmd

After writing the wiki pages, re-index qmd so keyword search picks them up:
```bash
/root/.bun/bin/qmd update
```

**Do NOT run `qmd embed`** — it is disabled on this server (no GPU). KB server auto-indexes with Xenova embeddings.

---

## Step 6 — Confirm

Post a one-line summary of what was ingested: `"Ingested <source>. Created/updated N wiki pages: <list>."`

## Don't

- Modify raw/ files after step 1
- Modify any wiki page with `author: mal` — read and link only
- Skip frontmatter or citations
- Write the raw source text into a wiki page — wiki is compiled, not pasted

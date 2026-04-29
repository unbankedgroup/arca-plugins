---
name: kb-lint
description: Health check the Arca knowledge base vault. Finds contradictions, orphan pages, unsupported claims, missing cross-references, and stale entries. Use weekly or after a large ingest pass. Writes a report to vault/outputs/lint-report-YYYY-MM-DD.md.
---

# /kb-lint skill

Run a health pass over the vault. This is maintenance, not research.

## Usage

```
/kb-lint
```

No arguments. Scans everything under `/root/arca/vault/_wiki/`.

---

## Step 1 — Inventory

Count pages by folder. Check INDEX.md is current (every page listed). Check log.md has entries for every ingest.

```bash
find /root/arca/vault/_wiki -name "*.md" -not -name "index*" -not -name "log.md" | wc -l
```

---

## Step 2 — Checks

For every wiki page, run these checks and collect findings:

**Missing frontmatter:**
- No `author:` field → flag
- `author:` is not one of: `mal`, `cognis`, `forge`, `mara`, `atlas`, `studio`, `nexus`, `herald`, `ledger` (or a comma-separated list of those) → flag
- `author: agent` (old schema) → flag for retag
- No `confidence`, `tags`, `source_refs`, or `created` → flag
- `confidence: 5` on a page with no `source_refs` → flag (claims verified without evidence)

**Broken wiki links:**
- Any `[[link]]` pointing to a page that doesn't exist → flag with the source page and missing target

**Orphan pages:**
- Pages not linked from INDEX.md AND not linked from any other wiki page → flag

**Stale content:**
- `updated:` older than 90 days AND no recent activity in log.md → flag for refresh
- Claims that newer raw sources contradict — scan raw/ for recent additions and cross-check

**Gaps:**
- Topics mentioned in 3+ pages but with no dedicated wiki page → suggest creating one
- Concepts referenced in raw/ but not yet in _wiki/ → suggest ingest

**Contradictions:**
- Two pages making opposite claims about the same entity → flag both

**Author rule violations:**
- Any evidence an agent modified an `author: mal` page → high-priority flag

---

## Step 3 — Write the report

Output to `/root/arca/vault/outputs/lint-report-YYYY-MM-DD.md`:

```markdown
# KB Lint Report — YYYY-MM-DD

## Summary
- N total wiki pages
- N frontmatter issues
- N broken links
- N orphan pages
- N stale pages
- N gap suggestions
- N contradictions
- N author-rule violations (PRIORITY)

## Frontmatter issues
- [wiki page]: specific problem

## Broken links
- [source page] → [[missing target]]

## Orphans
- [wiki page] — suggest linking from [candidate index section]

## Stale
- [wiki page] (last updated YYYY-MM-DD) — newer source: raw/...

## Gaps
- "[topic]" is referenced in [N pages] but has no wiki page — suggest ingesting raw/...

## Contradictions
- [page A] vs [page B]: claim X is stated opposite

## Author violations (FIX IMMEDIATELY)
- [page]: author field changed from mal → agent (evidence from log.md)
```

---

## Step 4 — Don't fix, just report

Don't auto-fix. The point is a clean diagnostic for Atlas/Mal to act on. Fixing contradictions or deciding which page wins is a judgment call that needs a human or a curation pass — not silent overwrites.

Exception: **frontmatter-only mechanical fixes** (e.g. missing `author: agent` on a new page) can be applied automatically. Everything else: report only.

---

## Cadence

Weekly for Arca. Run as part of Atlas's Monday or Friday heartbeat.

After a large ingest pass: run immediately to catch drift.

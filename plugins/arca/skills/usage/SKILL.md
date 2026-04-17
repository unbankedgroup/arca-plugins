---
description: usage skill for Arca
---
# /usage skill

When this skill is invoked (from Telegram `/usage` or any usage check request):

1. Run: `python3 $ARCA_HOME/ops/agents/cognis/usage-check.py --short`
2. Capture stdout (two lines)
3. Reply via Telegram using the exact output — no extra text, no labels, no formatting

**Output format (do not alter):**
```
Claude: X% used | Xd Xh left
Ollama: X% used | resets in X days
```

That's it. Two lines. Send them as-is.

**Never:**
- Run without `--short`
- Add headers, labels, or surrounding text
- Pull from `/api/usage?ws=arca` (that's ops board cost tracking, not budget)

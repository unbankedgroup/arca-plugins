# Review Skill

Review a completed task against its spec. Produces a structured pass/fail verdict.

## Usage

```
/review <task_id> [CODE|CONTENT|RESEARCH]
```

If task type is not specified, infer it from the task title prefix:
- `[CODE]` → CODE
- `[CONTENT]` → CONTENT
- `[RESEARCH]` → RESEARCH

## Process

1. Fetch the task from the ops board: `ops_get_task <task_id>`
2. Read the task description, proof, and any linked specs
3. Check for a completion marker at `/tmp/arca-worker-complete-{task_id}.json`
4. If output_path in marker exists, read the deliverable(s)
5. Run the appropriate checklist below
6. Post the review as a comment on the task using `ops_comment_task`
7. If all checks pass: move task to `client_review` or `archived` as appropriate
8. If any check fails: move task back to `in_progress` with a comment explaining what to fix

## CODE Review Checklist

- [ ] **Compiles/runs**: Does the code compile or run without errors?
- [ ] **Meets spec**: Does it do what was asked in the task description?
- [ ] **Security**: No OWASP top 10 vulnerabilities (injection, XSS, CSRF, path traversal, auth bypass)?
- [ ] **Minimal**: No extra features beyond what was asked? No premature abstractions?
- [ ] **Decision log**: Does the completion marker explain key decisions?
- [ ] **No secrets**: No hardcoded credentials, API keys, or tokens in committed code?
- [ ] **Idempotent**: Can the change be safely re-applied without side effects?

## CONTENT Review Checklist

- [ ] **Format**: Matches requested format and length?
- [ ] **Voice**: Matches client voice and tone (check client.yaml)?
- [ ] **Accuracy**: No factual errors or unsupported claims?
- [ ] **Actionable**: Clear, specific, and actionable?
- [ ] **Style**: No em dashes or en dashes? No emojis unless requested?
- [ ] **Decision log**: Does the completion marker explain content choices?

## RESEARCH Review Checklist

- [ ] **Sources**: Claims backed by cited sources?
- [ ] **Direct answer**: Answers the question directly, then elaborates?
- [ ] **Balance**: Presents multiple perspectives, not just one?
- [ ] **Actionable**: Provides concrete recommendations, not just data?
- [ ] **Current**: Information is up to date (not stale)?
- [ ] **Decision log**: Does the completion marker explain research methodology?

## Verdict Format

Post a comment on the task in this format:

```
REVIEW: [PASS|FAIL]

Checklist:
- [x] Compiles/runs
- [x] Meets spec
- [ ] Security (FAIL: hardcoded API key found in data.ts line 189)

Notes: Brief overall assessment.
```

If FAIL, include specific line references and what needs to change.

## Auto-Review Thresholds

- If task has been in `ai_review` for > 30 minutes with no review: auto-move to `in_progress` with a ping to the reviewer
- If reviewer is offline: reassign review to another available coordinator
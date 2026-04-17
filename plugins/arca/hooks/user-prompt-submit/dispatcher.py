#!/usr/bin/env python3
"""
Cognis UserPromptSubmit dispatcher hook.
Reads skill-rules.json, matches inbound prompt keywords to skill names,
injects hookSpecificOutput.additionalContext with skill routing hint.
Fail-open on all errors.
"""

import json
import os
import sys
import re


RULES_PATH = os.path.join(os.path.dirname(__file__), "skill-rules.json")


def load_rules() -> list[dict]:
    with open(RULES_PATH, "r") as f:
        return json.load(f)


def match_skills(prompt: str, rules: list[dict]) -> list[str]:
    matched = []
    prompt_lower = prompt.lower()
    for rule in rules:
        any_keywords = rule.get("any_keyword", [])
        all_keywords = rule.get("all_keywords", [])

        any_hit = any(kw.lower() in prompt_lower for kw in any_keywords) if any_keywords else True
        all_hit = all(kw.lower() in prompt_lower for kw in all_keywords) if all_keywords else True

        if any_hit and all_hit:
            matched.append(rule["skill"])
    return matched


def is_ops_board_event(prompt: str) -> bool:
    """Return True if the prompt contains an ops-board channel message."""
    return 'source="ops-board"' in prompt or "source='ops-board'" in prompt


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            print(json.dumps({}))
            return

        data = json.loads(raw)
        prompt = data.get("prompt", "") or ""

        rules = load_rules()
        matched = match_skills(prompt, rules)

        # Mandatory: always load arca-ops on any ops-board channel event
        if is_ops_board_event(prompt) and "arca-ops" not in matched:
            matched.insert(0, "arca-ops")

        if matched:
            skills_str = ", ".join(f"/{s}" for s in matched)
            # arca-ops is mandatory for ops-board events, not just a suggestion
            if is_ops_board_event(prompt):
                context = (
                    f"MANDATORY SKILL: This is an ops-board event. Load /arca-ops immediately "
                    f"before taking any action. Skills matched: {skills_str}. "
                    f"Do not respond to this ops-board message without reading the arca-ops skill first."
                )
            else:
                context = (
                    f"SKILL ROUTING: This request matches: {skills_str}. "
                    f"Use the relevant skill(s) — do not do this work manually."
                )
            result = {
                "hookSpecificOutput": {
                    "additionalContext": context
                }
            }
        else:
            result = {}

        print(json.dumps(result))

    except Exception:
        # Fail-open
        print(json.dumps({}))


if __name__ == "__main__":
    main()

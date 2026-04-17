#!/usr/bin/env python3
"""
Cognis PreToolUse reply-validator hook.
Intercepts outbound Telegram messages and validates them before send.
Returns permissionDecision: "deny" with specific fix instruction if any rule fires.
Fail-open on parse errors.

Matched tools: mcp__plugin_telegram_telegram__reply
"""

import json
import sys
import re


def check(text: str) -> tuple[bool, str, str]:
    """Returns (passes, rule_name, fix_instruction)."""

    # Rule 1: No em dashes
    if "\u2014" in text or "\u2013" in text:
        return False, "no-em-dash", (
            "Remove em dashes (—) and en dashes (–). "
            "Use a plain hyphen or rewrite the sentence."
        )

    # Rule 2: No UTC times — always use EDT
    utc_pattern = re.compile(
        r"\b\d{1,2}:\d{2}\s*(UTC|GMT|Z)\b|"
        r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*?Z\b",
        re.IGNORECASE
    )
    if utc_pattern.search(text):
        return False, "edt-not-utc", (
            "Times must be in EDT (America/New_York), not UTC/GMT/Z. "
            "Convert the time and append EDT."
        )

    # Rule 3: No AI vocabulary
    ai_vocab = [
        r"\bcertainly\b", r"\babsolutely\b", r"\bof course\b",
        r"\bgreat question\b", r"\bexcellent question\b",
        r"\bi apologize\b", r"\bi'm sorry\b", r"\bi am sorry\b",
        r"\bas an ai\b", r"\bas a language model\b",
        r"\bi hope this helps\b", r"\bhappy to help\b",
        r"\bdelve\b", r"\bnavigate\b", r"\btailored\b",
        r"\bseamlessly\b", r"\bleverag(e|ing)\b",
    ]
    for pattern in ai_vocab:
        if re.search(pattern, text, re.IGNORECASE):
            matched = re.search(pattern, text, re.IGNORECASE).group(0)
            return False, "ai-vocabulary", (
                f"Remove AI-sounding phrase: \"{matched}\". "
                "Write like a direct human operator, not a chatbot."
            )

    # Rule 4: No premature deployment claims (narrowed — "done/complete" are valid status words)
    premature_done = re.compile(
        r"\b(deployed to prod|shipped to prod|pushed to prod|it('s| is) live|launched to prod)\b",
        re.IGNORECASE
    )
    if premature_done.search(text):
        match = premature_done.search(text).group(0)
        return False, "premature-done", (
            f"Claimed \"{match}\" — only say this if deployment is verified. "
            "If still in progress, say 'deploying now' or 'in progress'."
        )

    # Rule 5: No walls of text (Telegram is a mobile channel)
    lines = [l for l in text.split("\n") if l.strip()]
    word_count = len(text.split())
    if word_count > 300 and not any(c in text for c in ["```", "---", "##"]):
        return False, "telegram-concise", (
            f"Message is {word_count} words — too long for Telegram. "
            "Trim to key points. Use bullet points. "
            "If it's a full report, summarize here and mention the file path."
        )

    # Rule 6: No sending markdown-formatted walls (block quotes, headers)
    # in a message that's clearly a quick reply context
    header_count = len(re.findall(r"^#{1,3} ", text, re.MULTILINE))
    if header_count > 3 and word_count < 100:
        return False, "markdown-in-telegram", (
            "Too many headers for a short Telegram message. "
            "Flatten to plain text or bullet points."
        )

    return True, "", ""


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            print(json.dumps({"permissionDecision": "allow"}))
            return

        data = json.loads(raw)
        tool_input = data.get("tool_input", {})

        # Extract message text from the reply tool's input
        text = tool_input.get("text", "") or tool_input.get("message", "")
        if not text:
            print(json.dumps({"permissionDecision": "allow"}))
            return

        passes, rule, fix = check(text)

        if not passes:
            result = {
                "permissionDecision": "deny",
                "reason": f"[reply-validator: {rule}] {fix}"
            }
        else:
            result = {"permissionDecision": "allow"}

        print(json.dumps(result))

    except Exception:
        # Fail-open: don't brick outbound messaging on a parser bug
        print(json.dumps({"permissionDecision": "allow"}))


if __name__ == "__main__":
    main()

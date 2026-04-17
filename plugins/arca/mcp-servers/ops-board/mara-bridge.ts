#!/usr/bin/env bun
/**
 * Mara Ops Bridge — relays ops board commands/task-assignments to Hermes (Mara agent).
 *
 * Polls ops.runarca.xyz for pending commands @Mara and task assignments where owner=Mara.
 * For each hit, POSTs to the Hermes API to inject the message into Mara's active session.
 *
 * Dedup: keeps seen command IDs in memory (TTL 24h).
 */

const OPS_BOARD_URL = process.env.OPS_BOARD_URL || "https://ops.runarca.xyz";
const HERMES_API_URL = process.env.HERMES_API_URL || "http://localhost:8642";
const HERMES_ENV_FILE = process.env.HERMES_ENV_FILE || "/root/.hermes/profiles/mara/.env";
const SESSIONS_FILE = process.env.SESSIONS_FILE || "/root/.hermes/profiles/mara/sessions/sessions.json";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "5000");
const WORKSPACE = "arca";
const MODEL = "hermes-agent";

function readApiKey(): string {
  if (process.env.HERMES_API_KEY) return process.env.HERMES_API_KEY;
  try {
    const txt = require("fs").readFileSync(HERMES_ENV_FILE, "utf-8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*API_SERVER_KEY\s*=\s*(.+)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
  return "";
}

const seenIds = new Map<string, number>(); // id -> timestamp
const DEDUP_TTL = 24 * 60 * 60 * 1000; // 24h

function getActiveSessionId(): string | null {
  try {
    const data = JSON.parse(require("fs").readFileSync(SESSIONS_FILE, "utf-8"));
    // Pick the most recently updated DM session
    let best: { key: string; updated: string; id: string } | null = null;
    for (const [key, val] of Object.entries(data)) {
      const v = val as any;
      if (v.platform === "telegram" && v.chat_type === "dm" && !v.suspended) {
        if (!best || v.updated_at > best.updated) {
          best = { key, updated: v.updated_at, id: v.session_id };
        }
      }
    }
    return best?.id || null;
  } catch {
    return null;
  }
}

async function relayToMara(content: string): Promise<boolean> {
  const sessionId = getActiveSessionId();
  if (!sessionId) {
    console.error(`[${new Date().toISOString()}] No active Mara session found`);
    return false;
  }

  try {
    const res = await fetch(`${HERMES_API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.HERMES_API_KEY || ""}`,
        "X-Hermes-Session-Id": sessionId,
      },
      body: JSON.stringify({
        model: "mara",
        messages: [{ role: "user", content }],
      }),
    });
    const json = await res.json() as any;
    const reply = json.choices?.[0]?.message?.content || "(no reply)";
    console.log(`[${new Date().toISOString()}] Relay OK — Mara replied: ${reply.slice(0, 100)}`);
    return true;
  } catch (e: any) {
    console.error(`[${new Date().toISOString()}] Relay failed: ${e.message}`);
    return false;
  }
}

async function pollCommands(): Promise<void> {
  try {
    const res = await fetch(`${OPS_BOARD_URL}/api/commands?ws=${WORKSPACE}&status=pending`);
    const cmds = await res.json() as any[];
    for (const cmd of cmds) {
      if (seenIds.has(cmd.id)) continue;
      const targets: string[] = cmd.for || [];
      if (!targets.includes("Mara")) continue;

      seenIds.set(cmd.id, Date.now());
      const from = cmd.from || "unknown";
      const text = cmd.text || "";
      const relayContent = `[Ops Board] ${from}: ${text}`;

      console.log(`[${new Date().toISOString()}] Relaying command ${cmd.id} from ${from}: "${text.slice(0, 60)}"`);
      await relayToMara(relayContent);

      // Mark command as responded
      try {
        await fetch(`${OPS_BOARD_URL}/api/commands/${cmd.id}/respond?ws=${WORKSPACE}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ by: "Mara", text: "Received via ops bridge" }),
        });
      } catch {}
    }
  } catch (e: any) {
    console.error(`[${new Date().toISOString()}] Commands poll error: ${e.message}`);
  }
}

async function pollTaskAssignments(): Promise<void> {
  try {
    const res = await fetch(`${OPS_BOARD_URL}/api/tasks?ws=${WORKSPACE}`);
    const data = await res.json() as any;
    const tasks = data.tasks || [];

    for (const task of tasks) {
      const taskKey = `task:${task.id}:${task.status}`;
      if (seenIds.has(taskKey)) continue;
      if (task.owner !== "Mara") continue;
      if (task.status !== "assigned") continue;

      seenIds.set(taskKey, Date.now());

      // Fetch full task detail to avoid any stale/missing fields from the list endpoint
      let detail: any = task;
      try {
        const detailRes = await fetch(`${OPS_BOARD_URL}/api/tasks/${task.id}?ws=${WORKSPACE}`);
        if (detailRes.ok) detail = await detailRes.json();
      } catch {}

      const desc = (detail.description || "").slice(0, 1500);
      const orig = detail.original_request ? `\nOriginal request: ${detail.original_request}` : "";
      const content = `[Ops Board] New task assigned to you: "${detail.title}"\nTask ID: ${detail.id}\nPriority: ${detail.priority || "medium"}${orig}\n\nDescription:\n${desc}\n\nPick it up per your arca-worker skill: PUT to in_progress, comment your plan, do the work, post the deliverable as a comment, PUT to ai_review with proof.`;

      console.log(`[${new Date().toISOString()}] Relaying task assignment ${task.id}: "${task.title}" (desc ${desc.length} chars)`);
      await relayToMara(content);
    }
  } catch (e: any) {
    console.error(`[${new Date().toISOString()}] Task poll error: ${e.message}`);
  }
}

// Prune old seen IDs every 5 minutes
function pruneSeenIds(): void {
  const cutoff = Date.now() - DEDUP_TTL;
  for (const [id, ts] of seenIds) {
    if (ts < cutoff) seenIds.delete(id);
  }
}

// Main loop — load API key from Mara's .env if not in environment
if (!process.env.HERMES_API_KEY) {
  process.env.HERMES_API_KEY = readApiKey();
}
console.log(`[${new Date().toISOString()}] Mara Ops Bridge starting — polling ${OPS_BOARD_URL} every ${POLL_INTERVAL_MS}ms`);
console.log(`[${new Date().toISOString()}]   API key: ${process.env.HERMES_API_KEY ? "loaded" : "MISSING"} | env: ${HERMES_ENV_FILE}`);

setInterval(() => {
  pollCommands();
  pollTaskAssignments();
}, POLL_INTERVAL_MS);

setInterval(pruneSeenIds, 5 * 60 * 1000);

// Initial poll
pollCommands();
pollTaskAssignments();
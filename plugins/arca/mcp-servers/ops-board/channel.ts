#!/usr/bin/env bun
/**
 * Arca Ops Board Channel Plugin
 *
 * Bridges the ops board (task/command system) to a running Claude Code session.
 * When someone tags an agent via @Name in the command center, this channel
 * pushes the message directly into the Claude session — no polling by the agent,
 * no tmux hacks, no separate instances.
 *
 * Architecture:
 *   Board server (remote) ←→ Channel plugin (local, polls) ←→ Claude Code session
 *
 * The plugin:
 *   1. Polls the board API for pending commands tagged to this agent
 *   2. Polls for task comments mentioning this agent
 *   3. Pushes notifications into the running Claude session via MCP
 *   4. Exposes tools so Claude can respond directly to commands and tasks
 *
 * Usage:
 *   claude --channels server:ops-board
 *
 * Environment:
 *   OPS_BOARD_URL    — board API base URL (default: https://ops.runarca.xyz)
 *   OPS_AGENT_NAME   — this agent's name on the board (default: Cognis)
 *   OPS_POLL_INTERVAL — poll interval in ms (default: 5000)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BOARD_URL = process.env.OPS_BOARD_URL || "https://ops.runarca.xyz";
const AGENT_NAME = process.env.OPS_AGENT_NAME || "Cognis";
const POLL_INTERVAL = parseInt(process.env.OPS_POLL_INTERVAL || "5000", 10);
const WS = process.env.OPS_WORKSPACE || "arca";

// Per-agent log paths so 9 agents don't race on the same files.
const AGENT_SLUG = AGENT_NAME.toLowerCase();
const CRASH_LOG = `/tmp/ops-channel-${AGENT_SLUG}.err`;
const DEAD_MARKER = `/tmp/ops-channel-${AGENT_SLUG}.dead`;
const ERROR_LOG = `/tmp/ops-board-error-${AGENT_SLUG}.txt`;
const LAST_NOTIFY_LOG = `/tmp/ops-board-last-notify-${AGENT_SLUG}.txt`;

// Clear any stale dead marker from a previous run.
try { require("fs").unlinkSync(DEAD_MARKER); } catch {}

// Stdio failure mode: when Claude Code closes our stdout pipe mid-session, the SDK's
// next notification() write throws EPIPE. The old handler just logged and kept
// running with a dead stdout, so notifications were silently lost until someone
// manually restarted the whole tmux session. The fix: detect stdio death, drop a
// breadcrumb the keepalive can see, then exit nonzero so keepalive kill+relaunches
// the session within one cron tick (≤60s).
let stdioDead = false;

function isStdioError(err: any): boolean {
  const msg = String(err?.message || err || "");
  return /EPIPE|broken pipe|write after end|stream destroyed|closed|ERR_STREAM_DESTROYED|ECONNRESET/i.test(msg);
}

function markStdioDead(err: any) {
  if (stdioDead) return;
  stdioDead = true;
  const stamp = new Date().toISOString();
  try {
    Bun.write(DEAD_MARKER,
      `[${stamp}] stdio dead — agent: ${AGENT_NAME}\nerror: ${err?.message || String(err)}\nstack: ${err?.stack || "none"}\n`
    ).catch(() => {});
  } catch {}
  try { process.stderr.write(`[${stamp}] ${AGENT_NAME} channel: stdio dead, exiting for keepalive restart\n`); } catch {}
  // Exit nonzero after a short delay so the write flushes. Keepalive's port check
  // will see the unbinded webhook port and kill+relaunch the tmux session.
  setTimeout(() => { try { process.exit(1); } catch {} }, 200);
}

// Crash-resistance: never let an unhandled rejection or sync throw silently kill us
// UNLESS it's a stdio-death signature, in which case exit so keepalive restarts.
process.on("unhandledRejection", (reason: any) => {
  if (isStdioError(reason)) { markStdioDead(reason); return; }
  try {
    Bun.write(CRASH_LOG, `[${new Date().toISOString()}] unhandledRejection: ${reason}\n` + (reason instanceof Error ? (reason.stack || "") : ""));
  } catch {}
});
process.on("uncaughtException", (err: any) => {
  if (isStdioError(err)) { markStdioDead(err); return; }
  try {
    Bun.write(CRASH_LOG, `[${new Date().toISOString()}] uncaughtException: ${err.message}\n${err.stack || ""}`);
  } catch {}
});

// Direct stdout/stdin error listeners — fire immediately on EPIPE write errors
// before they bubble up as unhandled rejections.
try { process.stdout.on("error", (err: any) => { if (isStdioError(err)) markStdioDead(err); }); } catch {}
try { process.stdin.on("error", (err: any) => { if (isStdioError(err)) markStdioDead(err); }); } catch {}

function api(path: string, extraParams?: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${BOARD_URL}${path}${sep}ws=${WS}${extraParams ? "&" + extraParams : ""}`;
}

// Track what we've already notified about. Capped + insertion-ordered (Set preserves
// insertion order) so long-running agents don't leak memory or collide on recycled IDs.
const seenCommands = new Set<string>();
const seenComments = new Set<string>();
const pendingReviewTasks = new Set<string>();  // task_ids with unacted-upon review notifications
const pendingApprovalTasks = new Set<string>();  // task_ids in human_review awaiting Mal's approval
const MAX_SEEN = 2000;

function addSeen(set: Set<string>, key: string) {
  if (set.has(key)) return;
  if (set.size >= MAX_SEEN) {
    const first = set.values().next().value;
    if (first !== undefined) set.delete(first);
  }
  set.add(key);
}

// ── Notification Queue ───────────────────────────────────────
// When the agent is mid-tool-use, pushing a notification interrupts the call.
// We queue notifications and only drain the queue when the session has been
// idle (no tool call in progress) for a quiet period.

let inToolUse = false;
let toolUseDoneAt = 0;          // timestamp of last tool-use completion
let lastToolUseStartedAt = 0;   // timestamp of last tool-use start
const QUIET_PERIOD_MS = 800;    // wait this long after tool-use ends before draining
const MAX_QUEUE_DEPTH = 50;
const TOOL_USE_TIMEOUT_MS = 30000; // if inToolUse stuck true for >30s, force-reset

let droppedCount = 0;           // count of notifications dropped due to queue overflow

interface QueuedNotification {
  method: string;
  params: Record<string, any>;
  dedupeKey?: string;  // coalesce duplicates by this key
}

const notificationQueue: QueuedNotification[] = [];

async function queuedNotification(method: string, params: Record<string, any>, dedupeKey?: string) {
  if (inToolUse || (Date.now() - toolUseDoneAt) < QUIET_PERIOD_MS) {
    // Enqueue — but cap queue depth and coalesce duplicates
    if (notificationQueue.length >= MAX_QUEUE_DEPTH) {
      droppedCount++;
      const msg = `[${new Date().toISOString()}] Queue overflow (depth ${MAX_QUEUE_DEPTH}) — dropped notification: ${method} key=${dedupeKey || 'none'}\n`;
      process.stderr.write(msg);
      return;
    }
    // Check for duplicate (same dedupeKey)
    if (dedupeKey && notificationQueue.some(n => n.dedupeKey === dedupeKey)) {
      return; // already queued
    }
    notificationQueue.push({ method, params, dedupeKey });
  } else {
    // Session idle — send immediately
    try {
      await mcp.notification({ method, params });
    } catch (err: any) {
      try {
        await Bun.write(ERROR_LOG,
          `NOTIFICATION FAILED at ${new Date().toISOString()}\nmethod: ${method}\nerror: ${err?.message || String(err)}\nstack: ${err?.stack || 'none'}\n`
        );
      } catch {}
    }
  }
}

let drainInProgress = false;

async function drainQueue() {
  if (inToolUse || drainInProgress || notificationQueue.length === 0) return;
  drainInProgress = true;
  try {
    // Drain all queued notifications
    const batch = notificationQueue.splice(0, notificationQueue.length);
    for (const n of batch) {
      try {
        await mcp.notification({ method: n.method, params: n.params });
      } catch (err: any) {
        try {
          await Bun.write(ERROR_LOG,
            `QUEUED NOTIFICATION FAILED at ${new Date().toISOString()}\nmethod: ${n.method}\nerror: ${err?.message || String(err)}\nstack: ${err?.stack || 'none'}\n`
          );
        } catch {}
      }
    }
  } finally {
    drainInProgress = false;
  }
}

// Safety interval: drain queue, watchdog stuck inToolUse, check parent stdio
setInterval(() => {
  // Watchdog: if inToolUse has been true for >30s, it's stuck (parent died mid-tool-call)
  if (inToolUse && lastToolUseStartedAt > 0 && (Date.now() - lastToolUseStartedAt) > TOOL_USE_TIMEOUT_MS) {
    const msg = `[${new Date().toISOString()}] Watchdog: inToolUse stuck for ${Math.round((Date.now() - lastToolUseStartedAt) / 1000)}s — force-resetting\n`;
    process.stderr.write(msg);
    inToolUse = false;
    toolUseDoneAt = Date.now();
    // Immediately drain any queued notifications after force-reset.
    // Unawaited promise — .catch to prevent unhandled rejection if drain throws.
    drainQueue().catch(() => {});
  }

  // Stdio check: if parent process is dead, exit cleanly so keepalive can restart
  try {
    // Writing to a closed pipe throws; stdin being closed means parent is gone
    if (process.stdin.destroyed || process.stdout.destroyed) {
      process.stderr.write(`[${new Date().toISOString()}] Parent stdio pipe closed — exiting\n`);
      process.exit(0);
    }
  } catch (e: any) {
    process.stderr.write(`[${new Date().toISOString()}] Stdio check failed: ${e?.message || String(e)}\n`);
  }

  // Drain queue if idle
  if (!inToolUse && notificationQueue.length > 0) {
    drainQueue().catch(() => {});
  }
}, 2000);

// ── MCP Server ──────────────────────────────────────────────

const mcp = new Server(
  { name: "ops-board", version: "1.0.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: `You are connected to the Arca Ops Board at ${BOARD_URL}.

When you receive a <channel source="ops-board" type="command" ...> message, someone has tagged you in the command center. Read the command, do the work, and respond using the ops_respond_command tool.

When you receive a <channel source="ops-board" type="task_comment" ...> message, someone has commented on a task assigned to you. Read the comment, do the work, and post your response using the ops_comment_task tool.

When you receive a <channel source="ops-board" type="task_assigned" ...> message, a task has been assigned to you. Pull it, update status to in_progress, and start working.

Available tools:
- ops_respond_command: Respond to a command from the command center
- ops_comment_task: Add a comment to a task
- ops_update_task: Update a task's status, title, or description
- ops_get_tasks: Get all tasks from the board
- ops_create_schedule: Create a recurring or n-times scheduled task (cron-based, EDT)
- ops_list_schedules: List all schedules with current state
- ops_update_schedule: Update or pause/resume a schedule
- ops_run_schedule_now: Manually fire a schedule once
- ops_delete_schedule: Permanently delete a schedule
- ops_get_task: Get a single task with full comment thread
- ops_create_task: Create a new task
- ops_create_command: Send a command to another agent (shows as coming from you, not Mal)`,
  }
);

// ── Tools ───────────────────────────────────────────────────

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ops_respond_command",
      description:
        "Respond to a command from the ops board command center",
      inputSchema: {
        type: "object" as const,
        properties: {
          command_id: { type: "string", description: "The command ID to respond to" },
          text: { type: "string", description: "Your response text" },
        },
        required: ["command_id", "text"],
      },
    },
    {
      name: "ops_comment_task",
      description: "Add a comment to a task on the ops board",
      inputSchema: {
        type: "object" as const,
        properties: {
          task_id: { type: "string", description: "The task ID" },
          text: { type: "string", description: "Comment text" },
        },
        required: ["task_id", "text"],
      },
    },
    {
      name: "ops_update_task",
      description:
        "Update a task on the ops board (status, title, description, owner)",
      inputSchema: {
        type: "object" as const,
        properties: {
          task_id: { type: "string", description: "The task ID" },
          status: {
            type: "string",
            enum: ["assigned", "in_progress", "ai_review", "human_review", "client_review", "archived"],
            description: "New status",
          },
          title: { type: "string", description: "New title (optional)" },
          description: { type: "string", description: "New description (optional)" },
          owner: { type: "string", description: "New owner (optional)" },
          proof: { type: "string", description: "Proof of work (required before moving to ai_review)" },
          review_count: { type: "number", description: "Number of review rounds (max 3)" },
          original_request: { type: "string", description: "Original plain-English request from Mal" },
        },
        required: ["task_id"],
      },
    },
    {
      name: "ops_get_tasks",
      description: "Get all tasks from the ops board",
      inputSchema: {
        type: "object" as const,
        properties: {
          status: {
            type: "string",
            enum: ["assigned", "in_progress", "ai_review", "human_review", "client_review", "archived"],
            description: "Filter by status (optional)",
          },
        },
      },
    },
    {
      name: "ops_get_task",
      description: "Get a single task with full comment thread",
      inputSchema: {
        type: "object" as const,
        properties: {
          task_id: { type: "string", description: "The task ID" },
        },
        required: ["task_id"],
      },
    },
    {
      name: "ops_create_task",
      description: "Create a new task on the ops board",
      inputSchema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Task title" },
          description: { type: "string", description: "Task description" },
          priority: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "Priority level",
          },
          owner: { type: "string", description: "Who owns this task" },
        },
        required: ["title"],
      },
    },
    {
      name: "ops_create_command",
      description: "Send a command/request to another agent on the ops board. The command will show as coming from you (not Mal). Use this to delegate work or send instructions to another agent.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: { type: "string", description: "The command text. Use @AgentName to address a specific agent, e.g. '@Ghost please research X'. If no @mention, routes to the workspace default agent." },
          to: { type: "string", description: "Optional. Explicitly set the target agent name (e.g. 'Ghost'). Can also be set via @mention in text." },
        },
        required: ["text"],
      },
    },
    {
      name: "ops_create_schedule",
      description: "Create a recurring or time-bound scheduled task on the ops board. Fires automatically per the cron expression. Set max_runs for n-times schedules; omit for forever-recurring.",
      inputSchema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Title of the task that will be spawned each time the schedule fires" },
          description: { type: "string", description: "Task description / instructions for the assigned agent" },
          owner: { type: "string", description: "Who the spawned tasks should be assigned to (e.g. Atlas, Mara, Cognis)" },
          priority: { type: "string", enum: ["high", "medium", "low"], description: "Priority of spawned tasks" },
          cron_expr: { type: "string", description: "5-field cron expression in local time (EDT). E.g. '0 9 * * *' = daily 9 AM. '0 9 * * 1-5' = weekdays 9 AM. '0 17 * * 0' = Sundays 5 PM." },
          max_runs: { type: "number", description: "Optional. If set, schedule auto-disables after this many fires. Omit for forever-recurring." },
        },
        required: ["title", "owner", "cron_expr"],
      },
    },
    {
      name: "ops_list_schedules",
      description: "List all schedules on the ops board with their current state (cron, owner, runs count, next fire, enabled).",
      inputSchema: {
        type: "object" as const,
        properties: {
          enabled_only: { type: "boolean", description: "If true, only return enabled schedules" },
        },
      },
    },
    {
      name: "ops_update_schedule",
      description: "Update an existing schedule. Pass only the fields you want to change. To pause: enabled=false. To resume: enabled=true.",
      inputSchema: {
        type: "object" as const,
        properties: {
          schedule_id: { type: "string", description: "The schedule ID (starts with 'sch')" },
          title: { type: "string", description: "New title for spawned tasks" },
          description: { type: "string", description: "New description for spawned tasks" },
          owner: { type: "string", description: "New owner" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          cron_expr: { type: "string", description: "New cron expression" },
          max_runs: { type: "number", description: "New max runs (or null to make it forever)" },
          enabled: { type: "boolean", description: "true to enable, false to pause" },
        },
        required: ["schedule_id"],
      },
    },
    {
      name: "ops_run_schedule_now",
      description: "Manually fire a schedule once — spawns the templated task immediately and increments runs_count.",
      inputSchema: {
        type: "object" as const,
        properties: {
          schedule_id: { type: "string", description: "The schedule ID" },
        },
        required: ["schedule_id"],
      },
    },
    {
      name: "ops_delete_schedule",
      description: "Permanently delete a schedule. Doesn't affect already-spawned tasks.",
      inputSchema: {
        type: "object" as const,
        properties: {
          schedule_id: { type: "string", description: "The schedule ID" },
        },
        required: ["schedule_id"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  inToolUse = true;
  lastToolUseStartedAt = Date.now();
  try {
    const result = await handleToolCall(req);
    return result;
  } finally {
    inToolUse = false;
    toolUseDoneAt = Date.now();
    // Drain queue after a short delay to let the tool response propagate first.
    // Wrap in try/catch so a drain failure doesn't escape as an unhandled rejection.
    setTimeout(() => { drainQueue().catch(() => {}); }, QUIET_PERIOD_MS);
  }
});

async function handleToolCall(req: any) {
  const args = req.params.arguments as Record<string, string>;

  switch (req.params.name) {
    case "ops_respond_command": {
      const res = await fetch(
        api(`/api/commands/${args.command_id}/respond`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ by: AGENT_NAME, text: args.text }),
        }
      );
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "ops_comment_task": {
      const res = await fetch(
        api(`/api/tasks/${args.task_id}/comments`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ by: AGENT_NAME, text: args.text }),
        }
      );
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify({ success: data.success !== false, id: args.task_id }, null, 2) }] };
    }

    case "ops_update_task": {
      const body: Record<string, any> = { by: AGENT_NAME };
      if (args.status) body.status = args.status;
      if (args.title) body.title = args.title;
      if (args.description) body.description = args.description;
      if (args.owner) body.owner = args.owner;
      if (args.proof) body.proof = args.proof;
      if (args.review_count !== undefined) body.review_count = Number(args.review_count);
      if (args.original_request) body.original_request = args.original_request;

      const res = await fetch(api(`/api/tasks/${args.task_id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify({ success: data.success !== false, id: args.task_id }, null, 2) }] };
    }

    case "ops_get_tasks": {
      const res = await fetch(api("/api/tasks"));
      const data = await res.json();
      let tasks = data.tasks || [];
      if (args.status) {
        tasks = tasks.filter((t: any) => t.status === args.status);
      }
      // Slim: only summary fields for list view (use ops_get_task for full details)
      const slim = tasks.map((t: any) => ({ id: t.id, title: t.title, status: t.status, owner: t.owner }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: slim.length, tasks: slim }, null, 2),
          },
        ],
      };
    }

    case "ops_get_task": {
      const res = await fetch(api("/api/tasks/" + args.task_id));
      if (!res.ok) {
        return { content: [{ type: "text", text: `Task ${args.task_id} not found` }] };
      }
      const task = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    }

    case "ops_create_task": {
      const res = await fetch(api("/api/tasks"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: args.title,
          description: args.description || "",
          priority: args.priority || "medium",
          owner: args.owner || AGENT_NAME,
          by: AGENT_NAME,
        }),
      });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify({ success: data.success !== false, id: data.id || "" }, null, 2) }] };
    }

    case "ops_create_command": {
      const text = String(args.text || "");
      const body: Record<string, any> = { text, from: AGENT_NAME, by: AGENT_NAME };
      if (args.to) body.for = String(args.to);
      const res = await fetch(api("/api/commands"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify({ success: !data.error, id: data.id || "", error: data.error || undefined }, null, 2) }] };
    }

    case "ops_create_schedule": {
      const body = {
        template: {
          title: args.title,
          description: args.description || "",
          owner: args.owner,
          priority: args.priority || "medium",
        },
        cron_expr: args.cron_expr,
        timezone: "America/New_York",
        max_runs: args.max_runs !== undefined ? Number(args.max_runs) : null,
        enabled: true,
        by: AGENT_NAME,
      };
      const res = await fetch(api("/api/schedules"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify({ success: !data.error, id: data.id || "", error: data.error || undefined }, null, 2) }] };
    }

    case "ops_list_schedules": {
      const res = await fetch(api("/api/schedules"));
      const data = await res.json();
      let items = Array.isArray(data) ? data : [];
      if (args.enabled_only) items = items.filter((s: any) => s.enabled !== false);
      const slim = items.map((s: any) => ({
        id: s.id,
        title: s.template?.title,
        owner: s.template?.owner,
        cron_expr: s.cron_expr,
        runs_count: s.runs_count,
        max_runs: s.max_runs,
        next_run_at: s.next_run_at,
        enabled: s.enabled,
      }));
      return { content: [{ type: "text", text: JSON.stringify({ count: slim.length, schedules: slim }, null, 2) }] };
    }

    case "ops_update_schedule": {
      const body: Record<string, any> = { by: AGENT_NAME };
      const tplFields: Record<string, any> = {};
      if (args.title) tplFields.title = args.title;
      if (args.description !== undefined) tplFields.description = args.description;
      if (args.owner) tplFields.owner = args.owner;
      if (args.priority) tplFields.priority = args.priority;
      if (Object.keys(tplFields).length > 0) body.template = tplFields;
      if (args.cron_expr) body.cron_expr = args.cron_expr;
      if (args.max_runs !== undefined) body.max_runs = args.max_runs === null ? null : Number(args.max_runs);
      if (args.enabled !== undefined) body.enabled = args.enabled;
      const res = await fetch(api(`/api/schedules/${args.schedule_id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify({ success: !data.error, id: args.schedule_id, error: data.error || undefined }, null, 2) }] };
    }

    case "ops_run_schedule_now": {
      const res = await fetch(api(`/api/schedules/${args.schedule_id}/run-now`), { method: "POST" });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify({ success: !data.error, spawned_task_id: data.task_id || data.id || null, error: data.error || undefined }, null, 2) }] };
    }

    case "ops_delete_schedule": {
      const res = await fetch(api(`/api/schedules/${args.schedule_id}`), { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      return { content: [{ type: "text", text: JSON.stringify({ success: !data.error, id: args.schedule_id, error: data.error || undefined }, null, 2) }] };
    }

    default:
      throw new Error(`Unknown tool: ${req.params.name}`);
  }
}

// ── Polling Loop ────────────────────────────────────────────

async function pollSlashFeedback() {
  try {
    const res = await fetch(api("/api/slash-feedback?for=" + AGENT_NAME));
    const feedback: any[] = await res.json();

    for (const fb of feedback) {
      if (!seenCommands.has(fb.id)) {
        addSeen(seenCommands,fb.id);

        try {
          await queuedNotification("notifications/claude/channel", {
            content: `${fb.from} sent feedback: ${fb.text}`,
            meta: {
              type: "feedback",
              from: String(fb.from || ""),
              to: String(fb.to || ""),
              text: String(fb.text || ""),
              timestamp: String(fb.timestamp || ""),
            },
          }, `feedback:${fb.id}`);

          // Mark as delivered
          await fetch(api(`/api/slash-feedback/${fb.id}`), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ delivered: true }),
          });
        } catch (err: any) {
          try {
            await Bun.write(ERROR_LOG,
              `SLASH FEEDBACK FAILED at ${new Date().toISOString()}\nfb: ${fb.id}\nerror: ${err?.message || String(err)}\nstack: ${err?.stack || 'none'}\n`
            );
          } catch {}
        }
      }
    }
  } catch (err: any) {
    process.stderr.write(`[${new Date().toISOString()}] pollSlashFeedback failed: ${err?.message || String(err)}\n`);
  }
}

async function pollCommands() {
  try {
    const res = await fetch(api("/api/commands"));
    const commands: any[] = await res.json();

    for (const cmd of commands) {
      // Only process pending commands tagged to this agent
      if (
        cmd.status === "pending" &&
        Array.isArray(cmd.for) &&
        cmd.for.some((x: string) => x === AGENT_NAME) &&
        !seenCommands.has(cmd.id)
      ) {
        try {
          // Build attachment URLs if present
          const attachmentUrls = (cmd.attachments && Array.isArray(cmd.attachments) && cmd.attachments.length > 0)
            ? cmd.attachments.map((a: any) => `${BOARD_URL}/api/attachments/${WS}/${cmd.id}/${a.name}`)
            : [];
          const contentParts = [`From ${cmd.from}: ${cmd.text}`];
          if (attachmentUrls.length > 0) {
            contentParts.push(`Attachments: ${attachmentUrls.join(" ")}`);
          }
          await queuedNotification("notifications/claude/channel", {
            content: contentParts.join("\n"),
            meta: {
              type: "command",
              command_id: cmd.id,
              from: cmd.from,
              task_id: cmd.task_id || "",
              attachments: attachmentUrls.join(" "),
            },
          }, `cmd:${cmd.id}`);
          // Only mark seen AFTER the notification lands. On EPIPE/transient failure, the
          // next 5s poll retries — otherwise we'd silently drop commands on the floor.
          addSeen(seenCommands,cmd.id);
          // Auto-ack the command as received so the board knows it was delivered.
          // This moves status from "pending" → "in_progress", which prevents the
          // startup sweep from re-firing it if the plugin restarts before Donna responds.
          try {
            await fetch(api(`/api/commands/${cmd.id}/respond`), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ by: AGENT_NAME, text: "received" }),
            });
          } catch {}
          try {
            await Bun.write(LAST_NOTIFY_LOG,
              `SENT notification at ${new Date().toISOString()}\ncmd: ${cmd.id}\ntext: ${cmd.text}\n`
            );
          } catch {}
        } catch (err: any) {
          try {
            await Bun.write(ERROR_LOG,
              `NOTIFICATION FAILED at ${new Date().toISOString()}\ncmd: ${cmd.id}\nerror: ${err?.message || String(err)}\nstack: ${err?.stack || 'none'}\n`
            );
          } catch {}
        }
      }
    }
  } catch (err: any) {
    process.stderr.write(`[${new Date().toISOString()}] pollCommands failed: ${err?.message || String(err)}\n`);
  }
}

async function pollTasks() {
  try {
    const res = await fetch(api("/api/tasks"));
    const data = await res.json();
    const tasks = data.tasks || [];

    for (const task of tasks) {
      // Check for new comments mentioning this agent
      if (Array.isArray(task.comments)) {
        for (const comment of task.comments) {
          const commentKey = `${task.id}:${comment.timestamp}`;
          if (
            !seenComments.has(commentKey) &&
            comment.by !== AGENT_NAME &&
            comment.text?.toLowerCase().includes(`@${AGENT_NAME.toLowerCase()}`)
          ) {
            try {
              await queuedNotification("notifications/claude/channel", {
                content: `${comment.by} commented on "${task.title}": ${comment.text}`,
                meta: {
                  type: "task_comment",
                  task_id: task.id,
                  task_title: task.title,
                  from: comment.by,
                },
              }, `comment:${commentKey}`);
              addSeen(seenComments,commentKey);
            } catch (err: any) {
              process.stderr.write(`[${new Date().toISOString()}] Failed to queue comment notification for ${task.id}: ${err?.message || String(err)}\n`);
            }

          }
        }
      }

      // Check for tasks newly assigned to this agent
      if (
        task.owner === AGENT_NAME &&
        (task.status === "assigned" || task.status === "todo") &&
        !seenCommands.has(`assign:${task.id}`)
      ) {
        try {
          await queuedNotification("notifications/claude/channel", {
            content: `Task assigned: "${task.title}" — ${task.description}`,
            meta: {
              type: "task_assigned",
              task_id: task.id,
              task_title: task.title,
            },
          }, `assign:${task.id}:${Date.now()}`);
          addSeen(seenCommands,`assign:${task.id}`);
        } catch (err: any) {
          process.stderr.write(`[${new Date().toISOString()}] Failed to queue assign notification for ${task.id}: ${err?.message || String(err)}\n`);
        }

      }

      // Notify Cognis when any task moves to ai_review (review queue)
      // Dedup: skip if we already have a pending review notification for this task
      if (
        AGENT_NAME === "Cognis" &&
        task.status === "ai_review" &&
        !pendingReviewTasks.has(task.id) &&
        !seenCommands.has(`review:${task.id}`)
      ) {
        try {
          await queuedNotification("notifications/claude/channel", {
            content: `Task ready for AI review: "${task.title}" by ${task.owner} — ${task.proof || task.description}`,
            meta: {
              type: "task_review",
              task_id: task.id,
              task_title: task.title,
              from: task.owner || "unknown",
            },
          }, `review:${task.id}:${Date.now()}`);
          addSeen(seenCommands,`review:${task.id}`);
          pendingReviewTasks.add(task.id);
        } catch (err: any) {
          process.stderr.write(`[${new Date().toISOString()}] Failed to queue review notification for ${task.id}: ${err?.message || String(err)}\n`);
        }

      }
      // Clear pending review when task moves OUT of ai_review (Cognis acted on it)
      if (task.status !== "ai_review" && pendingReviewTasks.has(task.id)) {
        pendingReviewTasks.delete(task.id);
        // Also clear the seenCommands key so re-review can fire again
        seenCommands.delete(`review:${task.id}`);
      }

      // Track tasks that enter human_review (awaiting Mal's approval)
      if (task.status === "human_review" && !pendingApprovalTasks.has(task.id)) {
        pendingApprovalTasks.add(task.id);
      }

      // Notify Cognis when Mal approves a task (human_review → archived)
      if (
        AGENT_NAME === "Cognis" &&
        task.status === "archived" &&
        pendingApprovalTasks.has(task.id) &&
        !seenCommands.has(`approved:${task.id}`)
      ) {
        try {
          await queuedNotification("notifications/claude/channel", {
            content: `Task approved by Mal: "${task.title}" (${task.id}) — now archived.`,
            meta: {
              type: "task_approved",
              task_id: task.id,
              task_title: task.title,
              from: "Mal",
            },
          }, `approved:${task.id}:${Date.now()}`);
          addSeen(seenCommands, `approved:${task.id}`);
          pendingApprovalTasks.delete(task.id);
        } catch (err: any) {
          process.stderr.write(`[${new Date().toISOString()}] Failed to queue approved notification for ${task.id}: ${err?.message || String(err)}\n`);
        }
      }
      // Clear pending approval if task leaves human_review without being archived (e.g. bounced back)
      if (task.status !== "human_review" && task.status !== "archived" && pendingApprovalTasks.has(task.id)) {
        pendingApprovalTasks.delete(task.id);
      }

      // Notify the task owner when their task enters client_review
      // On client boards, this notifies the client AI (e.g. Donna) for sign-off
      if (
        task.status === "client_review" &&
        task.owner === AGENT_NAME &&
        !seenCommands.has(`client_review:${task.id}`)
      ) {
        try {
          await queuedNotification("notifications/claude/channel", {
            content: `Your task "${task.title}" (${task.id}) has been moved to client review — waiting for your sign-off.`,
            meta: {
              type: "task_client_review",
              task_id: task.id,
              task_title: task.title,
              from: "board",
            },
          }, `client_review:${task.id}:${Date.now()}`);
          addSeen(seenCommands, `client_review:${task.id}`);
        } catch (err: any) {
          process.stderr.write(`[${new Date().toISOString()}] Failed to queue client_review notification for ${task.id}: ${err?.message || String(err)}\n`);
        }
      }
      // Clear client_review seen when task leaves client_review
      if (task.status !== "client_review" && seenCommands.has(`client_review:${task.id}`)) {
        seenCommands.delete(`client_review:${task.id}`);
      }
    }
  } catch (err: any) {
    process.stderr.write(`[${new Date().toISOString()}] pollTasks failed: ${err?.message || String(err)}\n`);
  }
}

// ── Webhook Server (for direct push from board) ─────────────

const WEBHOOK_PORT = parseInt(process.env.OPS_WEBHOOK_PORT || "8799", 10);
let webhookSeq = 0;

try {
  Bun.serve({
    port: WEBHOOK_PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      if (req.method === "POST") {
        try {
          const body = await req.json();

          let content = body.content || "";
          if (!content && body.type === "task_comment") {
            content = `${body.from} commented on "${body.task_title}": ${body.text}`;
          }
          if (!content && body.type === "feedback") {
            content = `${body.from} sent feedback: ${body.text}`;
          }

          await queuedNotification("notifications/claude/channel", {
            content: content || JSON.stringify(body),
            meta: {
              type: String(body.type || "webhook"),
              command_id: String(body.command_id || ""),
              task_id: String(body.task_id || ""),
              task_title: String(body.task_title || ""),
              from: String(body.from || "system"),
              mentioned: body.mentioned ? "true" : "false",
            },
          }, `webhook:${body.type || "unknown"}:${body.command_id || body.task_id || `${Date.now()}-${webhookSeq++}`}`);

          return new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch {
          return new Response(JSON.stringify({ error: "bad request" }), {
            status: 400,
          });
        }
      }

      return new Response(JSON.stringify({ status: "ops-board channel running", agent: AGENT_NAME }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
} catch (e: any) {
  // Port unavailable is a hard failure (stale child, conflicting process). Log it
  // loudly so keepalive has a breadcrumb — polling still works but direct push is
  // dead, which means delivery latency jumps from <1s to 5s+ and webhook tests silently
  // fail. The old silent catch hid this from bellows/crucible/hearth/tongs for weeks.
  try {
    Bun.write(CRASH_LOG,
      `[${new Date().toISOString()}] Bun.serve FAILED on port ${WEBHOOK_PORT}: ${e?.message || String(e)}\n${e?.stack || ""}\n`
    );
  } catch {}
  try { process.stderr.write(`[${new Date().toISOString()}] ${AGENT_NAME} webhook bind failed on ${WEBHOOK_PORT}: ${e?.message || String(e)}\n`); } catch {}
}

// ── Start ───────────────────────────────────────────────────

await mcp.connect(new StdioServerTransport());

// Initial sweep — mark existing items as seen so we don't replay history
try {
  const cmdRes = await fetch(api("/api/commands"));
  const cmds: any[] = await cmdRes.json();
  for (const cmd of cmds) {
    // Skip commands already delivered ("in_progress" = plugin acked, "done" = agent responded)
    if (cmd.status === "done" || cmd.status === "in_progress") addSeen(seenCommands,cmd.id);
  }
} catch {}

try {
  const taskRes = await fetch(api("/api/tasks"));
  const data = await taskRes.json();
  for (const task of data.tasks || []) {
    if ((task.status !== "todo" && task.status !== "assigned") || task.owner !== AGENT_NAME) {
      addSeen(seenCommands,`assign:${task.id}`);
    }
    // Mark existing ai_review tasks as seen so Cognis doesn't get flooded on restart
    if (task.status === "ai_review") {
      addSeen(seenCommands,`review:${task.id}`);
    }
    // Mark existing client_review tasks as seen for review notifications on restart
    if (task.status === "client_review") {
      addSeen(seenCommands,`client_review:${task.id}`);
    }
    for (const c of task.comments || []) {
      addSeen(seenComments,`${task.id}:${c.timestamp}`);
    }
  }
} catch {}

// Start polling
setInterval(pollCommands, POLL_INTERVAL);
setInterval(pollTasks, POLL_INTERVAL);
setInterval(pollSlashFeedback, POLL_INTERVAL);

// Per-agent heartbeat file — previously all agents raced on the same path.
// Wrapped in try/catch because an async setInterval callback that throws = unhandled rejection = process death.
const HEARTBEAT_PATH = `/tmp/ops-channel-${AGENT_NAME.toLowerCase()}.heartbeat`;
setInterval(() => {
  try {
    Bun.write(HEARTBEAT_PATH,
      `alive at ${new Date().toISOString()}\nseen commands: ${seenCommands.size}\nseen comments: ${seenComments.size}\nagent: ${AGENT_NAME}\nboard: ${BOARD_URL}\nqueueDepth: ${notificationQueue.length}\ninToolUse: ${inToolUse}\nlastToolUseStartedAt: ${lastToolUseStartedAt ? new Date(lastToolUseStartedAt).toISOString() : 'never'}\ndroppedCount: ${droppedCount}\n`
    ).catch(() => {});
  } catch {}
}, 3000);

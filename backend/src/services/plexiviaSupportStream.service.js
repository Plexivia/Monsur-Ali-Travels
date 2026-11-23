import { logger } from "../config/logger.js";
import { NotificationModel } from "../models/notification.model.js";
import { getSupportConfig, onSupportConfigChange } from "./plexiviaSupport.service.js";

const MIN_RETRY_MS = 3_000;
const MAX_RETRY_MS = 60_000;
const IDLE_TIMEOUT_MS = 70_000;
const NOTIFY_KINDS = new Set(["admin_reply", "status", "created"]);

let controller = null;
let retryTimer = null;
let retryMs = MIN_RETRY_MS;
let started = false;
let generation = 0;
let status = { connected: false, since: null, lastError: "" };

// Return current SSE stream connection status
export const supportStreamStatus = () => ({ ...status });

// Format human-readable notification message for support ticket events
const describe = (e) => {
  if (e.kind === "admin_reply") return `Plexivia replied on ticket ${e.ticket_number}: ${e.preview || e.subject}`;
  if (e.kind === "status") return `Ticket ${e.ticket_number} is now ${String(e.status || "").replace(/_/g, " ").toLowerCase()}`;
  return `Plexivia opened ticket ${e.ticket_number}: ${e.subject}`;
};

// Handle incoming SSE ticket event and broadcast to connected dashboards
const handleTicketEvent = async (e) => {
  if (!e?.dId) return;
  if (global.io) {
    global.io.emit("SUPPORT_TICKET_UPDATED", e);
  }
  if (e.by !== "ADMIN" || !NOTIFY_KINDS.has(e.kind)) return;
  const eventKey = `plexivia:${e.dId}:${e.kind}:${e.at}`.slice(0, 120);
  try {
    if (await NotificationModel.exists({ refDid: eventKey })) return;
    await NotificationModel.create({
      title: "Plexivia Support Desk",
      message: describe(e).slice(0, 300),
      module: "general",
      type: "info",
      refDid: eventKey,
      recipientRole: "All",
    });
  } catch (err) {
    if (err?.code !== 11000) logger.warn({ err: err?.message }, "[SupportStream] Could not write notification");
  }
};

// Parse Server-Sent Events stream from Plexivia
const consume = async (body, signal) => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let idle = setTimeout(() => controller?.abort(new Error("idle timeout")), IDLE_TIMEOUT_MS);
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      clearTimeout(idle);
      idle = setTimeout(() => controller?.abort(new Error("idle timeout")), IDLE_TIMEOUT_MS);
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event = "message";
        const data = [];
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trim());
        }
        if (event === "ticket" && data.length) {
          try {
            await handleTicketEvent(JSON.parse(data.join("\n")));
          } catch {
            // Ignore malformed event
          }
        } else if (event === "ready") {
          retryMs = MIN_RETRY_MS;
        }
      }
    }
  } finally {
    clearTimeout(idle);
  }
};

// Schedule exponential backoff reconnect
const scheduleRetry = () => {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, retryMs);
  retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
};

// Connect to Plexivia Support Desk SSE endpoint
const connect = async () => {
  const gen = ++generation;
  clearTimeout(retryTimer);
  controller?.abort();
  const cfg = await getSupportConfig({ fresh: true }).catch(() => null);
  if (!cfg?.configured) {
    status = { connected: false, since: null, lastError: "" };
    return;
  }
  if (gen !== generation) return;
  const ctrl = new AbortController();
  controller = ctrl;
  try {
    const res = await fetch(`${cfg.apiBaseUrl}/api/support/client/events`, {
      headers: { Accept: "text/event-stream", "X-Support-Key": cfg.key },
      signal: ctrl.signal,
    });
    if (gen !== generation) return ctrl.abort();
    if (!res.ok || !res.body) {
      status = { connected: false, since: null, lastError: `HTTP ${res.status}` };
      if (res.status === 401 || res.status === 403) {
        logger.error("[SupportStream] Plexivia rejected the support key");
        retryMs = MAX_RETRY_MS;
      }
      return scheduleRetry();
    }
    status = { connected: true, since: new Date().toISOString(), lastError: "" };
    logger.info("[SupportStream] Live link to Plexivia Support Desk is up");
    if (global.io) {
      global.io.emit("SUPPORT_TICKET_UPDATED", { kind: "resync" });
    }
    await consume(res.body, ctrl.signal);
  } catch (err) {
    if (gen !== generation) return;
    status = { connected: false, since: null, lastError: err?.cause?.code || err?.message || "error" };
  }
  if (gen === generation) {
    status.connected = false;
    scheduleRetry();
  }
};

// Start background Plexivia support SSE stream
export const startSupportStream = () => {
  if (started) return;
  started = true;
  onSupportConfigChange(() => {
    retryMs = MIN_RETRY_MS;
    connect();
  });
  connect();
};

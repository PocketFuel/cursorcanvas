function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

const urlInput = byId<HTMLInputElement>("url");
const connectBtn = byId<HTMLButtonElement>("connect");
const statusEl = byId<HTMLDivElement>("status");
const errorEl = byId<HTMLDivElement>("error");
const promptInput = byId<HTMLTextAreaElement>("promptInput");
const sendPromptBtn = byId<HTMLButtonElement>("sendPrompt");
const sendSuccessEl = byId<HTMLParagraphElement>("sendSuccess");
const promptCounterEl = byId<HTMLSpanElement>("promptCounter");
const toolFeedbackEl = byId<HTMLDivElement>("toolFeedback");

const clearPromptBtn = document.getElementById("clearPrompt") as HTMLButtonElement | null;
const templateBtns = Array.from(document.querySelectorAll<HTMLButtonElement>(".template-btn"));
const toolBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tool-action]"));

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingRequest>();

let ws: WebSocket | null = null;
let sendSuccessTimeout: ReturnType<typeof setTimeout> | null = null;
let toolFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;
let manualDisconnect = false;

let httpMode = false;
let httpBaseUrl = "";
let httpAbort: AbortController | null = null;

const templates: Record<string, string> = {
  landing: [
    "Design a high-conversion landing hero in Figma.",
    "Include: top nav, value proposition, primary CTA, secondary CTA, social proof strip.",
    "Style direction: bold editorial, asymmetric layout, premium spacing rhythm.",
    "Build with an auto-layout frame and name key layers clearly for handoff.",
  ].join("\n"),
  dashboard: [
    "Create a desktop dashboard UI with a left sidebar, top bar, KPI cards, and activity table.",
    "Use a consistent 8px spacing system and 12px+ typography hierarchy.",
    "Deliver both light and dark-ready structure by using token-friendly color groupings.",
    "Name reusable modules so they can become components.",
  ].join("\n"),
  component: [
    "Create a reusable component set in Figma for buttons and inputs.",
    "Generate primary, secondary, ghost variants and small/medium/large sizes.",
    "Apply clear naming conventions and maintain consistent corner radius and padding rules.",
    "Use auto-layout and prepare it so the system can be scaled across screens.",
  ].join("\n"),
  audit: [
    "Review and refine the selected Figma area for visual quality.",
    "Improve spacing consistency, alignment, contrast, and typographic hierarchy.",
    "Replace weak defaults with stronger visual rhythm and clearer emphasis.",
    "Output a before/after structure using clean layer names.",
  ].join("\n"),
};

function makeRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function setStatus(kind: "disconnected" | "connected" | "connecting", text: string) {
  statusEl.className = `status ${kind}`;
  statusEl.textContent = text;
}

function setError(msg: string) {
  errorEl.textContent = msg;
}

function showSendSuccess() {
  sendSuccessEl.classList.remove("hidden");
  if (sendSuccessTimeout) clearTimeout(sendSuccessTimeout);
  sendSuccessTimeout = setTimeout(() => {
    sendSuccessEl.classList.add("hidden");
    sendSuccessTimeout = null;
  }, 10000);
}

function showToolFeedback(msg: string, isError = false) {
  toolFeedbackEl.textContent = msg;
  toolFeedbackEl.style.color = isError ? "#ff97a0" : "#9de5ff";
  if (toolFeedbackTimeout) clearTimeout(toolFeedbackTimeout);
  toolFeedbackTimeout = setTimeout(() => {
    toolFeedbackEl.textContent = "";
    toolFeedbackTimeout = null;
  }, 7000);
}

function updatePromptCounter() {
  const count = promptInput.value.length;
  promptCounterEl.textContent = `${count} chars`;
  promptCounterEl.style.color = count > 1800 ? "#ffb2b8" : "";
}

function rejectAllPending(message: string) {
  for (const [, req] of pending) {
    clearTimeout(req.timeout);
    req.reject(new Error(message));
  }
  pending.clear();
}

function createPendingRequest(id: string, timeoutMs = 30000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Timeout"));
      }
    }, timeoutMs);
    pending.set(id, { resolve, reject, timeout });
  });
}

function callPluginCommand(tool: string, params: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
  const id = makeRequestId("ui");
  const promise = createPendingRequest(id, timeoutMs);
  parent.postMessage({ pluginMessage: { type: "command", id, tool, params } }, "*");
  return promise;
}

window.onmessage = (event: MessageEvent) => {
  const msg = event.data && event.data.pluginMessage;
  if (!msg || !msg.id) return;
  const req = pending.get(msg.id);
  if (!req) return;

  pending.delete(msg.id);
  clearTimeout(req.timeout);

  if (msg.type === "result") req.resolve(msg.result);
  else if (msg.type === "error") req.reject(new Error(msg.error));
};

function wsUrlToHttpPollUrl(wsUrl: string): string {
  const m = wsUrl.match(/^(wss?):\/\/([^:/]+)(?::(\d+))?/);
  if (!m) return "http://localhost:3056";
  const port = m[3] ? parseInt(m[3], 10) + 1 : 3056;
  return `http://${m[2]}:${port}`;
}

async function runHttpPollLoop(baseUrl: string) {
  while (httpMode && httpAbort) {
    try {
      const res = await fetch(baseUrl + "/poll", { signal: httpAbort.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const cmd = (await res.json()) as { id: string; tool: string; params: Record<string, unknown> };
      const { id, tool, params } = cmd;
      if (!id || !tool) continue;

      const promise = createPendingRequest(id, 30000);
      parent.postMessage(
        { pluginMessage: { type: "command", id, tool, params: params ?? {} } },
        "*"
      );

      try {
        const result = await promise;
        await fetch(baseUrl + "/result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, result }),
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await fetch(baseUrl + "/result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, error }),
        });
      }
    } catch (e) {
      if (!httpMode || (e as Error).name === "AbortError") break;
      setError("HTTP poll error. Reconnect to retry.");
      break;
    }
  }
}

function startHttpMode(wsUrl: string) {
  httpMode = true;
  httpAbort = new AbortController();
  httpBaseUrl = wsUrlToHttpPollUrl(wsUrl);
  setStatus("connected", "Connected (HTTP)");
  setError("");
  connectBtn.textContent = "Disconnect";
  connectBtn.disabled = false;
  runHttpPollLoop(httpBaseUrl);
}

function stopHttpMode() {
  httpMode = false;
  if (httpAbort) {
    httpAbort.abort();
    httpAbort = null;
  }
}

function connect() {
  const url = urlInput.value.trim() || "ws://localhost:3055";
  manualDisconnect = false;
  stopHttpMode();

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  setStatus("connecting", "Connecting...");
  setError("");
  connectBtn.disabled = true;

  ws = new WebSocket(url);

  const wsTimeout = setTimeout(() => {
    if (ws && ws.readyState !== WebSocket.OPEN) {
      ws.close();
      ws = null;
      startHttpMode(url);
    }
  }, 3000);

  ws.onopen = () => {
    clearTimeout(wsTimeout);
    setStatus("connected", "Connected");
    connectBtn.textContent = "Disconnect";
    connectBtn.disabled = false;
  };

  ws.onclose = () => {
    clearTimeout(wsTimeout);
    ws = null;

    if (manualDisconnect) {
      manualDisconnect = false;
      rejectAllPending("Disconnected");
      setStatus("disconnected", "Disconnected");
      connectBtn.textContent = "Connect";
      connectBtn.disabled = false;
      return;
    }

    if (!httpMode) {
      rejectAllPending("WebSocket closed");
      setStatus("disconnected", "Disconnected");
      connectBtn.textContent = "Connect";
      connectBtn.disabled = false;
      setError("WebSocket dropped. Switching to HTTP fallback...");
      setTimeout(() => {
        if (!ws && !httpMode && connectBtn.disabled === false) {
          startHttpMode(url);
        }
      }, 600);
    }
  };

  ws.onerror = () => {
    setError("Connection error.");
  };

  ws.onmessage = async (event: MessageEvent) => {
    let id: string | undefined;
    try {
      const msg = JSON.parse(event.data as string);
      id = msg.id;
      const { tool, params } = msg as { id?: string; tool?: string; params?: Record<string, unknown> };
      if (!id || !tool) return;

      const promise = createPendingRequest(id, 30000);
      parent.postMessage(
        { pluginMessage: { type: "command", id, tool, params: params ?? {} } },
        "*"
      );

      const result = await promise;
      if (ws) ws.send(JSON.stringify({ id, result }));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (ws) ws.send(JSON.stringify({ id: id ?? null, error }));
    }
  };
}

async function sendPromptToCursor() {
  const text = promptInput.value.trim();
  if (!text) return;

  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: "figma_prompt", text }));
      promptInput.value = "";
      updatePromptCounter();
      setError("");
      showSendSuccess();
    } catch {
      setError("Send failed. Try reconnecting.");
    }
    return;
  }

  if (httpMode && httpBaseUrl) {
    try {
      const res = await fetch(httpBaseUrl + "/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        promptInput.value = "";
        updatePromptCounter();
        setError("");
        showSendSuccess();
      } else {
        setError(`Server error ${res.status}. Use Figma desktop app if running in browser.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Cannot reach server (${msg}). Open this project in Cursor to start MCP.`);
    }
    return;
  }

  setError("Connect first to send prompts to your agent.");
}

function insertTemplate(templateName: string) {
  const template = templates[templateName];
  if (!template) return;
  const current = promptInput.value.trim();
  promptInput.value = current ? `${current}\n\n${template}` : template;
  updatePromptCounter();
  promptInput.focus();
}

async function runQuickTool(btn: HTMLButtonElement) {
  const tool = btn.dataset.toolAction;
  if (!tool) return;

  let params: Record<string, unknown> = {};
  const raw = btn.dataset.toolParams;
  if (raw) {
    try {
      params = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      showToolFeedback("Invalid tool preset JSON.", true);
      return;
    }
  }

  btn.disabled = true;
  setError("");

  try {
    await callPluginCommand(tool, params, 25000);
    showToolFeedback(`Ran ${tool} successfully.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showToolFeedback(`Tool failed: ${msg}`, true);
  } finally {
    btn.disabled = false;
  }
}

connectBtn.addEventListener("click", () => {
  if (httpMode) {
    manualDisconnect = true;
    stopHttpMode();
    rejectAllPending("Disconnected");
    setStatus("disconnected", "Disconnected");
    connectBtn.textContent = "Connect";
    connectBtn.disabled = false;
    setError("");
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    manualDisconnect = true;
    ws.close();
  } else {
    connect();
  }
});

sendPromptBtn.addEventListener("click", () => {
  sendPromptToCursor();
});

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendPromptToCursor();
  }
});

promptInput.addEventListener("input", () => {
  updatePromptCounter();
});

if (clearPromptBtn) {
  clearPromptBtn.addEventListener("click", () => {
    promptInput.value = "";
    updatePromptCounter();
    promptInput.focus();
  });
}

for (const btn of templateBtns) {
  btn.addEventListener("click", () => {
    const key = btn.dataset.template;
    if (!key) return;
    insertTemplate(key);
  });
}

for (const btn of toolBtns) {
  btn.addEventListener("click", () => {
    runQuickTool(btn);
  });
}

updatePromptCounter();

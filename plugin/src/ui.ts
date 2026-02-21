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
const cursorProjectPathInput = byId<HTMLInputElement>("cursorProjectPath");
const cursorKickoffInput = byId<HTMLTextAreaElement>("cursorKickoff");
const openCursorAgentBtn = byId<HTMLButtonElement>("openCursorAgent");
const cursorFeedbackEl = byId<HTMLDivElement>("cursorFeedback");
const themeToggleBtn = byId<HTMLButtonElement>("themeToggle");

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

const DEFAULT_WS_URL = "ws://localhost:3055";
const LOCAL_HTTP_MIN = 3056;
const LOCAL_HTTP_MAX = 3080;
const PORT_SCAN_TIMEOUT_MS = 420;
const THEME_STORAGE_KEY = "cursorcanvas_theme";

const defaultCursorKickoff = [
  "You are my CursorCanvas design agent working through Cursor with the CursorCanvas MCP tools.",
  "Always design with strong visual hierarchy, deliberate spacing rhythm, clear typography, and reusable components.",
  "Prefer grayscale-first UI foundations, then add color intentionally and sparingly.",
  "When creating Figma output, use auto-layout, semantic layer naming, and production-ready component structure.",
  "Start by reading the latest Figma prompt via get_figma_prompt, then execute it precisely.",
].join("\n");

interface WsAddress {
  protocol: "ws" | "wss";
  host: string;
  port: number;
}

interface HealthResponse {
  ok?: boolean;
  wsPort?: number;
  httpPort?: number;
  pluginConnected?: boolean;
}

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

function setCursorFeedback(msg: string, isError = false) {
  cursorFeedbackEl.textContent = msg;
  cursorFeedbackEl.style.color = isError ? "#ff8b8b" : "";
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
  toolFeedbackEl.style.color = isError ? "#d88d8d" : "";
  if (toolFeedbackTimeout) clearTimeout(toolFeedbackTimeout);
  toolFeedbackTimeout = setTimeout(() => {
    toolFeedbackEl.textContent = "";
    toolFeedbackTimeout = null;
  }, 7000);
}

function applyTheme(theme: "dark" | "light") {
  document.body.classList.remove("theme-dark", "theme-light");
  document.body.classList.add(theme === "light" ? "theme-light" : "theme-dark");
  themeToggleBtn.textContent = theme === "light" ? "Dark Mode" : "Light Mode";
  localStorage.setItem(THEME_STORAGE_KEY, theme);
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

function parseWsAddress(input: string): WsAddress | null {
  const m = input.match(/^(wss?):\/\/([^:/]+)(?::(\d+))?/i);
  if (!m) return null;
  const protocol = m[1].toLowerCase() === "wss" ? "wss" : "ws";
  const host = m[2].toLowerCase();
  const port = m[3] ? parseInt(m[3], 10) : protocol === "wss" ? 443 : 3055;
  if (!Number.isFinite(port)) return null;
  return { protocol, host, port };
}

function isLocalhostHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1";
}

function buildWsUrl(protocol: "ws" | "wss", host: string, port: number): string {
  return `${protocol}://${host}:${port}`;
}

function buildHttpUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverLocalWsUrl(seedWsUrl: string): Promise<string | null> {
  const parsed = parseWsAddress(seedWsUrl);
  if (!parsed || !isLocalhostHost(parsed.host)) return null;

  const orderedHttpPorts: number[] = [];
  const preferredHttpPort = parsed.port + 1;
  if (preferredHttpPort >= LOCAL_HTTP_MIN && preferredHttpPort <= LOCAL_HTTP_MAX) {
    orderedHttpPorts.push(preferredHttpPort);
  }
  for (let port = LOCAL_HTTP_MIN; port <= LOCAL_HTTP_MAX; port += 2) {
    if (port !== preferredHttpPort) orderedHttpPorts.push(port);
  }

  for (const httpPort of orderedHttpPorts) {
    const health = await fetchJsonWithTimeout<HealthResponse>(
      `${buildHttpUrl(parsed.host, httpPort)}/health`,
      PORT_SCAN_TIMEOUT_MS
    );
    if (!health || !health.ok) continue;
    const wsPort = typeof health.wsPort === "number" ? health.wsPort : httpPort - 1;
    if (wsPort > 0) {
      return buildWsUrl(parsed.protocol, parsed.host, wsPort);
    }
  }
  return null;
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

async function connect() {
  setStatus("connecting", "Scanning local MCP ports...");
  setError("");
  connectBtn.disabled = true;

  const initialUrl = urlInput.value.trim() || DEFAULT_WS_URL;
  const discoveredUrl = await discoverLocalWsUrl(initialUrl);
  const url = discoveredUrl ?? initialUrl;

  if (discoveredUrl && discoveredUrl !== initialUrl) {
    urlInput.value = discoveredUrl;
    showToolFeedback(`Discovered MCP server at ${discoveredUrl}`);
  }

  manualDisconnect = false;
  stopHttpMode();

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  setStatus("connecting", "Connecting...");

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
    setError("Connection error. If Cursor picked a new port, click Connect again to auto-discover.");
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

function buildCursorUrl(projectPath: string): string {
  const trimmed = projectPath.trim();
  if (!trimmed) return "cursor://";
  const normalized = trimmed.replace(/^file:\/\//, "");
  return normalized.startsWith("/") ? `cursor://file${normalized}` : `cursor://file/${normalized}`;
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
      setError(
        `Cannot reach ${httpBaseUrl} (${msg}). Click Connect again to auto-discover active MCP port, or use Cursor log URL.`
      );
    }
    return;
  }

  setError("Connect first to send prompts to your agent.");
}

async function sendKickoffToCursorCanvas(text: string): Promise<boolean> {
  if (!text.trim()) return true;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "figma_prompt", text }));
    return true;
  }
  if (httpMode && httpBaseUrl) {
    const res = await fetch(httpBaseUrl + "/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  }
  return false;
}

async function openCursorAgent() {
  const kickoff = cursorKickoffInput.value.trim();
  const projectPath = cursorProjectPathInput.value.trim();
  const cursorUrl = buildCursorUrl(projectPath);
  setCursorFeedback("");
  setError("");

  try {
    const queued = await sendKickoffToCursorCanvas(kickoff);
    if (!queued) {
      setCursorFeedback("Connect CursorCanvas first so kickoff instructions are available to the agent.", true);
      return;
    }
    await callPluginCommand("open_external_url", { url: cursorUrl }, 10000);
    setCursorFeedback("Opened Cursor. In chat, start with: 'Do the Figma prompt'.");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setCursorFeedback(`Could not open Cursor URL (${msg}). Open Cursor manually, then say: Do the Figma prompt`, true);
  }
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
    void connect();
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

themeToggleBtn.addEventListener("click", () => {
  const current = document.body.classList.contains("theme-light") ? "light" : "dark";
  applyTheme(current === "light" ? "dark" : "light");
});

openCursorAgentBtn.addEventListener("click", () => {
  void openCursorAgent();
});

cursorKickoffInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    void openCursorAgent();
  }
});

const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
applyTheme(storedTheme === "light" ? "light" : "dark");
if (!cursorKickoffInput.value.trim()) {
  cursorKickoffInput.value = defaultCursorKickoff;
}

updatePromptCounter();

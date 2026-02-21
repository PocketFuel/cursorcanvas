function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

const urlInput = byId<HTMLInputElement>("url");
const connectBtn = byId<HTMLButtonElement>("connect");
const statusEl = byId<HTMLDivElement>("status");
const errorEl = byId<HTMLDivElement>("error");
const themeToggleBtn = byId<HTMLButtonElement>("themeToggle");

const providerSelect = byId<HTMLSelectElement>("providerSelect");
const modelInput = byId<HTMLInputElement>("modelInput");
const apiKeyRow = byId<HTMLDivElement>("apiKeyRow");
const apiKeyInput = byId<HTMLInputElement>("apiKeyInput");
const chatLog = byId<HTMLDivElement>("chatLog");
const chatInput = byId<HTMLTextAreaElement>("chatInput");
const sendChatBtn = byId<HTMLButtonElement>("sendChat");
const clearChatBtn = byId<HTMLButtonElement>("clearChat");
const chatMetaEl = byId<HTMLDivElement>("chatMeta");

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface WsAddress {
  protocol: "ws" | "wss";
  host: string;
  port: number;
}

interface HealthResponse {
  ok?: boolean;
  wsPort?: number;
  httpPort?: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatResponse {
  assistant: string;
  provider: string;
  model?: string;
  toolCalls?: Array<{ tool: string; params: Record<string, unknown> }>;
}

const pending = new Map<string, PendingRequest>();
const chatHistory: ChatMessage[] = [];

let ws: WebSocket | null = null;
let manualDisconnect = false;
let httpMode = false;
let httpBaseUrl = "";
let httpAbort: AbortController | null = null;

const DEFAULT_WS_URL = "ws://localhost:3055";
const LOCAL_HTTP_MIN = 3056;
const LOCAL_HTTP_MAX = 3080;
const PORT_SCAN_TIMEOUT_MS = 420;
const THEME_STORAGE_KEY = "cursorcanvas_theme";
const API_KEY_STORAGE_KEY = "cursorcanvas_openai_key";

function setStatus(kind: "disconnected" | "connected" | "connecting", text: string) {
  statusEl.className = `status ${kind}`;
  statusEl.textContent = text;
}

function setError(msg: string) {
  errorEl.textContent = msg;
}

function setMeta(text: string) {
  chatMetaEl.textContent = text;
}

function applyTheme(theme: "dark" | "light") {
  document.body.classList.remove("theme-dark", "theme-light");
  document.body.classList.add(theme === "light" ? "theme-light" : "theme-dark");
  themeToggleBtn.textContent = theme === "light" ? "Dark Mode" : "Light Mode";
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function updateProviderUI() {
  const provider = providerSelect.value;
  const openai = provider === "openai";
  apiKeyRow.classList.toggle("hidden", !openai);
  modelInput.disabled = !openai;

  if (provider === "local") {
    setMeta("Local provider runs in CursorCanvas server and does not require credits.");
  } else if (provider === "openai") {
    setMeta("OpenAI provider uses function calls and executes actions directly in Figma.");
  } else {
    setMeta(`${provider} connector is coming soon. Use Local or OpenAI right now.`);
  }
}

function addChatBubble(role: "user" | "assistant", text: string) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  bubble.textContent = text;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function clearChat() {
  chatHistory.length = 0;
  chatLog.innerHTML = "";
}

function makeRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    if (wsPort > 0) return buildWsUrl(parsed.protocol, parsed.host, wsPort);
  }
  return null;
}

async function runHttpPollLoop(baseUrl: string) {
  while (httpMode && httpAbort) {
    try {
      const res = await fetch(baseUrl + "/poll", { signal: httpAbort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

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
  void runHttpPollLoop(httpBaseUrl);
}

function stopHttpMode() {
  httpMode = false;
  if (httpAbort) {
    httpAbort.abort();
    httpAbort = null;
  }
}

async function connect() {
  setStatus("connecting", "Scanning local ports...");
  setError("");
  connectBtn.disabled = true;

  const initialUrl = urlInput.value.trim() || DEFAULT_WS_URL;
  const discoveredUrl = await discoverLocalWsUrl(initialUrl);
  const url = discoveredUrl ?? initialUrl;
  if (discoveredUrl && discoveredUrl !== initialUrl) {
    urlInput.value = discoveredUrl;
  }

  manualDisconnect = false;
  stopHttpMode();

  if (ws && ws.readyState === WebSocket.OPEN) ws.close();

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
    httpBaseUrl = wsUrlToHttpPollUrl(url);
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
      }, 700);
    }
  };

  ws.onerror = () => {
    setError("Connection error. Click Connect again to retry auto-discovery.");
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

function isConnected(): boolean {
  return (ws != null && ws.readyState === WebSocket.OPEN) || httpMode;
}

function getChatBaseUrl(): string {
  if (httpBaseUrl) return httpBaseUrl;
  return wsUrlToHttpPollUrl(urlInput.value.trim() || DEFAULT_WS_URL);
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  if (!isConnected()) {
    setError("Connect CursorCanvas first.");
    return;
  }

  const provider = providerSelect.value;
  if (provider === "cursor" || provider === "lovable") {
    addChatBubble("assistant", `${provider} connector is not implemented yet. Use CursorCanvas Local or Codex/OpenAI.`);
    setMeta(`${provider} connector coming soon.`);
    return;
  }

  const message: ChatMessage = { role: "user", content: text };
  chatHistory.push(message);
  addChatBubble("user", text);
  chatInput.value = "";
  sendChatBtn.disabled = true;
  setError("");

  try {
    const body = {
      provider,
      model: modelInput.value.trim() || undefined,
      apiKey: provider === "openai" ? apiKeyInput.value.trim() || undefined : undefined,
      message: text,
      conversation: chatHistory.slice(-20),
    };

    const res = await fetch(getChatBaseUrl() + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const textBody = await res.text();
    let data: ChatResponse | { error?: string };
    try {
      data = textBody ? (JSON.parse(textBody) as ChatResponse | { error?: string }) : {};
    } catch {
      data = {};
    }

    if (!res.ok) {
      const errMsg = "error" in data && data.error ? data.error : `Server error ${res.status}`;
      setError(errMsg);
      addChatBubble("assistant", `Error: ${errMsg}`);
      return;
    }

    const assistant = "assistant" in data && typeof data.assistant === "string"
      ? data.assistant
      : "Done.";
    chatHistory.push({ role: "assistant", content: assistant });
    addChatBubble("assistant", assistant);

    const toolsUsed = "toolCalls" in data && Array.isArray(data.toolCalls) ? data.toolCalls.length : 0;
    setMeta(`${provider} responded${toolsUsed > 0 ? ` and ran ${toolsUsed} tool${toolsUsed > 1 ? "s" : ""}` : ""}.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setError(`Chat request failed: ${msg}`);
    addChatBubble("assistant", `Error: ${msg}`);
  } finally {
    sendChatBtn.disabled = false;
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

providerSelect.addEventListener("change", () => {
  updateProviderUI();
});

sendChatBtn.addEventListener("click", () => {
  void sendChat();
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void sendChat();
  }
});

clearChatBtn.addEventListener("click", () => {
  clearChat();
  setMeta("Chat cleared.");
});

themeToggleBtn.addEventListener("click", () => {
  const current = document.body.classList.contains("theme-light") ? "light" : "dark";
  applyTheme(current === "light" ? "dark" : "light");
});

apiKeyInput.addEventListener("change", () => {
  localStorage.setItem(API_KEY_STORAGE_KEY, apiKeyInput.value.trim());
});

const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
applyTheme(storedTheme === "light" ? "light" : "dark");

const storedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
if (storedApiKey) apiKeyInput.value = storedApiKey;

updateProviderUI();
addChatBubble("assistant", "CursorCanvas ready. Connect, then ask me to design something in Figma.");

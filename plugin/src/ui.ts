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
const sizeDownBtn = byId<HTMLButtonElement>("sizeDown");
const sizeUpBtn = byId<HTMLButtonElement>("sizeUp");
const sizeLabelEl = byId<HTMLDivElement>("sizeLabel");

const providerSelect = byId<HTMLSelectElement>("providerSelect");
const modelInput = byId<HTMLInputElement>("modelInput");
const apiKeyRow = byId<HTMLDivElement>("apiKeyRow");
const apiKeyInput = byId<HTMLInputElement>("apiKeyInput");
const chatInput = byId<HTMLTextAreaElement>("chatInput");
const sendChatBtn = byId<HTMLButtonElement>("sendChat");
const clearChatBtn = byId<HTMLButtonElement>("clearChat");
const chatMetaEl = byId<HTMLParagraphElement>("chatMeta");
const assistantOutputEl = byId<HTMLDivElement>("assistantOutput");

const researchContextInput = byId<HTMLTextAreaElement>("researchContext");
const designProfileInput = byId<HTMLTextAreaElement>("designProfile");
const saveResearchBtn = byId<HTMLButtonElement>("saveResearch");
const useResearchNowBtn = byId<HTMLButtonElement>("useResearchNow");
const researchMetaEl = byId<HTMLParagraphElement>("researchMeta");
const libraryMetaEl = byId<HTMLParagraphElement>("libraryMeta");
const framePresetSelect = byId<HTMLSelectElement>("framePreset");
const createMainFrameBtn = byId<HTMLButtonElement>("createMainFrame");
const clearMainFrameBtn = byId<HTMLButtonElement>("clearMainFrame");
const targetFrameLabelEl = byId<HTMLSpanElement>("targetFrameLabel");

const navBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-page-target]"));
const pages = Array.from(document.querySelectorAll<HTMLElement>(".page"));
const libraryTabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-library-target]"));
const libraryPanels = Array.from(document.querySelectorAll<HTMLElement>(".lib-panel"));
const typeTabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-type-target]"));
const typeGroups = Array.from(document.querySelectorAll<HTMLElement>(".type-group"));
const templateBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-component-template]"));
const textStyleBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-text-style]"));

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
  toolCalls?: Array<{ tool: string; params: Record<string, unknown>; error?: string }>;
}

interface EnsureCanvasFrameResult {
  id: string;
  name: string;
  preset: string;
  width: number;
  height: number;
  created: boolean;
}

interface NodeResult {
  id: string;
  name?: string;
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
const UI_SCALE_STORAGE_KEY = "cursorcanvas_ui_scale";
const API_KEY_STORAGE_KEY = "cursorcanvas_openai_key";
const RESEARCH_CONTEXT_STORAGE_KEY = "cursorcanvas_research_context";
const DESIGN_PROFILE_STORAGE_KEY = "cursorcanvas_design_profile";
const MAIN_FRAME_ID_STORAGE_KEY = "cursorcanvas_main_frame_id";
const MAIN_FRAME_NAME_STORAGE_KEY = "cursorcanvas_main_frame_name";
const BASE_UI_WIDTH = 460;
const BASE_UI_HEIGHT = 820;
const MIN_UI_SCALE = 1;
const MAX_UI_SCALE = 2;
const UI_SCALE_STEP = 0.25;

let uiScale = MIN_UI_SCALE;
let mainFrameId = "";
let mainFrameName = "";

const defaultDesignProfile = [
  "You are a senior product designer and UI engineer specialized in translating references into production-ready Figma output using 2025-2026 patterns.",
  "Use shadcn-style token architecture and robust Auto Layout by default.",
  "For each major request, think in A/B/C variants: faithful, refined, and bold exploration.",
  "Prioritize hierarchy, spacing rhythm, accessibility, and component reusability.",
  "When uncertain, ask concise clarifying questions and choose a practical default.",
].join("\n");

function setStatus(kind: "disconnected" | "connected" | "connecting", text: string) {
  statusEl.className = `status ${kind}`;
  statusEl.textContent = text;
}

function setError(msg: string) {
  errorEl.textContent = msg;
}

function setChatMeta(text: string) {
  chatMetaEl.textContent = text;
}

function setResearchMeta(text: string) {
  researchMetaEl.textContent = text;
}

function setLibraryMeta(text: string, isError = false) {
  libraryMetaEl.textContent = text;
  libraryMetaEl.style.color = isError ? "#d88d8d" : "";
}

function updateMainFrameLabel() {
  targetFrameLabelEl.textContent = mainFrameName || "None";
}

function setMainFrameTarget(id: string, name: string) {
  mainFrameId = id;
  mainFrameName = name;
  localStorage.setItem(MAIN_FRAME_ID_STORAGE_KEY, id);
  localStorage.setItem(MAIN_FRAME_NAME_STORAGE_KEY, name);
  updateMainFrameLabel();
}

function clearMainFrameTarget() {
  mainFrameId = "";
  mainFrameName = "";
  localStorage.removeItem(MAIN_FRAME_ID_STORAGE_KEY);
  localStorage.removeItem(MAIN_FRAME_NAME_STORAGE_KEY);
  updateMainFrameLabel();
}

function setAssistantOutput(text: string) {
  assistantOutputEl.textContent = text;
}

function isNodeResult(value: unknown): value is NodeResult {
  return Boolean(value) && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

function isEnsureCanvasFrameResult(value: unknown): value is EnsureCanvasFrameResult {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<EnsureCanvasFrameResult>;
  return (
    typeof data.id === "string" &&
    typeof data.name === "string" &&
    typeof data.width === "number" &&
    typeof data.height === "number"
  );
}

function applyTheme(theme: "dark" | "light") {
  document.body.classList.remove("theme-dark", "theme-light");
  document.body.classList.add(theme === "light" ? "theme-light" : "theme-dark");
  themeToggleBtn.textContent = theme === "light" ? "Dark Mode" : "Light Mode";
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function normalizeScale(value: number): number {
  const clamped = Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, value));
  return Math.round(clamped * 100) / 100;
}

function setUiScaleLabel(scale: number) {
  sizeLabelEl.textContent = `Size ${Math.round(scale * 100)}%`;
  sizeDownBtn.disabled = scale <= MIN_UI_SCALE;
  sizeUpBtn.disabled = scale >= MAX_UI_SCALE;
}

async function applyUiScale(scale: number) {
  const normalized = normalizeScale(scale);
  const width = Math.round(BASE_UI_WIDTH * normalized);
  const height = Math.round(BASE_UI_HEIGHT * normalized);
  try {
    await callPluginCommand("resize_ui", { width, height }, 10000);
    uiScale = normalized;
    setUiScaleLabel(normalized);
    localStorage.setItem(UI_SCALE_STORAGE_KEY, String(normalized));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`Resize failed: ${message}`);
  }
}

function updateProviderUI() {
  const provider = providerSelect.value;
  const openai = provider === "openai";
  apiKeyRow.classList.toggle("hidden", !openai);
  modelInput.disabled = !openai;

  if (provider === "local") {
    setChatMeta("Local provider runs in CursorCanvas server and does not require credits.");
  } else if (provider === "openai") {
    setChatMeta("OpenAI provider uses tool-calling to generate and execute design actions in Figma.");
  } else {
    setChatMeta(`${provider} connector is planned. Use Local or OpenAI for now.`);
  }
}

function activatePage(pageId: string) {
  for (const btn of navBtns) {
    btn.classList.toggle("active", btn.dataset.pageTarget === pageId);
  }
  for (const page of pages) {
    page.classList.toggle("active", page.id === pageId);
  }
}

function activateLibraryPanel(panelId: string) {
  for (const btn of libraryTabs) {
    btn.classList.toggle("active", btn.dataset.libraryTarget === panelId);
  }
  for (const panel of libraryPanels) {
    panel.classList.toggle("active", panel.id === panelId);
  }
}

function activateTypeGroup(groupId: string) {
  for (const btn of typeTabs) {
    btn.classList.toggle("active", btn.dataset.typeTarget === groupId);
  }
  for (const group of typeGroups) {
    group.classList.toggle("active", group.id === groupId);
  }
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
      parent.postMessage({ pluginMessage: { type: "command", id, tool, params: params ?? {} } }, "*");

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
    setError("Connection error. Click Connect again.");
  };

  ws.onmessage = async (event: MessageEvent) => {
    let id: string | undefined;
    try {
      const msg = JSON.parse(event.data as string);
      id = msg.id;
      const { tool, params } = msg as { id?: string; tool?: string; params?: Record<string, unknown> };
      if (!id || !tool) return;

      const promise = createPendingRequest(id, 30000);
      parent.postMessage({ pluginMessage: { type: "command", id, tool, params: params ?? {} } }, "*");
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

function getResearchPayload(): { researchContext: string; designProfile: string } {
  return {
    researchContext: researchContextInput.value.trim(),
    designProfile: designProfileInput.value.trim(),
  };
}

function saveResearchState() {
  localStorage.setItem(RESEARCH_CONTEXT_STORAGE_KEY, researchContextInput.value);
  localStorage.setItem(DESIGN_PROFILE_STORAGE_KEY, designProfileInput.value);
  setResearchMeta("Research brief saved.");
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
    setAssistantOutput(`${provider} connector is not available yet. Use CursorCanvas Local or Codex/OpenAI.`);
    setChatMeta(`${provider} connector is planned.`);
    return;
  }

  chatHistory.push({ role: "user", content: text });
  chatInput.value = "";
  sendChatBtn.disabled = true;
  setError("");
  setAssistantOutput("Thinking...");

  try {
    const body = {
      provider,
      model: modelInput.value.trim() || undefined,
      apiKey: provider === "openai" ? apiKeyInput.value.trim() || undefined : undefined,
      message: text,
      conversation: chatHistory.slice(-20),
      ...getResearchPayload(),
    };

    const res = await fetch(getChatBaseUrl() + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    let data: ChatResponse | { error?: string };
    try {
      data = raw ? (JSON.parse(raw) as ChatResponse | { error?: string }) : {};
    } catch {
      data = {};
    }

    if (!res.ok) {
      const message = "error" in data && data.error ? data.error : `Server error ${res.status}`;
      setError(message);
      setAssistantOutput(`Error: ${message}`);
      return;
    }

    const assistantText = "assistant" in data && typeof data.assistant === "string"
      ? data.assistant
      : "Done.";
    chatHistory.push({ role: "assistant", content: assistantText });
    setAssistantOutput(assistantText);

    const toolCalls = "toolCalls" in data && Array.isArray(data.toolCalls) ? data.toolCalls : [];
    setChatMeta(`${provider} completed with ${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"}.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`Chat request failed: ${message}`);
    setAssistantOutput(`Error: ${message}`);
  } finally {
    sendChatBtn.disabled = false;
  }
}

function clearChat() {
  chatHistory.length = 0;
  setAssistantOutput("");
  setChatMeta("Chat cleared.");
}

function getPresetCanvasName(preset: string): string {
  switch (preset) {
    case "tablet":
      return "Tablet Canvas";
    case "mobile":
      return "Mobile Canvas";
    case "letter":
      return "8.5x11 Canvas";
    case "presentation":
      return "Presentation Canvas";
    case "desktop":
    default:
      return "Desktop Canvas";
  }
}

async function createNode(tool: string, params: Record<string, unknown>, timeoutMs = 22000): Promise<NodeResult> {
  const result = await callPluginCommand(tool, params, timeoutMs);
  if (!isNodeResult(result)) {
    throw new Error(`${tool} returned an invalid result.`);
  }
  return result;
}

async function ensureMainFrame(forcePreset: boolean): Promise<EnsureCanvasFrameResult> {
  const preset = framePresetSelect.value || "desktop";
  const params: Record<string, unknown> = {
    preset,
    name: getPresetCanvasName(preset),
    forcePreset,
    useSelectedFrame: !mainFrameId,
  };
  if (mainFrameId) {
    params.frameId = mainFrameId;
  }
  const result = await callPluginCommand("ensure_canvas_frame", params, 24000);
  if (!isEnsureCanvasFrameResult(result)) {
    throw new Error("Failed to create or resolve main frame.");
  }
  setMainFrameTarget(result.id, result.name);
  return result;
}

async function createSectionFrame(root: EnsureCanvasFrameResult, sectionName: string): Promise<NodeResult> {
  const sectionWidth = Math.max(260, Math.round(root.width - 64));
  return createNode("create_frame", {
    parentId: root.id,
    select: false,
    name: sectionName,
    width: sectionWidth,
    height: 100,
    layoutMode: "VERTICAL",
    primaryAxisSizingMode: "AUTO",
    counterAxisSizingMode: "FIXED",
    itemSpacing: 16,
    paddingTop: 20,
    paddingRight: 20,
    paddingBottom: 20,
    paddingLeft: 20,
    fillR: 0.97,
    fillG: 0.97,
    fillB: 0.97,
    cornerRadius: 14,
  });
}

async function createTextStyle(raw: string) {
  try {
    const style = JSON.parse(raw) as { label?: string; fontSize?: number; fontStyle?: string; text?: string };
    const root = await ensureMainFrame(false);
    const container = await createNode("create_frame", {
      parentId: root.id,
      select: false,
      name: `Type / ${style.label ?? "Sample"}`,
      width: Math.max(260, Math.round(root.width - 64)),
      height: 80,
      layoutMode: "VERTICAL",
      primaryAxisSizingMode: "AUTO",
      counterAxisSizingMode: "FIXED",
      itemSpacing: 8,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      fillR: 0.98,
      fillG: 0.98,
      fillB: 0.98,
      cornerRadius: 12,
    });

    await createNode("create_text", {
      parentId: container.id,
      name: style.label ?? "Text Style",
      text: style.text ?? style.label ?? "Text",
      fontFamily: "Inter",
      fontStyle: style.fontStyle ?? "Regular",
      fontSize: style.fontSize ?? 16,
      fillR: 0.12,
      fillG: 0.12,
      fillB: 0.12,
      select: true,
    }, 20000);

    setLibraryMeta(`Inserted ${style.label ?? "text style"} in ${root.name}.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setLibraryMeta(`Failed to insert text style: ${message}`, true);
  }
}

async function runTemplate(template: string) {
  try {
    const root = await ensureMainFrame(false);
    const sectionWidth = Math.max(260, Math.round(root.width - 64));

    switch (template) {
      case "hero": {
        const section = await createSectionFrame(root, "Section / Hero");
        const hero = await createNode("create_frame", {
          parentId: section.id,
          select: false,
          name: "Hero Section",
          width: sectionWidth - 40,
          height: 360,
          layoutMode: "VERTICAL",
          itemSpacing: 16,
          paddingTop: 36,
          paddingRight: 36,
          paddingBottom: 36,
          paddingLeft: 36,
          fillR: 1,
          fillG: 1,
          fillB: 1,
          cornerRadius: 12,
        });
        await createNode("create_text", {
          parentId: hero.id,
          select: false,
          text: "Hero headline",
          fontFamily: "Inter",
          fontStyle: "Bold",
          fontSize: 56,
          fillR: 0.08,
          fillG: 0.08,
          fillB: 0.08,
        });
        await createNode("create_text", {
          parentId: hero.id,
          select: false,
          text: "Supporting subheadline copy",
          fontFamily: "Inter",
          fontStyle: "Regular",
          fontSize: 20,
          fillR: 0.25,
          fillG: 0.25,
          fillB: 0.25,
        });
        await createNode("create_component", {
          parentId: hero.id,
          select: true,
          name: "Button / Primary",
          width: 180,
          height: 52,
          cornerRadius: 12,
          fillR: 0.2,
          fillG: 0.2,
          fillB: 0.2,
        });
        break;
      }

      case "navbar": {
        const section = await createSectionFrame(root, "Section / Navbar");
        const nav = await createNode("create_frame", {
          parentId: section.id,
          select: false,
          name: "Navbar",
          width: sectionWidth - 40,
          height: 72,
          layoutMode: "HORIZONTAL",
          itemSpacing: 20,
          paddingTop: 16,
          paddingRight: 24,
          paddingBottom: 16,
          paddingLeft: 24,
          primaryAxisAlignItems: "SPACE_BETWEEN",
          counterAxisAlignItems: "CENTER",
          fillR: 1,
          fillG: 1,
          fillB: 1,
          cornerRadius: 10,
        });
        await createNode("create_text", {
          parentId: nav.id,
          select: false,
          text: "Brand",
          fontFamily: "Inter",
          fontStyle: "Bold",
          fontSize: 20,
        });
        await createNode("create_text", {
          parentId: nav.id,
          select: true,
          text: "Navigation",
          fontFamily: "Inter",
          fontStyle: "Medium",
          fontSize: 14,
        });
        break;
      }

      case "featureGrid": {
        const section = await createSectionFrame(root, "Section / Feature Grid");
        const grid = await createNode("create_frame", {
          parentId: section.id,
          select: false,
          name: "Feature Grid",
          width: sectionWidth - 40,
          height: 360,
          layoutMode: "VERTICAL",
          itemSpacing: 16,
          paddingTop: 24,
          paddingRight: 24,
          paddingBottom: 24,
          paddingLeft: 24,
          fillR: 1,
          fillG: 1,
          fillB: 1,
          cornerRadius: 12,
        });
        await createNode("create_text", {
          parentId: grid.id,
          select: false,
          text: "Feature highlights",
          fontFamily: "Inter",
          fontStyle: "Semibold",
          fontSize: 30,
        });
        for (let i = 1; i <= 3; i += 1) {
          await createNode("create_component", {
            parentId: grid.id,
            select: i === 3,
            name: `Feature Card ${i}`,
            width: sectionWidth - 88,
            height: 96,
            cornerRadius: 10,
            fillR: 0.96,
            fillG: 0.96,
            fillB: 0.96,
          });
        }
        break;
      }

      case "pricingCard": {
        const section = await createSectionFrame(root, "Section / Pricing");
        const card = await createNode("create_component", {
          parentId: section.id,
          select: false,
          name: "Pricing Card",
          width: Math.min(360, sectionWidth - 40),
          height: 260,
          cornerRadius: 16,
          fillR: 1,
          fillG: 1,
          fillB: 1,
          layoutMode: "VERTICAL",
          itemSpacing: 12,
          paddingTop: 24,
          paddingRight: 24,
          paddingBottom: 24,
          paddingLeft: 24,
        });
        await createNode("create_text", {
          parentId: card.id,
          select: false,
          text: "Pro Plan",
          fontFamily: "Inter",
          fontStyle: "Semibold",
          fontSize: 24,
        });
        await createNode("create_text", {
          parentId: card.id,
          select: true,
          text: "$49/mo",
          fontFamily: "Inter",
          fontStyle: "Bold",
          fontSize: 40,
        });
        break;
      }

      case "sidebarShell": {
        const section = await createSectionFrame(root, "Section / Sidebar App");
        const shellWidth = sectionWidth - 40;
        const shell = await createNode("create_frame", {
          parentId: section.id,
          select: false,
          name: "Sidebar Shell",
          width: shellWidth,
          height: 560,
          layoutMode: "HORIZONTAL",
          itemSpacing: 16,
          fillR: 1,
          fillG: 1,
          fillB: 1,
          cornerRadius: 12,
        });
        const sidebarWidth = Math.min(260, Math.max(180, Math.round(shellWidth * 0.22)));
        await createNode("create_frame", {
          parentId: shell.id,
          select: false,
          name: "Sidebar",
          width: sidebarWidth,
          height: 560,
          layoutMode: "VERTICAL",
          itemSpacing: 10,
          paddingTop: 20,
          paddingRight: 16,
          paddingBottom: 20,
          paddingLeft: 16,
          fillR: 0.95,
          fillG: 0.95,
          fillB: 0.95,
        });
        await createNode("create_frame", {
          parentId: shell.id,
          select: true,
          name: "Content",
          width: Math.max(220, shellWidth - sidebarWidth - 16),
          height: 560,
          layoutMode: "VERTICAL",
          itemSpacing: 16,
          paddingTop: 24,
          paddingRight: 24,
          paddingBottom: 24,
          paddingLeft: 24,
          fillR: 1,
          fillG: 1,
          fillB: 1,
        });
        break;
      }

      case "modal": {
        const section = await createSectionFrame(root, "Section / Modal");
        const modal = await createNode("create_component", {
          parentId: section.id,
          select: false,
          name: "Modal",
          width: Math.min(640, sectionWidth - 40),
          height: 260,
          cornerRadius: 16,
          fillR: 1,
          fillG: 1,
          fillB: 1,
          layoutMode: "VERTICAL",
          itemSpacing: 14,
          paddingTop: 24,
          paddingRight: 24,
          paddingBottom: 24,
          paddingLeft: 24,
        });
        await createNode("create_text", {
          parentId: modal.id,
          select: false,
          text: "Modal title",
          fontFamily: "Inter",
          fontStyle: "Semibold",
          fontSize: 28,
        });
        await createNode("create_text", {
          parentId: modal.id,
          select: true,
          text: "Supporting details and action summary.",
          fontFamily: "Inter",
          fontStyle: "Regular",
          fontSize: 16,
        });
        break;
      }

      default:
        setLibraryMeta(`Unknown template: ${template}`, true);
        return;
    }

    setLibraryMeta(`Inserted ${template} in ${root.name}.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setLibraryMeta(`Template failed: ${message}`, true);
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
});

saveResearchBtn.addEventListener("click", () => {
  saveResearchState();
});

useResearchNowBtn.addEventListener("click", () => {
  activatePage("chatPage");
  chatInput.focus();
  setChatMeta("Research context is active for next generation.");
});

createMainFrameBtn.addEventListener("click", () => {
  void (async () => {
    try {
      const result = await ensureMainFrame(true);
      setLibraryMeta(`${result.created ? "Created" : "Updated"} ${result.name} (${Math.round(result.width)}x${Math.round(result.height)}).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLibraryMeta(`Main frame setup failed: ${message}`, true);
    }
  })();
});

clearMainFrameBtn.addEventListener("click", () => {
  clearMainFrameTarget();
  setLibraryMeta("Main frame target cleared. Select a frame or click Create / Use.");
});

for (const btn of navBtns) {
  btn.addEventListener("click", () => {
    const target = btn.dataset.pageTarget;
    if (!target) return;
    activatePage(target);
  });
}

for (const btn of libraryTabs) {
  btn.addEventListener("click", () => {
    const target = btn.dataset.libraryTarget;
    if (!target) return;
    activateLibraryPanel(target);
  });
}

for (const btn of typeTabs) {
  btn.addEventListener("click", () => {
    const target = btn.dataset.typeTarget;
    if (!target) return;
    activateTypeGroup(target);
  });
}

for (const btn of templateBtns) {
  btn.addEventListener("click", () => {
    const template = btn.dataset.componentTemplate;
    if (!template) return;
    void runTemplate(template);
  });
}

for (const btn of textStyleBtns) {
  btn.addEventListener("click", () => {
    const raw = btn.dataset.textStyle;
    if (!raw) return;
    void createTextStyle(raw);
  });
}

themeToggleBtn.addEventListener("click", () => {
  const current = document.body.classList.contains("theme-light") ? "light" : "dark";
  applyTheme(current === "light" ? "dark" : "light");
});

sizeDownBtn.addEventListener("click", () => {
  void applyUiScale(uiScale - UI_SCALE_STEP);
});

sizeUpBtn.addEventListener("click", () => {
  void applyUiScale(uiScale + UI_SCALE_STEP);
});

apiKeyInput.addEventListener("change", () => {
  localStorage.setItem(API_KEY_STORAGE_KEY, apiKeyInput.value.trim());
});

researchContextInput.addEventListener("change", () => {
  localStorage.setItem(RESEARCH_CONTEXT_STORAGE_KEY, researchContextInput.value);
});

designProfileInput.addEventListener("change", () => {
  localStorage.setItem(DESIGN_PROFILE_STORAGE_KEY, designProfileInput.value);
});

const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
applyTheme(storedTheme === "light" ? "light" : "dark");

const storedScale = Number(localStorage.getItem(UI_SCALE_STORAGE_KEY));
uiScale = Number.isFinite(storedScale) ? normalizeScale(storedScale) : MIN_UI_SCALE;
setUiScaleLabel(uiScale);
void applyUiScale(uiScale);

const storedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
if (storedApiKey) apiKeyInput.value = storedApiKey;

const storedResearch = localStorage.getItem(RESEARCH_CONTEXT_STORAGE_KEY);
if (storedResearch) researchContextInput.value = storedResearch;

const storedProfile = localStorage.getItem(DESIGN_PROFILE_STORAGE_KEY);
designProfileInput.value = storedProfile && storedProfile.trim() ? storedProfile : defaultDesignProfile;

const storedMainFrameId = localStorage.getItem(MAIN_FRAME_ID_STORAGE_KEY);
const storedMainFrameName = localStorage.getItem(MAIN_FRAME_NAME_STORAGE_KEY);
if (storedMainFrameId && storedMainFrameName) {
  mainFrameId = storedMainFrameId;
  mainFrameName = storedMainFrameName;
}
updateMainFrameLabel();

updateProviderUI();
setAssistantOutput("CursorCanvas ready. Connect, then chat to generate designs directly on canvas.");
setLibraryMeta("Create or select a main frame, then insert templates in a clean vertical stack.");

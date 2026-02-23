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
const profilePillEl = byId<HTMLDivElement>("profilePill");
const profileMetaEl = byId<HTMLParagraphElement>("profileMeta");
const profileUsernameInput = byId<HTMLInputElement>("profileUsername");
const profilePasscodeInput = byId<HTMLInputElement>("profilePasscode");
const profileLoginBtn = byId<HTMLButtonElement>("profileLogin");
const profileLogoutBtn = byId<HTMLButtonElement>("profileLogout");
const profileSelectEl = byId<HTMLSelectElement>("profileSelect");
const profileUseSelectedBtn = byId<HTMLButtonElement>("profileUseSelected");
const saveChatSnapshotBtn = byId<HTMLButtonElement>("saveChatSnapshot");
const loadChatSnapshotBtn = byId<HTMLButtonElement>("loadChatSnapshot");
const chatSnapshotSelectEl = byId<HTMLSelectElement>("chatSnapshotSelect");

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
const researchFieldsEl = byId<HTMLDivElement>("researchFields");
const questionnaireMetaEl = byId<HTMLParagraphElement>("questionnaireMeta");
const generateBriefBtn = byId<HTMLButtonElement>("generateBrief");
const surpriseBriefBtn = byId<HTMLButtonElement>("surpriseBrief");
const audienceSelect = byId<HTMLSelectElement>("audienceSelect");
const complexitySelect = byId<HTMLSelectElement>("complexitySelect");
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
const projectTypeBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-project-type]"));
const styleCards = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-style-id]"));
const influenceBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-influence]"));
const moodBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-mood]"));

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

interface ChatSnapshot {
  id: string;
  label: string;
  createdAt: string;
  messages: ChatMessage[];
}

interface StoredProfileAccount {
  id: string;
  username: string;
  passcodeHash: string;
  data: Record<string, string>;
  createdAt: string;
  updatedAt: string;
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

const PROFILES_STORAGE_KEY = "cursorcanvas_profiles_v1";
const ACTIVE_PROFILE_STORAGE_KEY = "cursorcanvas_active_profile_v1";
const THEME_STORAGE_KEY = "cursorcanvas_theme";
const UI_SCALE_STORAGE_KEY = "cursorcanvas_ui_scale";
const PROVIDER_STORAGE_KEY = "cursorcanvas_provider";
const MODEL_STORAGE_KEY = "cursorcanvas_model";
const API_KEY_STORAGE_KEY = "cursorcanvas_openai_key";
const RESEARCH_CONTEXT_STORAGE_KEY = "cursorcanvas_research_context";
const DESIGN_PROFILE_STORAGE_KEY = "cursorcanvas_design_profile";
const CHAT_HISTORY_STORAGE_KEY = "cursorcanvas_chat_history";
const CHAT_SNAPSHOTS_STORAGE_KEY = "cursorcanvas_chat_snapshots";
const QUESTIONNAIRE_PROJECT_KEY = "cursorcanvas_questionnaire_project";
const QUESTIONNAIRE_STYLE_KEY = "cursorcanvas_questionnaire_style";
const QUESTIONNAIRE_INFLUENCES_KEY = "cursorcanvas_questionnaire_influences";
const QUESTIONNAIRE_MOODS_KEY = "cursorcanvas_questionnaire_moods";
const QUESTIONNAIRE_AUDIENCE_KEY = "cursorcanvas_questionnaire_audience";
const QUESTIONNAIRE_COMPLEXITY_KEY = "cursorcanvas_questionnaire_complexity";
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
let activeProfileId = "";
let selectedProjectType = "website";
let selectedStyleId = "minimal-editorial";
const selectedInfluences = new Set<string>(["Swiss typography", "Apple HIG clarity"]);
const selectedMoods = new Set<string>(["Confident", "Premium", "Clean"]);
let profilesStore: Record<string, StoredProfileAccount> = {};

const defaultDesignProfile = [
  "You are a senior product designer and UI engineer specialized in translating references into production-ready Figma output using 2025-2026 patterns.",
  "Use shadcn-style token architecture and robust Auto Layout by default.",
  "For each major request, think in A/B/C variants: faithful, refined, and bold exploration.",
  "Prioritize hierarchy, spacing rhythm, accessibility, and component reusability.",
  "When uncertain, ask concise clarifying questions and choose a practical default.",
].join("\n");

const PROJECT_LABELS: Record<string, string> = {
  website: "Website",
  logo: "Logo",
  poster: "Poster",
  tshirt: "T-Shirt",
  app: "App UI",
  "slide-deck": "Slide Deck",
};

const STYLE_LIBRARY: Record<string, { label: string; example: string; cues: string }> = {
  "minimal-editorial": {
    label: "Minimal Editorial",
    example: "Stripe + Linear style rhythm",
    cues: "High whitespace, disciplined typography, soft neutral surfaces",
  },
  "swiss-grid": {
    label: "Swiss Grid",
    example: "Structured modular layouts",
    cues: "Strict columns, asymmetrical balance, direct hierarchy",
  },
  "neo-brutal": {
    label: "Neo-Brutal",
    example: "Bold blocks and high contrast",
    cues: "Heavy outlines, impact headlines, punchy hierarchy",
  },
  "neo-retro": {
    label: "Neo Retro",
    example: "Modern structure with nostalgic cues",
    cues: "Contemporary layout, vintage accents, restrained texture",
  },
  "playful-modern": {
    label: "Playful Modern",
    example: "Rounded motifs and expressive iconography",
    cues: "Friendly shapes, bright rhythm, approachable language",
  },
};

const STYLE_FONT_STACKS: Record<string, string> = {
  "minimal-editorial": "Inter (700/600/500) + Plus Jakarta Sans (500/600)",
  "swiss-grid": "Helvetica Neue (700/500) + Inter (500/400)",
  "neo-brutal": "Archivo (800/700) + Inter (600/500)",
  "neo-retro": "Fraunces (650/600) + Manrope (600/500)",
  "playful-modern": "Space Grotesk (700/600) + Manrope (600/500)",
};

interface Rgb01 {
  r: number;
  g: number;
  b: number;
}

interface StyleThemePreset {
  accentA: string;
  accentB: string;
  accentSoftA: string;
  accentSoftB: string;
  btnFillA: string;
  btnFillB: string;
  btnStrokeA: string;
  btnStrokeB: string;
  btnText: string;
  bgGlowA: string;
  bgGlowB: string;
  sectionBg: string;
  sectionStroke: string;
  controlRadius: number;
  cardRadius: number;
  panelRadius: number;
  chipRadius: number;
  shadow: string;
  buttonShadow: string;
  palette: {
    primary: string;
    secondary: string;
    ink: string;
    muted: string;
    surface: string;
    soft: string;
  };
}

const STYLE_THEMES: Record<string, StyleThemePreset> = {
  "minimal-editorial": {
    accentA: "#748BFF",
    accentB: "#4FCBF4",
    accentSoftA: "rgba(116, 139, 255, 0.34)",
    accentSoftB: "rgba(79, 203, 244, 0.28)",
    btnFillA: "#5D79FF",
    btnFillB: "#40B8F2",
    btnStrokeA: "rgba(203, 216, 255, 0.9)",
    btnStrokeB: "rgba(112, 157, 255, 0.9)",
    btnText: "#F9FAFF",
    bgGlowA: "rgba(113, 124, 255, 0.24)",
    bgGlowB: "rgba(54, 189, 255, 0.2)",
    sectionBg: "rgba(23, 25, 33, 0.62)",
    sectionStroke: "rgba(114, 129, 190, 0.36)",
    controlRadius: 8,
    cardRadius: 12,
    panelRadius: 14,
    chipRadius: 999,
    shadow: "0 14px 24px rgba(0, 0, 0, 0.35)",
    buttonShadow: "0 7px 18px rgba(68, 122, 255, 0.34)",
    palette: {
      primary: "#5D79FF",
      secondary: "#AFC1FF",
      ink: "#151723",
      muted: "#4F5471",
      surface: "#FDFEFF",
      soft: "#EEF3FF",
    },
  },
  "swiss-grid": {
    accentA: "#F04C4C",
    accentB: "#F5B34E",
    accentSoftA: "rgba(240, 76, 76, 0.32)",
    accentSoftB: "rgba(245, 179, 78, 0.26)",
    btnFillA: "#E94646",
    btnFillB: "#EFA23C",
    btnStrokeA: "rgba(255, 196, 196, 0.9)",
    btnStrokeB: "rgba(255, 211, 140, 0.88)",
    btnText: "#FFF9F4",
    bgGlowA: "rgba(240, 76, 76, 0.2)",
    bgGlowB: "rgba(245, 179, 78, 0.18)",
    sectionBg: "rgba(36, 23, 23, 0.62)",
    sectionStroke: "rgba(190, 120, 120, 0.38)",
    controlRadius: 6,
    cardRadius: 10,
    panelRadius: 12,
    chipRadius: 999,
    shadow: "0 14px 24px rgba(0, 0, 0, 0.34)",
    buttonShadow: "0 7px 16px rgba(213, 95, 54, 0.32)",
    palette: {
      primary: "#E94646",
      secondary: "#F5B34E",
      ink: "#221617",
      muted: "#684446",
      surface: "#FFFDFB",
      soft: "#FFF1E8",
    },
  },
  "neo-brutal": {
    accentA: "#FFD94A",
    accentB: "#FF6363",
    accentSoftA: "rgba(255, 217, 74, 0.34)",
    accentSoftB: "rgba(255, 99, 99, 0.28)",
    btnFillA: "#FFD047",
    btnFillB: "#FF6161",
    btnStrokeA: "rgba(255, 243, 173, 0.92)",
    btnStrokeB: "rgba(255, 167, 167, 0.9)",
    btnText: "#1A1512",
    bgGlowA: "rgba(255, 217, 74, 0.2)",
    bgGlowB: "rgba(255, 99, 99, 0.18)",
    sectionBg: "rgba(40, 32, 18, 0.62)",
    sectionStroke: "rgba(196, 164, 86, 0.42)",
    controlRadius: 5,
    cardRadius: 7,
    panelRadius: 9,
    chipRadius: 14,
    shadow: "0 10px 0 rgba(0, 0, 0, 0.24)",
    buttonShadow: "0 6px 0 rgba(0, 0, 0, 0.26)",
    palette: {
      primary: "#FFCF47",
      secondary: "#FF6363",
      ink: "#241A12",
      muted: "#6A4D35",
      surface: "#FFFCF5",
      soft: "#FFF2D5",
    },
  },
  "neo-retro": {
    accentA: "#3CB9AD",
    accentB: "#F2A14A",
    accentSoftA: "rgba(60, 185, 173, 0.31)",
    accentSoftB: "rgba(242, 161, 74, 0.28)",
    btnFillA: "#2FAEA0",
    btnFillB: "#E48C36",
    btnStrokeA: "rgba(156, 237, 229, 0.88)",
    btnStrokeB: "rgba(255, 196, 137, 0.86)",
    btnText: "#F8FFFD",
    bgGlowA: "rgba(60, 185, 173, 0.2)",
    bgGlowB: "rgba(242, 161, 74, 0.18)",
    sectionBg: "rgba(24, 35, 38, 0.62)",
    sectionStroke: "rgba(98, 172, 172, 0.38)",
    controlRadius: 9,
    cardRadius: 12,
    panelRadius: 14,
    chipRadius: 999,
    shadow: "0 15px 28px rgba(0, 0, 0, 0.36)",
    buttonShadow: "0 8px 18px rgba(58, 142, 140, 0.33)",
    palette: {
      primary: "#32AFA2",
      secondary: "#F2A14A",
      ink: "#132228",
      muted: "#3D6068",
      surface: "#FCFFFE",
      soft: "#EAF8F5",
    },
  },
  "playful-modern": {
    accentA: "#846DFF",
    accentB: "#FF865F",
    accentSoftA: "rgba(132, 109, 255, 0.34)",
    accentSoftB: "rgba(255, 134, 95, 0.28)",
    btnFillA: "#775EFF",
    btnFillB: "#FF7B54",
    btnStrokeA: "rgba(198, 184, 255, 0.9)",
    btnStrokeB: "rgba(255, 182, 157, 0.88)",
    btnText: "#FFF9F6",
    bgGlowA: "rgba(132, 109, 255, 0.22)",
    bgGlowB: "rgba(255, 134, 95, 0.2)",
    sectionBg: "rgba(29, 24, 41, 0.62)",
    sectionStroke: "rgba(133, 118, 193, 0.38)",
    controlRadius: 11,
    cardRadius: 16,
    panelRadius: 18,
    chipRadius: 999,
    shadow: "0 16px 30px rgba(23, 13, 44, 0.4)",
    buttonShadow: "0 8px 20px rgba(107, 87, 221, 0.36)",
    palette: {
      primary: "#7A63FF",
      secondary: "#FF835C",
      ink: "#1E1930",
      muted: "#5E4F79",
      surface: "#FFFDFF",
      soft: "#F2EDFF",
    },
  },
};

let currentPalette: {
  primary: Rgb01;
  secondary: Rgb01;
  ink: Rgb01;
  muted: Rgb01;
  surface: Rgb01;
  soft: Rgb01;
} = {
  primary: { r: 0.36, g: 0.47, b: 1 },
  secondary: { r: 0.69, g: 0.76, b: 1 },
  ink: { r: 0.08, g: 0.09, b: 0.13 },
  muted: { r: 0.31, g: 0.33, b: 0.44 },
  surface: { r: 1, g: 1, b: 1 },
  soft: { r: 0.93, g: 0.95, b: 1 },
};

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

function setQuestionnaireMeta(text: string, isError = false) {
  questionnaireMetaEl.textContent = text;
  questionnaireMetaEl.style.color = isError ? "#d88d8d" : "";
}

function setLibraryMeta(text: string, isError = false) {
  libraryMetaEl.textContent = text;
  libraryMetaEl.style.color = isError ? "#d88d8d" : "";
}

function setProfileMeta(text: string, isError = false) {
  profileMetaEl.textContent = text;
  profileMetaEl.style.color = isError ? "#d88d8d" : "";
}

function normalizeProfileId(username: string): string {
  return username
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

function hashPasscode(passcode: string): string {
  let hash = 5381;
  for (let i = 0; i < passcode.length; i += 1) {
    hash = (hash * 33) ^ passcode.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function loadProfilesStore() {
  const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
  if (!raw) {
    profilesStore = {};
    return;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, StoredProfileAccount>;
    if (!parsed || typeof parsed !== "object") {
      profilesStore = {};
      return;
    }
    const next: Record<string, StoredProfileAccount> = {};
    for (const [id, account] of Object.entries(parsed)) {
      if (!account || typeof account !== "object") continue;
      if (typeof account.id !== "string" || typeof account.username !== "string") continue;
      if (typeof account.passcodeHash !== "string" || !account.data || typeof account.data !== "object") continue;
      next[id] = {
        id: account.id,
        username: account.username,
        passcodeHash: account.passcodeHash,
        data: account.data,
        createdAt: typeof account.createdAt === "string" ? account.createdAt : new Date().toISOString(),
        updatedAt: typeof account.updatedAt === "string" ? account.updatedAt : new Date().toISOString(),
      };
    }
    profilesStore = next;
  } catch {
    profilesStore = {};
  }
}

function persistProfilesStore() {
  localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profilesStore));
}

function getActiveProfileAccount(): StoredProfileAccount | null {
  if (!activeProfileId) return null;
  return profilesStore[activeProfileId] ?? null;
}

function getStoredValue(key: string): string | null {
  const account = getActiveProfileAccount();
  if (account) {
    const scopedValue = account.data[key];
    if (typeof scopedValue === "string") return scopedValue;
  }
  return localStorage.getItem(key);
}

function setStoredValue(key: string, value: string) {
  const account = getActiveProfileAccount();
  if (account) {
    account.data[key] = value;
    account.updatedAt = new Date().toISOString();
    persistProfilesStore();
    return;
  }
  localStorage.setItem(key, value);
}

function removeStoredValue(key: string) {
  const account = getActiveProfileAccount();
  if (account) {
    delete account.data[key];
    account.updatedAt = new Date().toISOString();
    persistProfilesStore();
    return;
  }
  localStorage.removeItem(key);
}

function updateProfilePill() {
  const account = getActiveProfileAccount();
  const name = account ? account.username : "Guest";
  profilePillEl.innerHTML = `Active: <strong>${escapeHtml(name)}</strong>`;
}

function refreshProfileSelect() {
  const accounts = Object.values(profilesStore).sort((a, b) => a.username.localeCompare(b.username));
  profileSelectEl.innerHTML = "";

  if (accounts.length === 0) {
    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = "No saved profiles";
    profileSelectEl.appendChild(emptyOpt);
    profileUseSelectedBtn.disabled = true;
    return;
  }

  const promptOpt = document.createElement("option");
  promptOpt.value = "";
  promptOpt.textContent = "Select profile";
  profileSelectEl.appendChild(promptOpt);

  for (const account of accounts) {
    const opt = document.createElement("option");
    opt.value = account.id;
    opt.textContent = account.username;
    if (account.id === activeProfileId) opt.selected = true;
    profileSelectEl.appendChild(opt);
  }
  profileUseSelectedBtn.disabled = false;
}

function readChatHistoryFromStorage() {
  chatHistory.length = 0;
  const raw = getStoredValue(CHAT_HISTORY_STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as ChatMessage[];
    for (const item of parsed) {
      if (!item || (item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") continue;
      chatHistory.push({ role: item.role, content: item.content });
    }
  } catch {
    // ignore corrupted persisted chat history
  }
}

function persistChatHistory() {
  setStoredValue(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(chatHistory.slice(-40)));
}

function readChatSnapshotsFromStorage(): ChatSnapshot[] {
  const raw = getStoredValue(CHAT_SNAPSHOTS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ChatSnapshot[];
    const snapshots: ChatSnapshot[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.id !== "string" || typeof item.label !== "string" || typeof item.createdAt !== "string") continue;
      if (!Array.isArray(item.messages)) continue;
      const messages: ChatMessage[] = [];
      for (const msg of item.messages) {
        if (!msg || (msg.role !== "user" && msg.role !== "assistant") || typeof msg.content !== "string") continue;
        messages.push({ role: msg.role, content: msg.content });
      }
      snapshots.push({ id: item.id, label: item.label, createdAt: item.createdAt, messages });
    }
    return snapshots.slice(0, 30);
  } catch {
    return [];
  }
}

function writeChatSnapshotsToStorage(snapshots: ChatSnapshot[]) {
  setStoredValue(CHAT_SNAPSHOTS_STORAGE_KEY, JSON.stringify(snapshots.slice(0, 30)));
}

function refreshChatSnapshotSelect(selectedId = "") {
  const snapshots = readChatSnapshotsFromStorage();
  chatSnapshotSelectEl.innerHTML = "";
  if (snapshots.length === 0) {
    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = activeProfileId ? "No saved chats" : "Login to save chats";
    chatSnapshotSelectEl.appendChild(emptyOpt);
    loadChatSnapshotBtn.disabled = true;
    return;
  }

  for (const snapshot of snapshots) {
    const opt = document.createElement("option");
    opt.value = snapshot.id;
    const dateLabel = new Date(snapshot.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    opt.textContent = `${dateLabel} - ${snapshot.label}`;
    if (selectedId && snapshot.id === selectedId) opt.selected = true;
    chatSnapshotSelectEl.appendChild(opt);
  }
  loadChatSnapshotBtn.disabled = false;
}

function persistCurrentWorkspaceState() {
  const theme = document.body.classList.contains("theme-light") ? "light" : "dark";
  setStoredValue(THEME_STORAGE_KEY, theme);
  setStoredValue(UI_SCALE_STORAGE_KEY, String(uiScale));
  setStoredValue(API_KEY_STORAGE_KEY, apiKeyInput.value.trim());
  setStoredValue(RESEARCH_CONTEXT_STORAGE_KEY, researchContextInput.value);
  setStoredValue(DESIGN_PROFILE_STORAGE_KEY, designProfileInput.value);
  setStoredValue(QUESTIONNAIRE_PROJECT_KEY, selectedProjectType);
  setStoredValue(QUESTIONNAIRE_STYLE_KEY, selectedStyleId);
  setStoredValue(QUESTIONNAIRE_INFLUENCES_KEY, JSON.stringify(Array.from(selectedInfluences)));
  setStoredValue(QUESTIONNAIRE_MOODS_KEY, JSON.stringify(Array.from(selectedMoods)));
  setStoredValue(QUESTIONNAIRE_AUDIENCE_KEY, audienceSelect.value);
  setStoredValue(QUESTIONNAIRE_COMPLEXITY_KEY, complexitySelect.value);
  setStoredValue(MAIN_FRAME_ID_STORAGE_KEY, mainFrameId);
  setStoredValue(MAIN_FRAME_NAME_STORAGE_KEY, mainFrameName);
  setStoredValue(PROVIDER_STORAGE_KEY, providerSelect.value);
  setStoredValue(MODEL_STORAGE_KEY, modelInput.value.trim());
  persistChatHistory();
}

function applyStoredWorkspaceState() {
  const storedTheme = getStoredValue(THEME_STORAGE_KEY);
  applyTheme(storedTheme === "light" ? "light" : "dark");

  const storedScale = Number(getStoredValue(UI_SCALE_STORAGE_KEY));
  uiScale = Number.isFinite(storedScale) ? normalizeScale(storedScale) : MIN_UI_SCALE;
  setUiScaleLabel(uiScale);
  void applyUiScale(uiScale);

  const storedApiKey = getStoredValue(API_KEY_STORAGE_KEY);
  apiKeyInput.value = storedApiKey ?? "";

  const storedProvider = getStoredValue(PROVIDER_STORAGE_KEY);
  if (storedProvider && Array.from(providerSelect.options).some((opt) => opt.value === storedProvider)) {
    providerSelect.value = storedProvider;
  }
  const storedModel = getStoredValue(MODEL_STORAGE_KEY);
  if (storedModel) modelInput.value = storedModel;

  applyQuestionnaireDefaults();

  const storedResearch = getStoredValue(RESEARCH_CONTEXT_STORAGE_KEY);
  researchContextInput.value = storedResearch ?? "";

  const storedProfile = getStoredValue(DESIGN_PROFILE_STORAGE_KEY);
  designProfileInput.value = storedProfile && storedProfile.trim() ? storedProfile : defaultDesignProfile;
  researchFieldsEl.classList.add("hidden");

  const storedMainFrameId = getStoredValue(MAIN_FRAME_ID_STORAGE_KEY);
  const storedMainFrameName = getStoredValue(MAIN_FRAME_NAME_STORAGE_KEY);
  if (storedMainFrameId && storedMainFrameName) {
    mainFrameId = storedMainFrameId;
    mainFrameName = storedMainFrameName;
  } else {
    mainFrameId = "";
    mainFrameName = "";
  }
  updateMainFrameLabel();

  readChatHistoryFromStorage();
  const lastAssistant = [...chatHistory].reverse().find((item) => item.role === "assistant");
  setAssistantOutput(lastAssistant?.content ?? "CursorCanvas ready. Connect, then chat to generate designs directly on canvas.");
  refreshChatSnapshotSelect();
  updateProviderUI();
}

function setActiveProfile(profileId: string) {
  activeProfileId = profileId;
  if (profileId) {
    localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, profileId);
  } else {
    localStorage.removeItem(ACTIVE_PROFILE_STORAGE_KEY);
  }
  refreshProfileSelect();
  updateProfilePill();
  profileLogoutBtn.disabled = !activeProfileId;
  saveChatSnapshotBtn.disabled = !activeProfileId;
  loadChatSnapshotBtn.disabled = !activeProfileId;
}

function loginOrCreateProfile() {
  const rawUsername = profileUsernameInput.value.trim();
  const passcode = profilePasscodeInput.value.trim();
  if (rawUsername.length < 2) {
    setProfileMeta("Use at least 2 characters for username.", true);
    return;
  }
  if (passcode.length < 4) {
    setProfileMeta("Use at least 4 characters for passcode.", true);
    return;
  }

  const profileId = normalizeProfileId(rawUsername);
  if (!profileId) {
    setProfileMeta("Username contains unsupported characters.", true);
    return;
  }

  persistCurrentWorkspaceState();

  const now = new Date().toISOString();
  const passcodeHash = hashPasscode(passcode);
  let created = false;
  let account = profilesStore[profileId];

  if (!account) {
    account = {
      id: profileId,
      username: rawUsername,
      passcodeHash,
      data: {},
      createdAt: now,
      updatedAt: now,
    };
    profilesStore[profileId] = account;
    created = true;
  } else if (account.passcodeHash !== passcodeHash) {
    setProfileMeta("Incorrect passcode for that profile.", true);
    return;
  } else {
    account.username = rawUsername;
    account.updatedAt = now;
  }

  persistProfilesStore();
  setActiveProfile(profileId);

  if (created) {
    persistCurrentWorkspaceState();
    setProfileMeta(`Profile ${rawUsername} created. Preferences and chats are now profile-scoped.`);
  } else {
    applyStoredWorkspaceState();
    setProfileMeta(`Signed in as ${rawUsername}. Loaded saved preferences and chat history.`);
  }

  profilePasscodeInput.value = "";
  refreshChatSnapshotSelect();
}

function logoutProfile() {
  if (!activeProfileId) {
    setProfileMeta("Already in guest mode.");
    return;
  }
  const account = getActiveProfileAccount();
  const previousName = account?.username ?? "Profile";
  persistCurrentWorkspaceState();
  setActiveProfile("");
  persistCurrentWorkspaceState();
  refreshChatSnapshotSelect();
  setProfileMeta(`${previousName} signed out. Guest mode active.`, false);
}

function useSelectedProfile() {
  const selected = profileSelectEl.value;
  if (!selected || !profilesStore[selected]) {
    setProfileMeta("Select a saved profile first.", true);
    return;
  }
  profileUsernameInput.value = profilesStore[selected].username;
  profilePasscodeInput.focus();
  setProfileMeta(`Enter passcode for ${profilesStore[selected].username} and click Login.`);
}

function saveChatSnapshot() {
  if (!activeProfileId) {
    setProfileMeta("Login to save chat snapshots.", true);
    return;
  }
  if (chatHistory.length === 0) {
    setProfileMeta("No chat to save yet.", true);
    return;
  }

  const userMessage = [...chatHistory].reverse().find((item) => item.role === "user")?.content ?? "Design chat";
  const label = userMessage.slice(0, 48).trim() || "Design chat";
  const snapshots = readChatSnapshotsFromStorage();
  const snapshot: ChatSnapshot = {
    id: makeRequestId("chat"),
    label,
    createdAt: new Date().toISOString(),
    messages: chatHistory.slice(-40),
  };
  const next = [snapshot, ...snapshots].slice(0, 30);
  writeChatSnapshotsToStorage(next);
  refreshChatSnapshotSelect(snapshot.id);
  setProfileMeta(`Saved chat snapshot: "${label}".`);
}

function loadChatSnapshot() {
  if (!activeProfileId) {
    setProfileMeta("Login to load saved chats.", true);
    return;
  }
  const snapshotId = chatSnapshotSelectEl.value;
  if (!snapshotId) {
    setProfileMeta("Select a saved chat snapshot first.", true);
    return;
  }

  const snapshot = readChatSnapshotsFromStorage().find((item) => item.id === snapshotId);
  if (!snapshot) {
    setProfileMeta("Selected snapshot was not found.", true);
    refreshChatSnapshotSelect();
    return;
  }

  chatHistory.length = 0;
  for (const msg of snapshot.messages) {
    chatHistory.push({ role: msg.role, content: msg.content });
  }
  persistChatHistory();
  const lastAssistant = [...chatHistory].reverse().find((msg) => msg.role === "assistant");
  setAssistantOutput(lastAssistant?.content ?? "Chat snapshot loaded.");
  setChatMeta(`Loaded saved chat from ${new Date(snapshot.createdAt).toLocaleString()}.`);
  setProfileMeta(`Loaded chat snapshot: "${snapshot.label}".`);
}

function updateMainFrameLabel() {
  targetFrameLabelEl.textContent = mainFrameName || "None";
}

function setMainFrameTarget(id: string, name: string) {
  mainFrameId = id;
  mainFrameName = name;
  setStoredValue(MAIN_FRAME_ID_STORAGE_KEY, id);
  setStoredValue(MAIN_FRAME_NAME_STORAGE_KEY, name);
  updateMainFrameLabel();
}

function clearMainFrameTarget() {
  mainFrameId = "";
  mainFrameName = "";
  removeStoredValue(MAIN_FRAME_ID_STORAGE_KEY);
  removeStoredValue(MAIN_FRAME_NAME_STORAGE_KEY);
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hexToRgb01(hex: string): Rgb01 {
  const value = hex.trim().replace("#", "");
  if (value.length !== 6) return { r: 0.5, g: 0.5, b: 0.5 };
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return {
    r: clamp01(r / 255),
    g: clamp01(g / 255),
    b: clamp01(b / 255),
  };
}

function adjustHexLuma(hex: string, delta: number): string {
  const rgb = hexToRgb01(hex);
  const adjust = (v: number) => clamp01(v + delta);
  const r = Math.round(adjust(rgb.r) * 255).toString(16).padStart(2, "0");
  const g = Math.round(adjust(rgb.g) * 255).toString(16).padStart(2, "0");
  const b = Math.round(adjust(rgb.b) * 255).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function setRootVar(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

function applyStyleThemeFromSelections() {
  const preset = STYLE_THEMES[selectedStyleId] ?? STYLE_THEMES["minimal-editorial"];
  let controlRadius = preset.controlRadius;
  let cardRadius = preset.cardRadius;
  let panelRadius = preset.panelRadius;
  let chipRadius = preset.chipRadius;
  let shadow = preset.shadow;
  let buttonShadow = preset.buttonShadow;

  if (complexitySelect.value === "focused and minimal") {
    controlRadius = Math.max(5, controlRadius - 1);
    cardRadius = Math.max(8, cardRadius - 2);
    panelRadius = Math.max(10, panelRadius - 2);
    shadow = "0 10px 16px rgba(0, 0, 0, 0.22)";
    buttonShadow = "0 5px 12px rgba(0, 0, 0, 0.2)";
  } else if (complexitySelect.value === "content-rich") {
    panelRadius += 1;
    shadow = "0 18px 30px rgba(0, 0, 0, 0.36)";
    buttonShadow = "0 9px 20px rgba(0, 0, 0, 0.28)";
  }

  if (selectedMoods.has("Playful")) {
    controlRadius += 2;
    cardRadius += 3;
    panelRadius += 3;
  }
  if (selectedMoods.has("Clean")) {
    shadow = "0 10px 18px rgba(0, 0, 0, 0.22)";
  }
  if (selectedMoods.has("Premium")) {
    buttonShadow = "0 10px 22px rgba(0, 0, 0, 0.32)";
  }

  let accentA = preset.accentA;
  let accentB = preset.accentB;
  if (selectedProjectType === "poster") {
    accentA = adjustHexLuma(accentA, 0.06);
    accentB = adjustHexLuma(accentB, 0.06);
  } else if (selectedProjectType === "logo") {
    accentA = adjustHexLuma(accentA, -0.03);
    accentB = adjustHexLuma(accentB, -0.03);
  }

  setRootVar("--accent-a", accentA);
  setRootVar("--accent-b", accentB);
  setRootVar("--accent-soft-a", preset.accentSoftA);
  setRootVar("--accent-soft-b", preset.accentSoftB);
  setRootVar("--btn-fill-a", preset.btnFillA);
  setRootVar("--btn-fill-b", preset.btnFillB);
  setRootVar("--btn-stroke-a", preset.btnStrokeA);
  setRootVar("--btn-stroke-b", preset.btnStrokeB);
  setRootVar("--btn-text", preset.btnText);
  setRootVar("--bg-glow-a", preset.bgGlowA);
  setRootVar("--bg-glow-b", preset.bgGlowB);
  setRootVar("--section-bg", preset.sectionBg);
  setRootVar("--section-stroke", preset.sectionStroke);
  setRootVar("--control-radius", `${controlRadius}px`);
  setRootVar("--card-radius", `${cardRadius}px`);
  setRootVar("--panel-radius", `${panelRadius}px`);
  setRootVar("--chip-radius", chipRadius >= 999 ? "999px" : `${chipRadius}px`);
  setRootVar("--shadow", shadow);
  setRootVar("--btn-depth-shadow", buttonShadow);

  currentPalette = {
    primary: hexToRgb01(preset.palette.primary),
    secondary: hexToRgb01(preset.palette.secondary),
    ink: hexToRgb01(preset.palette.ink),
    muted: hexToRgb01(preset.palette.muted),
    surface: hexToRgb01(preset.palette.surface),
    soft: hexToRgb01(preset.palette.soft),
  };
}

function applyTheme(theme: "dark" | "light") {
  document.body.classList.remove("theme-dark", "theme-light");
  document.body.classList.add(theme === "light" ? "theme-light" : "theme-dark");
  themeToggleBtn.textContent = theme === "light" ? "Dark Mode" : "Light Mode";
  setStoredValue(THEME_STORAGE_KEY, theme);
  applyStyleThemeFromSelections();
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
    setStoredValue(UI_SCALE_STORAGE_KEY, String(normalized));
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

async function postChatWithAutoRecovery(body: unknown): Promise<Response> {
  let baseUrl = getChatBaseUrl();
  let response = await fetch(baseUrl + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (response.status !== 404) {
    return response;
  }

  const fallbackWsUrl = await discoverLocalWsUrl(urlInput.value.trim() || DEFAULT_WS_URL);
  if (!fallbackWsUrl) {
    return response;
  }

  const fallbackBaseUrl = wsUrlToHttpPollUrl(fallbackWsUrl);
  if (fallbackBaseUrl === baseUrl) {
    return response;
  }

  urlInput.value = fallbackWsUrl;
  httpBaseUrl = fallbackBaseUrl;
  setChatMeta(`Detected alternate local MCP server at ${fallbackWsUrl}. Retrying chat...`);
  baseUrl = fallbackBaseUrl;
  response = await fetch(baseUrl + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response;
}

function getResearchPayload(): { researchContext: string; designProfile: string } {
  return {
    researchContext: researchContextInput.value.trim(),
    designProfile: designProfileInput.value.trim(),
  };
}

function saveResearchState() {
  setStoredValue(RESEARCH_CONTEXT_STORAGE_KEY, researchContextInput.value);
  setStoredValue(DESIGN_PROFILE_STORAGE_KEY, designProfileInput.value);
  setResearchMeta("Research brief saved.");
}

function setSingleSelect(buttons: HTMLButtonElement[], activeValue: string, key: string) {
  for (const btn of buttons) {
    const value = btn.dataset[key] ?? "";
    btn.classList.toggle("active", value === activeValue);
  }
}

function toggleMultiSelect(
  buttons: HTMLButtonElement[],
  selectedSet: Set<string>,
  key: string,
  rawValue: string,
  maxSelected = 3
) {
  if (!rawValue) return;
  if (selectedSet.has(rawValue)) {
    selectedSet.delete(rawValue);
  } else {
    if (selectedSet.size >= maxSelected) {
      setQuestionnaireMeta(`Select up to ${maxSelected} options.`, true);
      return;
    }
    selectedSet.add(rawValue);
  }
  setQuestionnaireMeta("Generate to populate the brief automatically.");
  for (const btn of buttons) {
    const value = btn.dataset[key] ?? "";
    btn.classList.toggle("active", selectedSet.has(value));
  }
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomSubset<T>(items: T[], min: number, max: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  const size = min + Math.floor(Math.random() * Math.max(1, max - min + 1));
  return copy.slice(0, Math.min(size, copy.length));
}

function saveQuestionnaireState() {
  setStoredValue(QUESTIONNAIRE_PROJECT_KEY, selectedProjectType);
  setStoredValue(QUESTIONNAIRE_STYLE_KEY, selectedStyleId);
  setStoredValue(QUESTIONNAIRE_INFLUENCES_KEY, JSON.stringify(Array.from(selectedInfluences)));
  setStoredValue(QUESTIONNAIRE_MOODS_KEY, JSON.stringify(Array.from(selectedMoods)));
  setStoredValue(QUESTIONNAIRE_AUDIENCE_KEY, audienceSelect.value);
  setStoredValue(QUESTIONNAIRE_COMPLEXITY_KEY, complexitySelect.value);
}

function restoreQuestionnaireState() {
  selectedProjectType = "website";
  selectedStyleId = "minimal-editorial";
  selectedInfluences.clear();
  selectedInfluences.add("Swiss typography");
  selectedInfluences.add("Apple HIG clarity");
  selectedMoods.clear();
  selectedMoods.add("Confident");
  selectedMoods.add("Premium");
  selectedMoods.add("Clean");
  audienceSelect.value = "general consumers";
  complexitySelect.value = "focused and minimal";

  const project = getStoredValue(QUESTIONNAIRE_PROJECT_KEY);
  if (project && PROJECT_LABELS[project]) selectedProjectType = project;

  const style = getStoredValue(QUESTIONNAIRE_STYLE_KEY);
  if (style && STYLE_LIBRARY[style]) selectedStyleId = style;

  const influenceRaw = getStoredValue(QUESTIONNAIRE_INFLUENCES_KEY);
  if (influenceRaw) {
    try {
      const parsed = JSON.parse(influenceRaw) as string[];
      selectedInfluences.clear();
      for (const value of parsed.slice(0, 3)) selectedInfluences.add(value);
    } catch {
      // ignore invalid persisted state
    }
  }

  const moodRaw = getStoredValue(QUESTIONNAIRE_MOODS_KEY);
  if (moodRaw) {
    try {
      const parsed = JSON.parse(moodRaw) as string[];
      selectedMoods.clear();
      for (const value of parsed.slice(0, 3)) selectedMoods.add(value);
    } catch {
      // ignore invalid persisted state
    }
  }

  const audience = getStoredValue(QUESTIONNAIRE_AUDIENCE_KEY);
  if (audience) audienceSelect.value = audience;

  const complexity = getStoredValue(QUESTIONNAIRE_COMPLEXITY_KEY);
  if (complexity) complexitySelect.value = complexity;
}

function syncQuestionnaireUI() {
  setSingleSelect(projectTypeBtns, selectedProjectType, "projectType");
  setSingleSelect(styleCards, selectedStyleId, "styleId");
  for (const btn of influenceBtns) {
    const value = btn.dataset.influence ?? "";
    btn.classList.toggle("active", selectedInfluences.has(value));
  }
  for (const btn of moodBtns) {
    const value = btn.dataset.mood ?? "";
    btn.classList.toggle("active", selectedMoods.has(value));
  }
  applyStyleThemeFromSelections();
}

function applyQuestionnaireDefaults() {
  restoreQuestionnaireState();
  syncQuestionnaireUI();
}

function generateBriefFromQuestionnaire(source: "manual" | "surprise") {
  const style = STYLE_LIBRARY[selectedStyleId] ?? STYLE_LIBRARY["minimal-editorial"];
  const fontStack = STYLE_FONT_STACKS[selectedStyleId] ?? "Inter (700/500/400)";
  const project = PROJECT_LABELS[selectedProjectType] ?? "Design Task";
  const influences = Array.from(selectedInfluences);
  const moods = Array.from(selectedMoods);
  const audience = audienceSelect.value || "general consumers";
  const complexity = complexitySelect.value || "balanced";

  if (influences.length === 0 || moods.length === 0) {
    setQuestionnaireMeta("Select at least one influence and one mood before generating.", true);
    return;
  }

  const researchContext = [
    `Project type: ${project}`,
    `Primary style: ${style.label}`,
    `Style example: ${style.example}`,
    `Key visual cues: ${style.cues}`,
    `Font direction: ${fontStack}`,
    `Audience: ${audience}`,
    `Complexity target: ${complexity}`,
    `Influences: ${influences.join(", ")}`,
    `Desired feel: ${moods.join(", ")}`,
    "Output direction:",
    "- Generate component-first design systems with robust Auto Layout.",
    "- Keep neutral grayscale foundations with semantic color only for status, calls-to-action, and emphasis.",
    "- Prioritize spacing rhythm, readability, and practical production handoff.",
  ].join("\n");

  const designProfile = [
    "Agent Design Brief Template",
    "",
    "Ask and answer these inputs first:",
    `1) What are we making? ${project}`,
    `2) What style direction? ${style.label} (${style.example})`,
    `3) What influences? ${influences.join(", ")}`,
    `4) What emotional tone? ${moods.join(", ")}`,
    `5) Who is the audience? ${audience}`,
    `6) What complexity level? ${complexity}`,
    `7) Typography pair? ${fontStack}`,
    "",
    "Execution rules:",
    "- Create a frame-first structure and stack sections in Auto Layout.",
    "- Use a disciplined spacing scale and clean typography rhythm (Inter).",
    "- Build reusable primitives: buttons, cards, navigation, sections.",
    "- Include A/B/C variants when uncertainty exists.",
    "",
    "Delivery format:",
    "- Overview",
    "- Layout structure",
    "- Token recommendations",
    "- Component plan",
    "- Accessibility checks",
    "",
    `Generated by questionnaire mode: ${source}.`,
  ].join("\n");

  researchContextInput.value = researchContext;
  designProfileInput.value = designProfile;
  researchFieldsEl.classList.remove("hidden");
  saveQuestionnaireState();
  saveResearchState();
  setResearchMeta("Research brief auto-generated from questionnaire.");
  setQuestionnaireMeta("Brief generated and inserted below.");
}

function randomizeQuestionnaire() {
  const projectValues = projectTypeBtns.map((btn) => btn.dataset.projectType).filter((v): v is string => Boolean(v));
  const styleValues = styleCards.map((btn) => btn.dataset.styleId).filter((v): v is string => Boolean(v));
  const influenceValues = influenceBtns.map((btn) => btn.dataset.influence).filter((v): v is string => Boolean(v));
  const moodValues = moodBtns.map((btn) => btn.dataset.mood).filter((v): v is string => Boolean(v));

  selectedProjectType = randomItem(projectValues);
  selectedStyleId = randomItem(styleValues);
  selectedInfluences.clear();
  selectedMoods.clear();
  for (const value of randomSubset(influenceValues, 2, 3)) selectedInfluences.add(value);
  for (const value of randomSubset(moodValues, 2, 3)) selectedMoods.add(value);
  audienceSelect.selectedIndex = Math.floor(Math.random() * audienceSelect.options.length);
  complexitySelect.selectedIndex = Math.floor(Math.random() * complexitySelect.options.length);
  syncQuestionnaireUI();
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
  persistChatHistory();
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

    const res = await postChatWithAutoRecovery(body);

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
    persistChatHistory();
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
  persistChatHistory();
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

const SPACING = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
} as const;

type TextTone = "ink" | "muted" | "subtle" | "inverse";

interface TextSpec {
  name?: string;
  fontStyle?: string;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacingPx?: number;
  tone?: TextTone;
  select?: boolean;
}

function toneToRgb(tone: TextTone): { fillR: number; fillG: number; fillB: number } {
  switch (tone) {
    case "muted":
      return { fillR: currentPalette.muted.r, fillG: currentPalette.muted.g, fillB: currentPalette.muted.b };
    case "subtle":
      return {
        fillR: clamp01(currentPalette.muted.r + 0.12),
        fillG: clamp01(currentPalette.muted.g + 0.12),
        fillB: clamp01(currentPalette.muted.b + 0.12),
      };
    case "inverse":
      return { fillR: 1, fillG: 1, fillB: 1 };
    case "ink":
    default:
      return { fillR: currentPalette.ink.r, fillG: currentPalette.ink.g, fillB: currentPalette.ink.b };
  }
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function mainContentWidth(root: EnsureCanvasFrameResult): number {
  return Math.max(280, Math.round(root.width - SPACING.xxl * 2));
}

async function createSectionFrame(root: EnsureCanvasFrameResult, sectionName: string): Promise<NodeResult> {
  const sectionWidth = mainContentWidth(root);
  return createNode("create_frame", {
    parentId: root.id,
    select: false,
    name: sectionName,
    width: sectionWidth,
    height: 100,
    layoutMode: "VERTICAL",
    primaryAxisSizingMode: "AUTO",
    counterAxisSizingMode: "FIXED",
    itemSpacing: SPACING.md,
    paddingTop: 20,
    paddingRight: 20,
    paddingBottom: 20,
    paddingLeft: 20,
    fillR: currentPalette.soft.r,
    fillG: currentPalette.soft.g,
    fillB: currentPalette.soft.b,
    cornerRadius: 14,
  });
}

async function addText(parentId: string, text: string, spec: TextSpec = {}): Promise<NodeResult> {
  const tone = toneToRgb(spec.tone ?? "ink");
  return createNode("create_text", {
    parentId,
    select: spec.select ?? false,
    name: spec.name,
    text,
    fontFamily: "Inter",
    fontStyle: spec.fontStyle ?? "Regular",
    fontSize: spec.fontSize ?? 16,
    lineHeightPx: spec.lineHeightPx,
    letterSpacingPx: spec.letterSpacingPx,
    ...tone,
  }, 20000);
}

async function addButton(
  parentId: string,
  label: string,
  variant: "primary" | "secondary",
  select = false
): Promise<NodeResult> {
  const isPrimary = variant === "primary";
  const button = await createNode("create_component", {
    parentId,
    select: false,
    name: `Button / ${isPrimary ? "Primary" : "Secondary"}`,
    width: isPrimary ? 156 : 144,
    height: 46,
    cornerRadius: 8,
    layoutMode: "HORIZONTAL",
    primaryAxisSizingMode: "AUTO",
    counterAxisSizingMode: "AUTO",
    primaryAxisAlignItems: "CENTER",
    counterAxisAlignItems: "CENTER",
    itemSpacing: SPACING.xs,
    paddingTop: 10,
    paddingRight: 18,
    paddingBottom: 10,
    paddingLeft: 18,
    fillR: isPrimary ? currentPalette.primary.r : currentPalette.soft.r,
    fillG: isPrimary ? currentPalette.primary.g : currentPalette.soft.g,
    fillB: isPrimary ? currentPalette.primary.b : currentPalette.soft.b,
  });
  await addText(button.id, label, {
    fontStyle: "Medium",
    fontSize: 14,
    lineHeightPx: 20,
    tone: isPrimary ? "inverse" : "ink",
    select,
  });
  return button;
}

async function addCard(parentId: string, name: string, width: number): Promise<NodeResult> {
  return createNode("create_component", {
    parentId,
    select: false,
    name,
    width,
    height: 120,
    cornerRadius: 12,
    fillR: currentPalette.surface.r,
    fillG: currentPalette.surface.g,
    fillB: currentPalette.surface.b,
    layoutMode: "VERTICAL",
    primaryAxisSizingMode: "AUTO",
    counterAxisSizingMode: "FIXED",
    itemSpacing: SPACING.sm,
    paddingTop: 20,
    paddingRight: 20,
    paddingBottom: 20,
    paddingLeft: 20,
  });
}

async function addBulletRow(parentId: string, text: string, select = false): Promise<void> {
  const row = await createNode("create_frame", {
    parentId,
    select: false,
    name: "Feature",
    width: 320,
    height: 26,
    layoutMode: "HORIZONTAL",
    primaryAxisSizingMode: "AUTO",
    counterAxisSizingMode: "AUTO",
    counterAxisAlignItems: "CENTER",
    itemSpacing: SPACING.sm,
    fillOpacity: 0,
    fillR: 1,
    fillG: 1,
    fillB: 1,
  });
  await createNode("create_ellipse", {
    parentId: row.id,
    select: false,
    name: "Dot",
    width: 8,
    height: 8,
    fillR: currentPalette.primary.r,
    fillG: currentPalette.primary.g,
    fillB: currentPalette.primary.b,
  });
  await addText(row.id, text, {
    fontStyle: "Regular",
    fontSize: 15,
    lineHeightPx: 22,
    tone: "muted",
    select,
  });
}

async function createTextStyle(raw: string) {
  try {
    const style = JSON.parse(raw) as { label?: string; fontSize?: number; fontStyle?: string; text?: string };
    const root = await ensureMainFrame(false);
    const width = mainContentWidth(root);
    const container = await createNode("create_frame", {
      parentId: root.id,
      select: false,
      name: `Type / ${style.label ?? "Sample"}`,
      width,
      height: 80,
      layoutMode: "VERTICAL",
      primaryAxisSizingMode: "AUTO",
      counterAxisSizingMode: "FIXED",
      itemSpacing: SPACING.xs,
      paddingTop: SPACING.md,
      paddingRight: SPACING.md,
      paddingBottom: SPACING.md,
      paddingLeft: SPACING.md,
      fillR: currentPalette.soft.r,
      fillG: currentPalette.soft.g,
      fillB: currentPalette.soft.b,
      cornerRadius: 12,
    });

    await addText(container.id, style.label ?? "Text Style", {
      fontStyle: "Medium",
      fontSize: 12,
      lineHeightPx: 16,
      letterSpacingPx: 0.4,
      tone: "subtle",
    });

    await addText(container.id, style.text ?? style.label ?? "Text", {
      name: style.label ?? "Text Style",
      fontStyle: style.fontStyle ?? "Regular",
      fontSize: style.fontSize ?? 16,
      lineHeightPx: Math.round((style.fontSize ?? 16) * 1.4),
      tone: "ink",
    });

    await addText(container.id, `Inter ${style.fontSize ?? 16} / ${(style.fontStyle ?? "Regular").toLowerCase()}`, {
      fontStyle: "Regular",
      fontSize: 12,
      lineHeightPx: 16,
      tone: "muted",
      select: true,
    });

    setLibraryMeta(`Inserted ${style.label ?? "text style"} in ${root.name}.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setLibraryMeta(`Failed to insert text style: ${message}`, true);
  }
}

async function runTemplate(template: string) {
  try {
    const root = await ensureMainFrame(false);
    const sectionWidth = mainContentWidth(root);
    const contentWidth = Math.max(240, sectionWidth - SPACING.xl);
    const compact = contentWidth < 740;

    switch (template) {
      case "hero": {
        const section = await createSectionFrame(root, "Section / Hero");
        const hero = await addCard(section.id, "Hero Surface", contentWidth);
        const heroTitleSize = clampValue(Math.round(contentWidth / 10), 38, 64);
        const heroBodySize = heroTitleSize >= 56 ? 20 : 18;
        await addText(hero.id, "Product Launch", {
          fontStyle: "Medium",
          fontSize: 12,
          lineHeightPx: 16,
          letterSpacingPx: 0.8,
          tone: "subtle",
        });
        await addText(hero.id, "Design polished interfaces with one prompt", {
          fontStyle: "Bold",
          fontSize: heroTitleSize,
          lineHeightPx: Math.round(heroTitleSize * 1.12),
          tone: "ink",
        });
        await addText(hero.id, "CursorCanvas now structures layouts, components, and typography with stable spacing tokens and cleaner hierarchy.", {
          fontStyle: "Regular",
          fontSize: heroBodySize,
          lineHeightPx: Math.round(heroBodySize * 1.45),
          tone: "muted",
        });
        const actions = await createNode("create_frame", {
          parentId: hero.id,
          select: false,
          name: "Actions",
          width: contentWidth - SPACING.xl,
          height: 56,
          layoutMode: compact ? "VERTICAL" : "HORIZONTAL",
          primaryAxisSizingMode: "AUTO",
          counterAxisSizingMode: "AUTO",
          itemSpacing: SPACING.sm,
          fillOpacity: 0,
          fillR: 1,
          fillG: 1,
          fillB: 1,
        });
        await addButton(actions.id, "Get Started", "primary");
        await addButton(actions.id, "Book Demo", "secondary", true);
        break;
      }

      case "navbar": {
        const section = await createSectionFrame(root, "Section / Navbar");
        const nav = await addCard(section.id, "Navbar", contentWidth);
        await createNode("set_auto_layout", {
          nodeId: nav.id,
          layoutMode: "HORIZONTAL",
          itemSpacing: SPACING.md,
          paddingTop: SPACING.md,
          paddingRight: SPACING.lg,
          paddingBottom: SPACING.md,
          paddingLeft: SPACING.lg,
          primaryAxisAlignItems: "SPACE_BETWEEN",
          counterAxisAlignItems: "CENTER",
          primaryAxisSizingMode: "FIXED",
          counterAxisSizingMode: "FIXED",
        });

        const left = await createNode("create_frame", {
          parentId: nav.id,
          select: false,
          name: "Brand Group",
          width: 180,
          height: 40,
          layoutMode: "HORIZONTAL",
          primaryAxisSizingMode: "AUTO",
          counterAxisSizingMode: "AUTO",
          counterAxisAlignItems: "CENTER",
          itemSpacing: SPACING.sm,
          fillOpacity: 0,
          fillR: 1,
          fillG: 1,
          fillB: 1,
        });
        await addText(left.id, "CursorCanvas", {
          fontStyle: "Bold",
          fontSize: 20,
          lineHeightPx: 26,
        });
        await addText(left.id, "v1", {
          fontStyle: "Medium",
          fontSize: 12,
          lineHeightPx: 16,
          tone: "subtle",
        });

        const right = await createNode("create_frame", {
          parentId: nav.id,
          select: false,
          name: "Actions",
          width: 360,
          height: 40,
          layoutMode: "HORIZONTAL",
          primaryAxisSizingMode: "AUTO",
          counterAxisSizingMode: "AUTO",
          counterAxisAlignItems: "CENTER",
          itemSpacing: SPACING.md,
          fillOpacity: 0,
          fillR: 1,
          fillG: 1,
          fillB: 1,
        });
        await addText(right.id, "Docs", { fontStyle: "Medium", fontSize: 14, lineHeightPx: 20, tone: "muted" });
        await addText(right.id, "Pricing", { fontStyle: "Medium", fontSize: 14, lineHeightPx: 20, tone: "muted" });
        await addText(right.id, "Changelog", { fontStyle: "Medium", fontSize: 14, lineHeightPx: 20, tone: "muted" });
        await addButton(right.id, "Contact", "secondary", true);
        break;
      }

      case "featureGrid": {
        const section = await createSectionFrame(root, "Section / Feature Grid");
        await addText(section.id, "Feature highlights", {
          fontStyle: "Semibold",
          fontSize: 36,
          lineHeightPx: 44,
        });
        await addText(section.id, "Each card uses shared spacing and typography primitives for consistency across generated screens.", {
          fontStyle: "Regular",
          fontSize: 17,
          lineHeightPx: 26,
          tone: "muted",
        });
        const cardsRow = await createNode("create_frame", {
          parentId: section.id,
          select: false,
          name: "Cards",
          width: contentWidth,
          height: 120,
          layoutMode: compact ? "VERTICAL" : "HORIZONTAL",
          primaryAxisSizingMode: "AUTO",
          counterAxisSizingMode: "FIXED",
          itemSpacing: SPACING.md,
          fillOpacity: 0,
          fillR: 1,
          fillG: 1,
          fillB: 1,
        });
        const cardWidth = compact ? contentWidth : Math.max(220, Math.floor((contentWidth - SPACING.md * 2) / 3));
        const cardCopy = [
          ["Auto Layout", "Frames and components stack cleanly with fixed rhythm."],
          ["Design Tokens", "Neutral palette with semantic accents for status states."],
          ["Reusable Primitives", "Cards and buttons are generated from shared recipes."],
        ] as const;
        for (let i = 0; i < cardCopy.length; i += 1) {
          const [title, body] = cardCopy[i];
          const card = await addCard(cardsRow.id, `Feature Card ${i + 1}`, cardWidth);
          await createNode("create_rectangle", {
            parentId: card.id,
            select: false,
            name: "Icon",
            width: 36,
            height: 36,
            cornerRadius: 9,
            fillR: currentPalette.secondary.r,
            fillG: currentPalette.secondary.g,
            fillB: currentPalette.secondary.b,
          });
          await addText(card.id, title, {
            fontStyle: "Semibold",
            fontSize: 20,
            lineHeightPx: 26,
          });
          await addText(card.id, body, {
            fontStyle: "Regular",
            fontSize: 15,
            lineHeightPx: 23,
            tone: "muted",
            select: i === cardCopy.length - 1,
          });
        }
        break;
      }

      case "pricingCard": {
        const section = await createSectionFrame(root, "Section / Pricing");
        const card = await addCard(section.id, "Pricing Card", Math.min(440, contentWidth));
        await addText(card.id, "Most Popular", {
          fontStyle: "Medium",
          fontSize: 12,
          lineHeightPx: 16,
          letterSpacingPx: 0.7,
          tone: "subtle",
        });
        await addText(card.id, "Pro Plan", {
          fontStyle: "Semibold",
          fontSize: 28,
          lineHeightPx: 34,
        });
        await addText(card.id, "$49/mo", {
          fontStyle: "Bold",
          fontSize: 46,
          lineHeightPx: 52,
        });
        await addText(card.id, "Billed monthly. Cancel anytime.", {
          fontStyle: "Regular",
          fontSize: 14,
          lineHeightPx: 20,
          tone: "muted",
        });
        const features = await createNode("create_frame", {
          parentId: card.id,
          select: false,
          name: "Feature List",
          width: 360,
          height: 100,
          layoutMode: "VERTICAL",
          primaryAxisSizingMode: "AUTO",
          counterAxisSizingMode: "FIXED",
          itemSpacing: SPACING.xs,
          fillOpacity: 0,
          fillR: 1,
          fillG: 1,
          fillB: 1,
        });
        await addBulletRow(features.id, "Unlimited projects");
        await addBulletRow(features.id, "Advanced component templates");
        await addBulletRow(features.id, "Priority generation queue");
        const actions = await createNode("create_frame", {
          parentId: card.id,
          select: false,
          name: "Actions",
          width: 360,
          height: 50,
          layoutMode: compact ? "VERTICAL" : "HORIZONTAL",
          primaryAxisSizingMode: "AUTO",
          counterAxisSizingMode: "AUTO",
          itemSpacing: SPACING.sm,
          fillOpacity: 0,
          fillR: 1,
          fillG: 1,
          fillB: 1,
        });
        await addButton(actions.id, "Start Trial", "primary");
        await addButton(actions.id, "View Details", "secondary", true);
        break;
      }

      case "sidebarShell": {
        const section = await createSectionFrame(root, "Section / Sidebar App");
        const shell = await createNode("create_frame", {
          parentId: section.id,
          select: false,
          name: "Sidebar Shell",
          width: contentWidth,
          height: 640,
          layoutMode: compact ? "VERTICAL" : "HORIZONTAL",
          primaryAxisSizingMode: "FIXED",
          counterAxisSizingMode: "FIXED",
          itemSpacing: SPACING.md,
          fillR: currentPalette.surface.r,
          fillG: currentPalette.surface.g,
          fillB: currentPalette.surface.b,
          cornerRadius: 14,
          paddingTop: SPACING.md,
          paddingRight: SPACING.md,
          paddingBottom: SPACING.md,
          paddingLeft: SPACING.md,
        });
        const sidebarWidth = compact ? contentWidth - SPACING.lg : Math.min(240, Math.max(190, Math.round(contentWidth * 0.24)));
        const sidebar = await createNode("create_frame", {
          parentId: shell.id,
          select: false,
          name: "Sidebar",
          width: sidebarWidth,
          height: compact ? 220 : 608,
          layoutMode: "VERTICAL",
          primaryAxisSizingMode: "FIXED",
          counterAxisSizingMode: "FIXED",
          itemSpacing: SPACING.sm,
          paddingTop: SPACING.md,
          paddingRight: SPACING.md,
          paddingBottom: SPACING.md,
          paddingLeft: SPACING.md,
          fillR: currentPalette.soft.r,
          fillG: currentPalette.soft.g,
          fillB: currentPalette.soft.b,
          cornerRadius: 12,
        });
        await addText(sidebar.id, "Workspace", { fontStyle: "Semibold", fontSize: 16, lineHeightPx: 22 });
        await addText(sidebar.id, "Overview", { fontStyle: "Medium", fontSize: 14, lineHeightPx: 20, tone: "muted" });
        await addText(sidebar.id, "Projects", { fontStyle: "Medium", fontSize: 14, lineHeightPx: 20, tone: "muted" });
        await addText(sidebar.id, "Library", { fontStyle: "Medium", fontSize: 14, lineHeightPx: 20, tone: "muted" });
        await addText(sidebar.id, "Settings", { fontStyle: "Medium", fontSize: 14, lineHeightPx: 20, tone: "muted" });

        const content = await createNode("create_frame", {
          parentId: shell.id,
          select: false,
          name: "Content",
          width: compact ? contentWidth - SPACING.lg : Math.max(340, contentWidth - sidebarWidth - SPACING.md),
          height: compact ? 380 : 608,
          layoutMode: "VERTICAL",
          primaryAxisSizingMode: "FIXED",
          counterAxisSizingMode: "FIXED",
          itemSpacing: SPACING.md,
          paddingTop: SPACING.md,
          paddingRight: SPACING.md,
          paddingBottom: SPACING.md,
          paddingLeft: SPACING.md,
          fillR: currentPalette.surface.r,
          fillG: currentPalette.surface.g,
          fillB: currentPalette.surface.b,
          cornerRadius: 12,
        });
        const topBar = await createNode("create_frame", {
          parentId: content.id,
          select: false,
          name: "Top Bar",
          width: Math.max(300, compact ? contentWidth - SPACING.xxl : contentWidth - sidebarWidth - SPACING.xxl),
          height: 56,
          layoutMode: "HORIZONTAL",
          primaryAxisSizingMode: "FIXED",
          counterAxisSizingMode: "FIXED",
          primaryAxisAlignItems: "SPACE_BETWEEN",
          counterAxisAlignItems: "CENTER",
          fillR: clamp01(currentPalette.soft.r - 0.04),
          fillG: clamp01(currentPalette.soft.g - 0.04),
          fillB: clamp01(currentPalette.soft.b - 0.04),
          cornerRadius: 10,
          paddingTop: SPACING.sm,
          paddingRight: SPACING.md,
          paddingBottom: SPACING.sm,
          paddingLeft: SPACING.md,
        });
        await addText(topBar.id, "Dashboard", { fontStyle: "Semibold", fontSize: 22, lineHeightPx: 28 });
        await addButton(topBar.id, "New View", "primary");

        const statsRow = await createNode("create_frame", {
          parentId: content.id,
          select: false,
          name: "Stats",
          width: Math.max(300, compact ? contentWidth - SPACING.xxl : contentWidth - sidebarWidth - SPACING.xxl),
          height: 100,
          layoutMode: compact ? "VERTICAL" : "HORIZONTAL",
          primaryAxisSizingMode: "AUTO",
          counterAxisSizingMode: "FIXED",
          itemSpacing: SPACING.sm,
          fillOpacity: 0,
          fillR: 1,
          fillG: 1,
          fillB: 1,
        });
        const statWidth = compact ? Math.max(280, contentWidth - SPACING.xxl) : 170;
        for (const label of ["Active files", "Components", "Token sets"] as const) {
          const stat = await addCard(statsRow.id, `Metric / ${label}`, statWidth);
          await addText(stat.id, label, { fontStyle: "Medium", fontSize: 13, lineHeightPx: 18, tone: "subtle" });
          await addText(stat.id, label === "Active files" ? "42" : label === "Components" ? "118" : "27", {
            fontStyle: "Bold",
            fontSize: 28,
            lineHeightPx: 34,
          });
        }

        const activity = await addCard(content.id, "Activity", Math.max(300, compact ? contentWidth - SPACING.xxl : contentWidth - sidebarWidth - SPACING.xxl));
        await addText(activity.id, "Recent activity", {
          fontStyle: "Semibold",
          fontSize: 20,
          lineHeightPx: 26,
        });
        await addText(activity.id, "Landing page hero updated and spacing tokens normalized across 6 sections.", {
          fontStyle: "Regular",
          fontSize: 15,
          lineHeightPx: 23,
          tone: "muted",
          select: true,
        });
        break;
      }

      case "modal": {
        const section = await createSectionFrame(root, "Section / Modal");
        const backdrop = await createNode("create_frame", {
          parentId: section.id,
          select: false,
          name: "Backdrop",
          width: contentWidth,
          height: 420,
          layoutMode: "VERTICAL",
          primaryAxisAlignItems: "CENTER",
          counterAxisAlignItems: "CENTER",
          fillR: currentPalette.soft.r,
          fillG: currentPalette.soft.g,
          fillB: currentPalette.soft.b,
          cornerRadius: 14,
          paddingTop: SPACING.xxl,
          paddingRight: SPACING.lg,
          paddingBottom: SPACING.xxl,
          paddingLeft: SPACING.lg,
        });
        const modal = await addCard(backdrop.id, "Modal", Math.min(620, contentWidth - SPACING.lg * 2));
        await addText(modal.id, "Modal title", {
          fontStyle: "Semibold",
          fontSize: 30,
          lineHeightPx: 36,
        });
        await addText(modal.id, "Supporting details and next-step guidance appear here. Keep body copy concise and scannable.", {
          fontStyle: "Regular",
          fontSize: 16,
          lineHeightPx: 24,
          tone: "muted",
        });
        const actions = await createNode("create_frame", {
          parentId: modal.id,
          select: false,
          name: "Actions",
          width: 360,
          height: 56,
          layoutMode: "HORIZONTAL",
          primaryAxisSizingMode: "AUTO",
          counterAxisSizingMode: "AUTO",
          itemSpacing: SPACING.sm,
          fillOpacity: 0,
          fillR: 1,
          fillG: 1,
          fillB: 1,
        });
        await addButton(actions.id, "Cancel", "secondary");
        await addButton(actions.id, "Confirm", "primary", true);
        break;
      }

      default:
        setLibraryMeta(`Unknown template: ${template}`, true);
        return;
    }

    setLibraryMeta(`Inserted ${template} in ${root.name}. All layers were added inside the selected main frame.`);
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
  setStoredValue(PROVIDER_STORAGE_KEY, providerSelect.value);
  persistCurrentWorkspaceState();
});

modelInput.addEventListener("change", () => {
  setStoredValue(MODEL_STORAGE_KEY, modelInput.value.trim());
  persistCurrentWorkspaceState();
});

profileLoginBtn.addEventListener("click", () => {
  loginOrCreateProfile();
});

profileLogoutBtn.addEventListener("click", () => {
  logoutProfile();
});

profileUseSelectedBtn.addEventListener("click", () => {
  useSelectedProfile();
});

profileSelectEl.addEventListener("change", () => {
  const selected = profileSelectEl.value;
  if (!selected || !profilesStore[selected]) return;
  profileUsernameInput.value = profilesStore[selected].username;
});

profilePasscodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    loginOrCreateProfile();
  }
});

saveChatSnapshotBtn.addEventListener("click", () => {
  saveChatSnapshot();
});

loadChatSnapshotBtn.addEventListener("click", () => {
  loadChatSnapshot();
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

for (const btn of projectTypeBtns) {
  btn.addEventListener("click", () => {
    const value = btn.dataset.projectType;
    if (!value) return;
    selectedProjectType = value;
    setSingleSelect(projectTypeBtns, selectedProjectType, "projectType");
    applyStyleThemeFromSelections();
    saveQuestionnaireState();
    setQuestionnaireMeta("Generate to populate the brief automatically.");
  });
}

for (const btn of styleCards) {
  btn.addEventListener("click", () => {
    const value = btn.dataset.styleId;
    if (!value) return;
    selectedStyleId = value;
    setSingleSelect(styleCards, selectedStyleId, "styleId");
    applyStyleThemeFromSelections();
    saveQuestionnaireState();
    setQuestionnaireMeta("Generate to populate the brief automatically.");
  });
}

for (const btn of influenceBtns) {
  btn.addEventListener("click", () => {
    const value = btn.dataset.influence;
    if (!value) return;
    toggleMultiSelect(influenceBtns, selectedInfluences, "influence", value, 3);
    applyStyleThemeFromSelections();
    saveQuestionnaireState();
  });
}

for (const btn of moodBtns) {
  btn.addEventListener("click", () => {
    const value = btn.dataset.mood;
    if (!value) return;
    toggleMultiSelect(moodBtns, selectedMoods, "mood", value, 3);
    applyStyleThemeFromSelections();
    saveQuestionnaireState();
  });
}

generateBriefBtn.addEventListener("click", () => {
  generateBriefFromQuestionnaire("manual");
});

surpriseBriefBtn.addEventListener("click", () => {
  randomizeQuestionnaire();
  generateBriefFromQuestionnaire("surprise");
});

audienceSelect.addEventListener("change", () => {
  saveQuestionnaireState();
  setQuestionnaireMeta("Generate to refresh the brief with updated audience.");
});

complexitySelect.addEventListener("change", () => {
  applyStyleThemeFromSelections();
  saveQuestionnaireState();
  setQuestionnaireMeta("Generate to refresh the brief with updated complexity.");
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
  persistCurrentWorkspaceState();
});

sizeDownBtn.addEventListener("click", () => {
  void applyUiScale(uiScale - UI_SCALE_STEP);
});

sizeUpBtn.addEventListener("click", () => {
  void applyUiScale(uiScale + UI_SCALE_STEP);
});

apiKeyInput.addEventListener("change", () => {
  setStoredValue(API_KEY_STORAGE_KEY, apiKeyInput.value.trim());
});

researchContextInput.addEventListener("change", () => {
  setStoredValue(RESEARCH_CONTEXT_STORAGE_KEY, researchContextInput.value);
});

designProfileInput.addEventListener("change", () => {
  setStoredValue(DESIGN_PROFILE_STORAGE_KEY, designProfileInput.value);
});

loadProfilesStore();
refreshProfileSelect();
const rememberedProfileId = localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
if (rememberedProfileId && profilesStore[rememberedProfileId]) {
  setActiveProfile(rememberedProfileId);
  profileUsernameInput.value = profilesStore[rememberedProfileId].username;
  setProfileMeta(`Signed in as ${profilesStore[rememberedProfileId].username}.`);
} else {
  setActiveProfile("");
  setProfileMeta("Guest mode active. Login to save style preferences and chats per profile.");
}

applyStoredWorkspaceState();
setQuestionnaireMeta("Generate to populate the brief automatically.");
setLibraryMeta("Create or select a main frame, then insert templates in a clean vertical stack.");

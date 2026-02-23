#!/usr/bin/env node

import * as http from "http";
import * as net from "net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer, type WebSocket } from "ws";

const FIGSOR_PORT_INIT = parseInt(process.env.FIGSOR_PORT ?? "3055", 10);
const FIGSOR_PORT_MAX = 3080;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

type JsonObject = Record<string, unknown>;

interface ToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: JsonObject;
    required?: string[];
  };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  provider?: string;
  model?: string;
  apiKey?: string;
  message?: string;
  conversation?: ChatMessage[];
  researchContext?: string;
  designProfile?: string;
}

interface ExecutedToolCall {
  tool: string;
  params: JsonObject;
  result?: unknown;
  error?: string;
}

interface OpenAIResponse {
  id: string;
  output_text?: string;
  output?: Array<Record<string, unknown>>;
}

interface OpenAIFunctionCall {
  name: string;
  call_id: string;
  arguments: string;
}

const TOOL_SPECS: ToolSpec[] = [
  {
    name: "create_frame",
    description:
      "Create a new frame in Figma. Optionally name, x, y, width, height. For auto-layout, set layoutMode and itemSpacing.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        layoutMode: { type: "string", enum: ["NONE", "HORIZONTAL", "VERTICAL"] },
        itemSpacing: { type: "number" },
        paddingTop: { type: "number" },
        paddingRight: { type: "number" },
        paddingBottom: { type: "number" },
        paddingLeft: { type: "number" },
      },
    },
  },
  {
    name: "create_text",
    description: "Create text in Figma. Optionally set font family/style, size, color, and position.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        fontSize: { type: "number" },
        fontFamily: { type: "string" },
        fontStyle: { type: "string" },
        fillR: { type: "number" },
        fillG: { type: "number" },
        fillB: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
      },
    },
  },
  {
    name: "create_rectangle",
    description: "Create a rectangle with optional size, color, corner radius, and position.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        fillR: { type: "number" },
        fillG: { type: "number" },
        fillB: { type: "number" },
        cornerRadius: { type: "number" },
      },
    },
  },
  {
    name: "create_ellipse",
    description: "Create an ellipse/circle with optional size, color, and position.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        fillR: { type: "number" },
        fillG: { type: "number" },
        fillB: { type: "number" },
      },
    },
  },
  {
    name: "create_component",
    description: "Create a component node for reusable UI parts.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        fillR: { type: "number" },
        fillG: { type: "number" },
        fillB: { type: "number" },
        fillOpacity: { type: "number" },
        cornerRadius: { type: "number" },
        layoutMode: { type: "string", enum: ["NONE", "HORIZONTAL", "VERTICAL"] },
        itemSpacing: { type: "number" },
      },
    },
  },
  {
    name: "create_line",
    description: "Create a line with optional stroke settings and rotation.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        length: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        strokeR: { type: "number" },
        strokeG: { type: "number" },
        strokeB: { type: "number" },
        strokeOpacity: { type: "number" },
        strokeWeight: { type: "number" },
        rotation: { type: "number" },
      },
    },
  },
  {
    name: "create_polygon",
    description: "Create a polygon with side count and optional size/color.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        sides: { type: "number" },
        radius: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        fillR: { type: "number" },
        fillG: { type: "number" },
        fillB: { type: "number" },
      },
    },
  },
  {
    name: "create_star",
    description: "Create a star with point count and optional size/color.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        points: { type: "number" },
        radius: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        fillR: { type: "number" },
        fillG: { type: "number" },
        fillB: { type: "number" },
      },
    },
  },
  {
    name: "set_auto_layout",
    description: "Apply auto-layout settings on selected node or provided nodeId.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        layoutMode: { type: "string", enum: ["NONE", "HORIZONTAL", "VERTICAL"] },
        itemSpacing: { type: "number" },
        paddingTop: { type: "number" },
        paddingRight: { type: "number" },
        paddingBottom: { type: "number" },
        paddingLeft: { type: "number" },
        primaryAxisAlignItems: { type: "string", enum: ["MIN", "CENTER", "MAX", "SPACE_BETWEEN"] },
        counterAxisAlignItems: { type: "string", enum: ["MIN", "CENTER", "MAX", "BASELINE"] },
      },
    },
  },
  {
    name: "set_fill_color",
    description: "Set solid fill color on target node.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        fillR: { type: "number" },
        fillG: { type: "number" },
        fillB: { type: "number" },
        fillOpacity: { type: "number" },
      },
      required: ["fillR", "fillG", "fillB"],
    },
  },
  {
    name: "set_corner_radius",
    description: "Set corner radius on target node.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        cornerRadius: { type: "number" },
      },
      required: ["cornerRadius"],
    },
  },
  {
    name: "get_selection",
    description: "Get current selection in Figma.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_figma_prompt",
    description: "Get and clear the latest prompt saved from the plugin.",
    inputSchema: { type: "object", properties: {} },
  },
];

const AGENT_TOOL_SPECS = TOOL_SPECS.filter((tool) => tool.name !== "get_figma_prompt");
const OPENAI_TOOLS = AGENT_TOOL_SPECS.map((tool) => ({
  type: "function",
  name: tool.name,
  description: tool.description,
  parameters: tool.inputSchema,
}));

const LOCAL_SYSTEM_PROMPT =
  "You are CursorCanvas Local. Execute design requests directly in Figma using available tools and return concise status.";

let pluginSocket: WebSocket | null = null;
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const httpCommandQueue: Array<{ id: string; tool: string; params: JsonObject }> = [];
let waitingGetRes: http.ServerResponse | null = null;
let lastFigmaPrompt: string | null = null;

let wss: WebSocketServer | null = null;
let activeWsPort = FIGSOR_PORT_INIT;
let activeHttpPort = FIGSOR_PORT_INIT + 1;

function writeJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(payload));
}

function pluginBridgeReady(): boolean {
  return (pluginSocket != null && pluginSocket.readyState === 1) || waitingGetRes != null;
}

function parseJsonSafe<T>(body: string, fallback: T): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    return fallback;
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

function makeRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.unref();
    tester.once("error", () => resolve(false));
    tester.listen(port, "127.0.0.1", () => {
      tester.close(() => resolve(true));
    });
  });
}

function sendToPlugin(id: string, tool: string, params: JsonObject): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Plugin timeout"));
      }
    }, 20000);

    if (pluginSocket && pluginSocket.readyState === 1) {
      pluginSocket.send(JSON.stringify({ id, tool, params }));
      return;
    }

    httpCommandQueue.push({ id, tool, params });
    if (waitingGetRes) {
      const cmd = httpCommandQueue.shift()!;
      writeJson(waitingGetRes, 200, cmd);
      waitingGetRes = null;
    }
  });
}

async function runTool(tool: string, params: JsonObject): Promise<unknown> {
  const id = makeRequestId("chat-tool");
  return sendToPlugin(id, tool, params);
}

function extractNodeId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const maybeId = (result as { id?: unknown }).id;
  return typeof maybeId === "string" ? maybeId : null;
}

async function runLocalAgent(
  message: string,
  researchContext: string,
  designProfile: string
): Promise<{ assistant: string; toolCalls: ExecutedToolCall[] }> {
  const blended = `${message}\n${researchContext}\n${designProfile}`.toLowerCase();
  const toolCalls: ExecutedToolCall[] = [];
  const run = async (tool: string, params: JsonObject): Promise<unknown | null> => {
    try {
      const result = await runTool(tool, params);
      toolCalls.push({ tool, params, result });
      return result;
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      toolCalls.push({ tool, params, error: messageText });
      return null;
    }
  };

  const isMobile = blended.includes("mobile");
  const isTablet = blended.includes("tablet");
  const isDashboard = blended.includes("dashboard") || blended.includes("admin") || blended.includes("app");

  const canvasWidth = isMobile ? 390 : isTablet ? 834 : 1366;
  const canvasHeight = isMobile ? 844 : isTablet ? 1194 : 900;
  const canvasPadding = isMobile ? 20 : 32;
  const contentWidth = Math.max(280, canvasWidth - canvasPadding * 2);

  const rootResult = await run("create_frame", {
    name: isDashboard ? "App Shell Canvas" : "Landing Canvas",
    width: canvasWidth,
    height: canvasHeight,
    layoutMode: "VERTICAL",
    primaryAxisSizingMode: "FIXED",
    counterAxisSizingMode: "FIXED",
    itemSpacing: 20,
    paddingTop: canvasPadding,
    paddingRight: canvasPadding,
    paddingBottom: canvasPadding,
    paddingLeft: canvasPadding,
    fillR: 0.985,
    fillG: 0.987,
    fillB: 0.992,
    select: false,
  });
  const rootId = extractNodeId(rootResult);

  if (!rootId) {
    return { assistant: "Local agent could not initialize a root frame in Figma.", toolCalls };
  }

  if (blended.includes("button") && !isDashboard && !blended.includes("page")) {
    const section = await run("create_frame", {
      parentId: rootId,
      name: "Button Showcase",
      width: contentWidth,
      height: 260,
      layoutMode: "VERTICAL",
      primaryAxisSizingMode: "AUTO",
      counterAxisSizingMode: "FIXED",
      itemSpacing: 14,
      paddingTop: 18,
      paddingRight: 18,
      paddingBottom: 18,
      paddingLeft: 18,
      fillR: 0.952,
      fillG: 0.957,
      fillB: 0.969,
      cornerRadius: 14,
      select: false,
    });
    const sectionId = extractNodeId(section) ?? rootId;
    await run("create_text", {
      parentId: sectionId,
      text: "Button Variants",
      fontFamily: "Inter",
      fontStyle: "Bold",
      fontSize: 28,
      fillR: 0.11,
      fillG: 0.12,
      fillB: 0.16,
      select: false,
    });
    const row = await run("create_frame", {
      parentId: sectionId,
      name: "Button Row",
      width: Math.max(260, contentWidth - 36),
      height: 72,
      layoutMode: "HORIZONTAL",
      primaryAxisSizingMode: "AUTO",
      counterAxisSizingMode: "AUTO",
      itemSpacing: 10,
      fillR: 1,
      fillG: 1,
      fillB: 1,
      fillOpacity: 0,
      select: false,
    });
    const rowId = extractNodeId(row) ?? sectionId;
    const primary = await run("create_component", {
      parentId: rowId,
      name: "Button / Primary",
      width: 170,
      height: 48,
      cornerRadius: 9,
      fillR: 0.26,
      fillG: 0.31,
      fillB: 0.9,
      layoutMode: "HORIZONTAL",
      primaryAxisSizingMode: "AUTO",
      counterAxisSizingMode: "AUTO",
      primaryAxisAlignItems: "CENTER",
      counterAxisAlignItems: "CENTER",
      paddingTop: 12,
      paddingRight: 18,
      paddingBottom: 12,
      paddingLeft: 18,
      select: false,
    });
    const primaryId = extractNodeId(primary) ?? rowId;
    await run("create_text", {
      parentId: primaryId,
      text: "Primary Action",
      fontFamily: "Inter",
      fontStyle: "Medium",
      fontSize: 14,
      fillR: 1,
      fillG: 1,
      fillB: 1,
      select: false,
    });
    const secondary = await run("create_component", {
      parentId: rowId,
      name: "Button / Secondary",
      width: 170,
      height: 48,
      cornerRadius: 9,
      fillR: 0.89,
      fillG: 0.91,
      fillB: 0.95,
      layoutMode: "HORIZONTAL",
      primaryAxisSizingMode: "AUTO",
      counterAxisSizingMode: "AUTO",
      primaryAxisAlignItems: "CENTER",
      counterAxisAlignItems: "CENTER",
      paddingTop: 12,
      paddingRight: 18,
      paddingBottom: 12,
      paddingLeft: 18,
      select: false,
    });
    const secondaryId = extractNodeId(secondary) ?? rowId;
    await run("create_text", {
      parentId: secondaryId,
      text: "Secondary Action",
      fontFamily: "Inter",
      fontStyle: "Medium",
      fontSize: 14,
      fillR: 0.15,
      fillG: 0.17,
      fillB: 0.24,
      select: true,
    });
  } else if (isDashboard) {
    const shell = await run("create_frame", {
      parentId: rootId,
      name: "Dashboard Shell",
      width: contentWidth,
      height: isMobile ? 720 : 760,
      layoutMode: isMobile ? "VERTICAL" : "HORIZONTAL",
      primaryAxisSizingMode: "FIXED",
      counterAxisSizingMode: "FIXED",
      itemSpacing: 14,
      paddingTop: 14,
      paddingRight: 14,
      paddingBottom: 14,
      paddingLeft: 14,
      fillR: 0.968,
      fillG: 0.972,
      fillB: 0.982,
      cornerRadius: 14,
      select: false,
    });
    const shellId = extractNodeId(shell) ?? rootId;
    const sidebarWidth = isMobile ? Math.max(280, contentWidth - 28) : Math.max(220, Math.round(contentWidth * 0.24));
    const sidebar = await run("create_frame", {
      parentId: shellId,
      name: "Sidebar",
      width: sidebarWidth,
      height: isMobile ? 220 : 720,
      layoutMode: "VERTICAL",
      primaryAxisSizingMode: "FIXED",
      counterAxisSizingMode: "FIXED",
      itemSpacing: 8,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      fillR: 0.918,
      fillG: 0.929,
      fillB: 0.956,
      cornerRadius: 12,
      select: false,
    });
    const sidebarId = extractNodeId(sidebar) ?? shellId;
    for (const label of ["Workspace", "Overview", "Projects", "Library", "Settings"] as const) {
      await run("create_text", {
        parentId: sidebarId,
        text: label,
        fontFamily: "Inter",
        fontStyle: label === "Workspace" ? "Bold" : "Medium",
        fontSize: label === "Workspace" ? 16 : 13,
        fillR: label === "Workspace" ? 0.13 : 0.31,
        fillG: label === "Workspace" ? 0.15 : 0.34,
        fillB: label === "Workspace" ? 0.2 : 0.43,
        select: false,
      });
    }

    const content = await run("create_frame", {
      parentId: shellId,
      name: "Content",
      width: isMobile ? Math.max(280, contentWidth - 28) : Math.max(340, contentWidth - sidebarWidth - 14),
      height: isMobile ? 460 : 720,
      layoutMode: "VERTICAL",
      primaryAxisSizingMode: "FIXED",
      counterAxisSizingMode: "FIXED",
      itemSpacing: 12,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      fillR: 1,
      fillG: 1,
      fillB: 1,
      cornerRadius: 12,
      select: false,
    });
    const contentId = extractNodeId(content) ?? shellId;
    await run("create_text", {
      parentId: contentId,
      text: "Dashboard Overview",
      fontFamily: "Inter",
      fontStyle: "Bold",
      fontSize: 30,
      fillR: 0.11,
      fillG: 0.12,
      fillB: 0.17,
      select: false,
    });
    await run("create_text", {
      parentId: contentId,
      text: "Clear hierarchy with production-ready spacing and card primitives.",
      fontFamily: "Inter",
      fontStyle: "Regular",
      fontSize: 15,
      fillR: 0.35,
      fillG: 0.38,
      fillB: 0.49,
      select: false,
    });
    const stats = await run("create_frame", {
      parentId: contentId,
      name: "Stats",
      width: Math.max(300, contentWidth - sidebarWidth - 62),
      height: 116,
      layoutMode: isMobile ? "VERTICAL" : "HORIZONTAL",
      primaryAxisSizingMode: "AUTO",
      counterAxisSizingMode: "FIXED",
      itemSpacing: 10,
      fillR: 1,
      fillG: 1,
      fillB: 1,
      fillOpacity: 0,
      select: false,
    });
    const statsId = extractNodeId(stats) ?? contentId;
    for (const metric of ["Active boards", "Design tokens", "Open reviews"] as const) {
      const card = await run("create_component", {
        parentId: statsId,
        name: `Metric / ${metric}`,
        width: isMobile ? Math.max(260, contentWidth - 62) : 170,
        height: 98,
        cornerRadius: 11,
        fillR: 0.935,
        fillG: 0.944,
        fillB: 0.97,
        layoutMode: "VERTICAL",
        primaryAxisSizingMode: "AUTO",
        counterAxisSizingMode: "FIXED",
        itemSpacing: 6,
        paddingTop: 14,
        paddingRight: 14,
        paddingBottom: 14,
        paddingLeft: 14,
        select: false,
      });
      const cardId = extractNodeId(card) ?? statsId;
      await run("create_text", {
        parentId: cardId,
        text: metric,
        fontFamily: "Inter",
        fontStyle: "Medium",
        fontSize: 12,
        fillR: 0.35,
        fillG: 0.38,
        fillB: 0.49,
        select: false,
      });
      await run("create_text", {
        parentId: cardId,
        text: metric === "Active boards" ? "42" : metric === "Design tokens" ? "128" : "9",
        fontFamily: "Inter",
        fontStyle: "Bold",
        fontSize: 28,
        fillR: 0.12,
        fillG: 0.14,
        fillB: 0.2,
        select: false,
      });
    }
    await run("create_rectangle", {
      parentId: contentId,
      name: "Chart Placeholder",
      width: Math.max(300, contentWidth - sidebarWidth - 62),
      height: 260,
      cornerRadius: 12,
      fillR: 0.93,
      fillG: 0.945,
      fillB: 0.985,
      select: true,
    });
  } else {
    const nav = await run("create_frame", {
      parentId: rootId,
      name: "Navbar",
      width: contentWidth,
      height: 72,
      layoutMode: "HORIZONTAL",
      primaryAxisSizingMode: "FIXED",
      counterAxisSizingMode: "FIXED",
      primaryAxisAlignItems: "SPACE_BETWEEN",
      counterAxisAlignItems: "CENTER",
      paddingTop: 14,
      paddingRight: 18,
      paddingBottom: 14,
      paddingLeft: 18,
      fillR: 0.94,
      fillG: 0.95,
      fillB: 0.97,
      cornerRadius: 12,
      select: false,
    });
    const navId = extractNodeId(nav) ?? rootId;
    await run("create_text", {
      parentId: navId,
      text: "CursorCanvas",
      fontFamily: "Inter",
      fontStyle: "Bold",
      fontSize: 20,
      fillR: 0.12,
      fillG: 0.13,
      fillB: 0.18,
      select: false,
    });
    await run("create_text", {
      parentId: navId,
      text: "Docs   Pricing   Login",
      fontFamily: "Inter",
      fontStyle: "Medium",
      fontSize: 13,
      fillR: 0.35,
      fillG: 0.39,
      fillB: 0.5,
      select: false,
    });

    const hero = await run("create_frame", {
      parentId: rootId,
      name: "Hero",
      width: contentWidth,
      height: isMobile ? 360 : 420,
      layoutMode: "VERTICAL",
      primaryAxisSizingMode: "FIXED",
      counterAxisSizingMode: "FIXED",
      itemSpacing: 14,
      paddingTop: isMobile ? 24 : 34,
      paddingRight: isMobile ? 22 : 30,
      paddingBottom: isMobile ? 24 : 34,
      paddingLeft: isMobile ? 22 : 30,
      fillR: 0.93,
      fillG: 0.944,
      fillB: 0.982,
      cornerRadius: 16,
      select: false,
    });
    const heroId = extractNodeId(hero) ?? rootId;
    await run("create_text", {
      parentId: heroId,
      text: "Design polished interfaces in one pass",
      fontFamily: "Inter",
      fontStyle: "Bold",
      fontSize: isMobile ? 36 : 56,
      fillR: 0.09,
      fillG: 0.1,
      fillB: 0.14,
      select: false,
    });
    await run("create_text", {
      parentId: heroId,
      text: "Frame-first structure, clean spacing rhythm, and reusable components ready for handoff.",
      fontFamily: "Inter",
      fontStyle: "Regular",
      fontSize: isMobile ? 15 : 18,
      fillR: 0.32,
      fillG: 0.35,
      fillB: 0.45,
      select: false,
    });
    const ctaRow = await run("create_frame", {
      parentId: heroId,
      name: "CTA",
      width: Math.max(240, contentWidth - 60),
      height: 58,
      layoutMode: "HORIZONTAL",
      primaryAxisSizingMode: "AUTO",
      counterAxisSizingMode: "AUTO",
      itemSpacing: 10,
      fillR: 1,
      fillG: 1,
      fillB: 1,
      fillOpacity: 0,
      select: false,
    });
    const ctaRowId = extractNodeId(ctaRow) ?? heroId;
    const primary = await run("create_component", {
      parentId: ctaRowId,
      name: "Button / Primary",
      width: 170,
      height: 48,
      cornerRadius: 9,
      fillR: 0.25,
      fillG: 0.31,
      fillB: 0.9,
      layoutMode: "HORIZONTAL",
      primaryAxisSizingMode: "AUTO",
      counterAxisSizingMode: "AUTO",
      primaryAxisAlignItems: "CENTER",
      counterAxisAlignItems: "CENTER",
      paddingTop: 12,
      paddingRight: 18,
      paddingBottom: 12,
      paddingLeft: 18,
      select: false,
    });
    const primaryId = extractNodeId(primary) ?? ctaRowId;
    await run("create_text", {
      parentId: primaryId,
      text: "Start Designing",
      fontFamily: "Inter",
      fontStyle: "Medium",
      fontSize: 14,
      fillR: 1,
      fillG: 1,
      fillB: 1,
      select: false,
    });
    const secondary = await run("create_component", {
      parentId: ctaRowId,
      name: "Button / Secondary",
      width: 160,
      height: 48,
      cornerRadius: 9,
      fillR: 0.885,
      fillG: 0.9,
      fillB: 0.94,
      layoutMode: "HORIZONTAL",
      primaryAxisSizingMode: "AUTO",
      counterAxisSizingMode: "AUTO",
      primaryAxisAlignItems: "CENTER",
      counterAxisAlignItems: "CENTER",
      paddingTop: 12,
      paddingRight: 18,
      paddingBottom: 12,
      paddingLeft: 18,
      select: false,
    });
    const secondaryId = extractNodeId(secondary) ?? ctaRowId;
    await run("create_text", {
      parentId: secondaryId,
      text: "View Components",
      fontFamily: "Inter",
      fontStyle: "Medium",
      fontSize: 14,
      fillR: 0.16,
      fillG: 0.18,
      fillB: 0.26,
      select: false,
    });

    const featureRow = await run("create_frame", {
      parentId: rootId,
      name: "Feature Cards",
      width: contentWidth,
      height: 170,
      layoutMode: isMobile ? "VERTICAL" : "HORIZONTAL",
      primaryAxisSizingMode: "AUTO",
      counterAxisSizingMode: "FIXED",
      itemSpacing: 10,
      fillR: 1,
      fillG: 1,
      fillB: 1,
      fillOpacity: 0,
      select: false,
    });
    const featureRowId = extractNodeId(featureRow) ?? rootId;
    for (const item of [
      { title: "Auto Layout First", body: "Generated comps stay editable and structured." },
      { title: "Token Driven", body: "Neutral base + semantic accent keeps themes stable." },
      { title: "Handoff Ready", body: "Production-friendly hierarchy and spacing rhythm." },
    ] as const) {
      const card = await run("create_component", {
        parentId: featureRowId,
        name: `Feature / ${item.title}`,
        width: isMobile ? Math.max(250, contentWidth) : Math.max(220, Math.floor((contentWidth - 20) / 3)),
        height: 160,
        cornerRadius: 12,
        fillR: 0.955,
        fillG: 0.963,
        fillB: 0.982,
        layoutMode: "VERTICAL",
        primaryAxisSizingMode: "AUTO",
        counterAxisSizingMode: "FIXED",
        itemSpacing: 8,
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        select: false,
      });
      const cardId = extractNodeId(card) ?? featureRowId;
      await run("create_text", {
        parentId: cardId,
        text: item.title,
        fontFamily: "Inter",
        fontStyle: "Bold",
        fontSize: 19,
        fillR: 0.14,
        fillG: 0.16,
        fillB: 0.22,
        select: false,
      });
      await run("create_text", {
        parentId: cardId,
        text: item.body,
        fontFamily: "Inter",
        fontStyle: "Regular",
        fontSize: 14,
        fillR: 0.35,
        fillG: 0.39,
        fillB: 0.5,
        select: false,
      });
    }
    await run("create_text", {
      parentId: rootId,
      text: `Prompt: ${message.slice(0, 140)}`,
      fontFamily: "Inter",
      fontStyle: "Regular",
      fontSize: 12,
      fillR: 0.42,
      fillG: 0.46,
      fillB: 0.58,
      select: true,
    });
  }

  const successCount = toolCalls.filter((c) => c.error == null).length;
  const failCount = toolCalls.length - successCount;
  const assistant = failCount === 0
    ? `Local agent generated a structured layout with ${successCount} Figma actions. Review and iterate from this frame-first starting point.`
    : `Local agent executed ${successCount} action(s) with ${failCount} error(s).`;

  return { assistant, toolCalls };
}

function extractOpenAIFunctionCalls(response: OpenAIResponse): OpenAIFunctionCall[] {
  const output = Array.isArray(response.output) ? response.output : [];
  const calls: OpenAIFunctionCall[] = [];
  for (const item of output) {
    if (item.type !== "function_call") continue;
    const name = typeof item.name === "string" ? item.name : null;
    const callId = typeof item.call_id === "string" ? item.call_id : null;
    const args = typeof item.arguments === "string" ? item.arguments : "{}";
    if (!name || !callId) continue;
    calls.push({ name, call_id: callId, arguments: args });
  }
  return calls;
}

function extractOpenAIText(response: OpenAIResponse): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const output = Array.isArray(response.output) ? response.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (item.type !== "message") continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (part && part.type === "output_text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
      if (part && part.type === "text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

async function createOpenAIResponse(apiKey: string, body: JsonObject): Promise<OpenAIResponse> {
  const res = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 280)}`);
  }

  return parseJsonSafe<OpenAIResponse>(raw, { id: "invalid" });
}

async function runOpenAIAgent(
  message: string,
  conversation: ChatMessage[],
  model: string,
  apiKey: string,
  researchContext: string,
  designProfile: string
): Promise<{ assistant: string; toolCalls: ExecutedToolCall[] }> {
  const safeConversation = conversation.slice(-20).filter((m) => m.content && (m.role === "user" || m.role === "assistant"));
  const input = [
    ...safeConversation.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  let response = await createOpenAIResponse(apiKey, {
    model,
    instructions: [
      "You are CursorCanvas, a senior product designer and UI engineer.",
      "Translate research and planning into production-ready Figma output using tools.",
      "Use robust Auto Layout, token-driven structure, and shadcn-compatible semantics.",
      "Default to A/B/C thinking: A faithful, B refined, C bolder 2026 exploration.",
      "Keep final assistant response concise and practical.",
      designProfile ? `Design profile:\n${designProfile}` : "",
      researchContext ? `Research context:\n${researchContext}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    input,
    tools: OPENAI_TOOLS,
    tool_choice: "auto",
  });

  const toolCalls: ExecutedToolCall[] = [];
  let guard = 0;

  while (guard < 8) {
    guard += 1;
    const calls = extractOpenAIFunctionCalls(response);
    if (calls.length === 0) break;

    const outputs: Array<{ type: "function_call_output"; call_id: string; output: string }> = [];
    for (const call of calls) {
      const args = parseJsonSafe<JsonObject>(call.arguments, {});
      try {
        const result = await runTool(call.name, args);
        toolCalls.push({ tool: call.name, params: args, result });
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({ ok: true, result }),
        });
      } catch (err) {
        const messageText = err instanceof Error ? err.message : String(err);
        toolCalls.push({ tool: call.name, params: args, error: messageText });
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({ ok: false, error: messageText }),
        });
      }
    }

    response = await createOpenAIResponse(apiKey, {
      model,
      previous_response_id: response.id,
      input: outputs,
      tools: OPENAI_TOOLS,
      tool_choice: "auto",
    });
  }

  const assistant = extractOpenAIText(response) || "Done.";
  return { assistant, toolCalls };
}

async function handleChatRequest(payload: ChatRequest): Promise<{
  assistant: string;
  provider: string;
  model?: string;
  toolCalls: ExecutedToolCall[];
}> {
  const provider = (payload.provider ?? "local").toLowerCase();
  const message = (payload.message ?? "").trim();
  const researchContext = (payload.researchContext ?? "").trim();
  const designProfile = (payload.designProfile ?? "").trim();
  if (!message) throw new Error("message is required");
  if (!pluginBridgeReady()) throw new Error("Figma plugin is not connected. Click Connect in CursorCanvas first.");

  if (provider === "local") {
    const local = await runLocalAgent(message, researchContext, designProfile);
    return { assistant: local.assistant, provider, toolCalls: local.toolCalls };
  }

  if (provider === "openai") {
    const apiKey = payload.apiKey?.trim() || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key missing. Add it in plugin UI or OPENAI_API_KEY env.");
    }
    const model = payload.model?.trim() || "gpt-5-mini";
    const conversation = Array.isArray(payload.conversation) ? payload.conversation : [];
    const result = await runOpenAIAgent(
      message,
      conversation,
      model,
      apiKey,
      researchContext,
      designProfile
    );
    return { assistant: result.assistant, provider, model, toolCalls: result.toolCalls };
  }

  if (provider === "cursor" || provider === "lovable") {
    throw new Error(`${provider} provider is not available yet in CursorCanvas plugin chat.`);
  }

  throw new Error(`Unknown provider: ${provider}`);
}

const httpServer = http.createServer(async (req, res) => {
  const url = req.url ?? "";

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url === "/health") {
    writeJson(res, 200, {
      ok: true,
      wsPort: activeWsPort,
      httpPort: activeHttpPort,
      pluginConnected: pluginSocket != null && pluginSocket.readyState === 1,
    });
    return;
  }

  if (req.method === "GET" && (url === "/poll" || url === "/")) {
    if (httpCommandQueue.length > 0) {
      const cmd = httpCommandQueue.shift()!;
      writeJson(res, 200, cmd);
    } else {
      waitingGetRes = res;
      res.on("close", () => {
        if (waitingGetRes === res) waitingGetRes = null;
      });
    }
    return;
  }

  if (req.method === "POST" && url === "/result") {
    const body = await readBody(req);
    const msg = parseJsonSafe<{ id?: string; result?: unknown; error?: string }>(body, {});
    if (msg.id && pending.has(msg.id)) {
      const request = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) request.reject(new Error(msg.error));
      else request.resolve(msg.result);
    }
    writeJson(res, 200, {});
    return;
  }

  if (req.method === "POST" && url === "/prompt") {
    const body = await readBody(req);
    const msg = parseJsonSafe<{ text?: string }>(body, {});
    lastFigmaPrompt = typeof msg.text === "string" ? msg.text.trim() || null : null;
    writeJson(res, 200, {});
    return;
  }

  if (req.method === "POST" && url === "/chat") {
    const body = await readBody(req);
    const payload = parseJsonSafe<ChatRequest>(body, {});
    try {
      const result = await handleChatRequest(payload);
      writeJson(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeJson(res, 400, { error: message });
    }
    return;
  }

  writeJson(res, 404, { error: "Not found" });
});

let portBindAttemptCounter = 0;
let portRetryPending = false;

function schedulePortRetry(wsPort: number, httpPort: number): void {
  if (portRetryPending) return;
  portRetryPending = true;

  const runRetry = () => {
    portRetryPending = false;
    tryPortPair(wsPort, httpPort);
  };

  if (httpServer.listening) {
    httpServer.close(() => runRetry());
    return;
  }

  setImmediate(runRetry);
}

function tryPortPair(wsPort: number, httpPort: number): void {
  const bindAttemptId = ++portBindAttemptCounter;

  if (httpPort > FIGSOR_PORT_MAX) {
    console.error("No ports available in range. Stop other processes using 3055-3080.");
    process.exit(1);
  }

  httpServer.removeAllListeners("error");

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (bindAttemptId !== portBindAttemptCounter) return;
    if (err.code === "EADDRINUSE") schedulePortRetry(wsPort + 2, httpPort + 2);
    else throw err;
  });

  try {
    httpServer.listen(httpPort, () => {
      if (bindAttemptId !== portBindAttemptCounter) return;

      activeWsPort = wsPort;
      activeHttpPort = httpPort;

      if (wss) {
        wss.close();
        wss = null;
      }

      void probePort(wsPort).then((available) => {
        if (bindAttemptId !== portBindAttemptCounter) return;

        if (!available) {
          schedulePortRetry(wsPort + 2, httpPort + 2);
          return;
        }

        try {
          wss = new WebSocketServer({ port: wsPort });
        } catch (err) {
          const e = err as NodeJS.ErrnoException;
          if (e.code === "EADDRINUSE") {
            schedulePortRetry(wsPort + 2, httpPort + 2);
            return;
          }
          throw err;
        }

        wss.on("error", (err: NodeJS.ErrnoException) => {
          if (bindAttemptId !== portBindAttemptCounter) return;

          if (err.code === "EADDRINUSE") {
            schedulePortRetry(wsPort + 2, httpPort + 2);
          } else {
            throw err;
          }
        });

        wss.on("connection", (ws: WebSocket) => {
          pluginSocket = ws;

          ws.on("close", () => {
            if (pluginSocket === ws) pluginSocket = null;
          });

          ws.on("message", (data: Buffer | Buffer[] | ArrayBuffer) => {
            try {
              const msg = JSON.parse(data.toString()) as {
                type?: string;
                text?: string;
                id?: string;
                result?: unknown;
                error?: string;
              };

              if (msg.type === "figma_prompt" && typeof msg.text === "string") {
                lastFigmaPrompt = msg.text.trim() || null;
                return;
              }
              if (msg.id && pending.has(msg.id)) {
                const request = pending.get(msg.id)!;
                pending.delete(msg.id);
                if (msg.error) request.reject(new Error(msg.error));
                else request.resolve(msg.result);
              }
            } catch {
              // Ignore malformed message.
            }
          });
        });

        wss.on("listening", () => {
          if (bindAttemptId !== portBindAttemptCounter) return;

          console.error(
            `CursorCanvas: WebSocket port ${wsPort}, HTTP port ${httpPort}. Connect plugin to ws://localhost:${wsPort}`
          );
        });
      });
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ERR_SERVER_ALREADY_LISTEN") {
      schedulePortRetry(wsPort, httpPort);
      return;
    }
    throw err;
  }
}

tryPortPair(FIGSOR_PORT_INIT, FIGSOR_PORT_INIT + 1);

const mcpServer = new Server(
  {
    name: "cursorcanvas-mcp",
    version: "0.2.0",
  },
  {
    capabilities: { tools: {} },
  }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_SPECS,
}));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const params = (args as JsonObject) ?? {};

  if (name === "get_figma_prompt") {
    const text = lastFigmaPrompt;
    lastFigmaPrompt = null;
    return {
      content: [
        {
          type: "text" as const,
          text: text != null
            ? JSON.stringify({ prompt: text })
            : JSON.stringify({ prompt: null, message: "No prompt from Figma." }),
        },
      ],
    };
  }

  try {
    const result = await runTool(name, params);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await mcpServer.connect(transport);

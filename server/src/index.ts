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

async function runLocalAgent(message: string): Promise<{ assistant: string; toolCalls: ExecutedToolCall[] }> {
  const lower = message.toLowerCase();
  const plannedCalls: Array<{ tool: string; params: JsonObject }> = [];

  if (lower.includes("landing")) {
    plannedCalls.push({
      tool: "create_frame",
      params: {
        name: "Landing Page",
        width: 1440,
        height: 980,
        layoutMode: "VERTICAL",
        itemSpacing: 24,
        paddingTop: 40,
        paddingRight: 40,
        paddingBottom: 40,
        paddingLeft: 40,
      },
    });
    plannedCalls.push({
      tool: "create_text",
      params: { text: "Headline", fontSize: 56, fillR: 0.1, fillG: 0.1, fillB: 0.1 },
    });
  } else if (lower.includes("button")) {
    plannedCalls.push({
      tool: "create_component",
      params: {
        name: "Button / Primary",
        width: 180,
        height: 52,
        cornerRadius: 12,
        fillR: 0.2,
        fillG: 0.2,
        fillB: 0.2,
      },
    });
  } else if (lower.includes("circle") || lower.includes("ellipse")) {
    plannedCalls.push({
      tool: "create_ellipse",
      params: {
        name: "Circle",
        width: 140,
        height: 140,
        fillR: 0.25,
        fillG: 0.25,
        fillB: 0.25,
      },
    });
  } else if (lower.includes("card")) {
    plannedCalls.push({
      tool: "create_rectangle",
      params: {
        name: "Card",
        width: 360,
        height: 220,
        cornerRadius: 16,
        fillR: 0.95,
        fillG: 0.95,
        fillB: 0.95,
      },
    });
  } else {
    plannedCalls.push({
      tool: "create_frame",
      params: { name: "Canvas", width: 1200, height: 900, layoutMode: "VERTICAL", itemSpacing: 16 },
    });
    plannedCalls.push({
      tool: "create_text",
      params: { text: message, fontSize: 20, fillR: 0.1, fillG: 0.1, fillB: 0.1 },
    });
  }

  const toolCalls: ExecutedToolCall[] = [];
  for (const call of plannedCalls) {
    try {
      const result = await runTool(call.tool, call.params);
      toolCalls.push({ tool: call.tool, params: call.params, result });
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      toolCalls.push({ tool: call.tool, params: call.params, error: messageText });
    }
  }

  const successCount = toolCalls.filter((c) => c.error == null).length;
  const failCount = toolCalls.length - successCount;
  const assistant = failCount === 0
    ? `Local agent executed ${successCount} Figma action${successCount !== 1 ? "s" : ""}.`
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
  apiKey: string
): Promise<{ assistant: string; toolCalls: ExecutedToolCall[] }> {
  const safeConversation = conversation.slice(-20).filter((m) => m.content && (m.role === "user" || m.role === "assistant"));
  const input = [
    ...safeConversation.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  let response = await createOpenAIResponse(apiKey, {
    model,
    instructions:
      "You are CursorCanvas. Execute design requests by calling tools. Keep assistant text concise. Prefer practical UI composition.",
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
  if (!message) throw new Error("message is required");
  if (!pluginBridgeReady()) throw new Error("Figma plugin is not connected. Click Connect in CursorCanvas first.");

  if (provider === "local") {
    const local = await runLocalAgent(message);
    return { assistant: local.assistant, provider, toolCalls: local.toolCalls };
  }

  if (provider === "openai") {
    const apiKey = payload.apiKey?.trim() || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key missing. Add it in plugin UI or OPENAI_API_KEY env.");
    }
    const model = payload.model?.trim() || "gpt-5-mini";
    const conversation = Array.isArray(payload.conversation) ? payload.conversation : [];
    const result = await runOpenAIAgent(message, conversation, model, apiKey);
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

function tryPortPair(wsPort: number, httpPort: number): void {
  if (httpPort > FIGSOR_PORT_MAX) {
    console.error("No ports available in range. Stop other processes using 3055-3080.");
    process.exit(1);
  }

  httpServer.removeAllListeners("error");
  httpServer.listen(httpPort, () => {
    activeWsPort = wsPort;
    activeHttpPort = httpPort;

    if (wss) {
      wss.close();
      wss = null;
    }

    void probePort(wsPort).then((available) => {
      if (!available) {
        httpServer.close(() => tryPortPair(wsPort + 2, httpPort + 2));
        return;
      }

      try {
        wss = new WebSocketServer({ port: wsPort });
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "EADDRINUSE") {
          httpServer.close(() => tryPortPair(wsPort + 2, httpPort + 2));
          return;
        }
        throw err;
      }

      wss.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          httpServer.close(() => tryPortPair(wsPort + 2, httpPort + 2));
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
        console.error(
          `CursorCanvas: WebSocket port ${wsPort}, HTTP port ${httpPort}. Connect plugin to ws://localhost:${wsPort}`
        );
      });
    });
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") tryPortPair(wsPort + 2, httpPort + 2);
    else throw err;
  });
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

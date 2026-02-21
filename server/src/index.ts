#!/usr/bin/env node

import * as http from "http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer, type WebSocket } from "ws";

const FIGSOR_PORT_INIT = parseInt(process.env.FIGSOR_PORT ?? "3055", 10);
const FIGSOR_PORT_MAX = 3080;

let pluginSocket: WebSocket | null = null;
const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

const httpCommandQueue: Array<{ id: string; tool: string; params: Record<string, unknown> }> = [];
let waitingGetRes: http.ServerResponse | null = null;

let lastFigmaPrompt: string | null = null;

const httpServer = http.createServer((req, res) => {
  const url = req.url ?? "";
  if (req.method === "GET" && url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(
      JSON.stringify({
        ok: true,
        wsPort: activeWsPort,
        httpPort: activeHttpPort,
        pluginConnected: pluginSocket != null && pluginSocket.readyState === 1,
      })
    );
    return;
  }
  if (req.method === "GET" && (url === "/poll" || url === "/")) {
    if (httpCommandQueue.length > 0) {
      const cmd = httpCommandQueue.shift()!;
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(cmd));
    } else {
      waitingGetRes = res;
      res.on("close", () => {
        if (waitingGetRes === res) waitingGetRes = null;
      });
    }
    return;
  }
  if (req.method === "POST" && url === "/result") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const msg = JSON.parse(body) as { id: string; result?: unknown; error?: string };
        if (msg.id && pending.has(msg.id)) {
          const p = pending.get(msg.id)!;
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error));
          else p.resolve(msg.result);
        }
      } catch (_) {}
      res.writeHead(200, { "Access-Control-Allow-Origin": "*" });
      res.end("{}");
    });
    return;
  }
  if (req.method === "POST" && url === "/prompt") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const msg = JSON.parse(body || "{}") as { text?: string };
        lastFigmaPrompt = typeof msg.text === "string" ? msg.text.trim() || null : null;
      } catch (_) {}
      res.writeHead(200, { "Access-Control-Allow-Origin": "*" });
      res.end("{}");
    });
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    res.end();
    return;
  }
  res.writeHead(404);
  res.end();
});

let wss: WebSocketServer | null = null;
let activeWsPort = FIGSOR_PORT_INIT;
let activeHttpPort = FIGSOR_PORT_INIT + 1;

function tryPortPair(wsPort: number, httpPort: number): void {
  if (httpPort > FIGSOR_PORT_MAX) {
    console.error("No ports available in range. Stop other processes using 3055–3080.");
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
    wss = new WebSocketServer({ port: wsPort });
    // Attach error first so EADDRINUSE is handled before any async emit
    wss.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        httpServer.close(() => tryPortPair(wsPort + 2, httpPort + 2));
      } else throw err;
    });
    wss.on("connection", (ws: WebSocket) => {
      pluginSocket = ws;
      ws.on("close", () => {
        if (pluginSocket === ws) pluginSocket = null;
      });
      ws.on("message", (data: Buffer | Buffer[] | ArrayBuffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "debug") return;
          if (msg.type === "figma_prompt" && typeof msg.text === "string") {
            lastFigmaPrompt = msg.text.trim() || null;
            return;
          }
          if (msg.id && pending.has(msg.id)) {
            const p = pending.get(msg.id)!;
            pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error));
            else p.resolve(msg.result);
          }
        } catch {
          // ignore parse errors
        }
      });
    });
    wss.on("listening", () => {
      console.error(`CursorCanvas: WebSocket port ${wsPort}, HTTP port ${httpPort}. Connect plugin to ws://localhost:${wsPort}`);
    });
  });
  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      tryPortPair(wsPort + 2, httpPort + 2);
    } else throw err;
  });
}

tryPortPair(FIGSOR_PORT_INIT, FIGSOR_PORT_INIT + 1);

function sendToPlugin(id: string, tool: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Plugin timeout"));
      }
    }, 30000);

    if (pluginSocket && pluginSocket.readyState === 1) {
      pluginSocket.send(JSON.stringify({ id, tool, params }));
      return;
    }

    httpCommandQueue.push({ id, tool, params });
    if (waitingGetRes) {
      const cmd = httpCommandQueue.shift()!;
      waitingGetRes.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      waitingGetRes.end(JSON.stringify(cmd));
      waitingGetRes = null;
    }
  });
}

const server = new Server(
  {
    name: "figma-design-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "create_frame",
      description: "Create a new frame in Figma. Optionally name, x, y, width, height. For auto-layout (horizontal/vertical container with gap), set layoutMode to HORIZONTAL or VERTICAL and itemSpacing to gap in px (e.g. 12). Use with design tokens (docs/design-tokens.md) for consistent layout.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Frame name" },
          x: { type: "number", description: "X position" },
          y: { type: "number", description: "Y position" },
          width: { type: "number", description: "Width in px" },
          height: { type: "number", description: "Height in px" },
          layoutMode: { type: "string", enum: ["NONE", "HORIZONTAL", "VERTICAL"], description: "Auto-layout direction; use HORIZONTAL or VERTICAL for flex-style container" },
          itemSpacing: { type: "number", description: "Gap between children in px (for auto-layout frames)" },
        },
      },
    },
    {
      name: "create_text",
      description: "Create a text node in Figma. Optionally specify font family, style, fontSize (default 16), fill color (fillR, fillG, fillB in 0-1), x, y. Prefer docs/design-tokens.md for type scale and colors.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text content" },
          fontSize: { type: "number", description: "Font size in px (e.g. 72 for H1)" },
          fontFamily: { type: "string", description: "Font family (e.g. Georgia, Merriweather for serif)" },
          fontStyle: { type: "string", description: "Font style (e.g. Regular, Bold)" },
          fillR: { type: "number", description: "Red 0-1 (e.g. 1 for red)" },
          fillG: { type: "number", description: "Green 0-1" },
          fillB: { type: "number", description: "Blue 0-1" },
          x: { type: "number", description: "X position" },
          y: { type: "number", description: "Y position" },
        },
      },
    },
    {
      name: "create_rectangle",
      description: "Create a rectangle or square in Figma. Use for cards, panels, shapes. E.g. blue square: width=height, fillR 0, fillG 0.4, fillB 1. Prefer design tokens from docs/design-tokens.md for consistent UI.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Layer name" },
          width: { type: "number", description: "Width in px" },
          height: { type: "number", description: "Height in px" },
          x: { type: "number", description: "X position" },
          y: { type: "number", description: "Y position" },
          fillR: { type: "number", description: "Red 0-1" },
          fillG: { type: "number", description: "Green 0-1" },
          fillB: { type: "number", description: "Blue 0-1" },
          cornerRadius: { type: "number", description: "Corner radius in px (optional)" },
        },
      },
    },
    {
      name: "create_ellipse",
      description: "Create an ellipse or circle in Figma. Equal width and height = circle. Use fillR, fillG, fillB (0-1). Prefer design tokens for consistent UI.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Layer name" },
          width: { type: "number", description: "Width in px" },
          height: { type: "number", description: "Height in px" },
          x: { type: "number", description: "X position" },
          y: { type: "number", description: "Y position" },
          fillR: { type: "number", description: "Red 0-1" },
          fillG: { type: "number", description: "Green 0-1" },
          fillB: { type: "number", description: "Blue 0-1" },
        },
      },
    },
    {
      name: "create_component",
      description: "Create a component in Figma. Useful for reusable UI building blocks. Supports name, size, position, fill color, corner radius, and auto-layout settings.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Component name" },
          width: { type: "number", description: "Width in px" },
          height: { type: "number", description: "Height in px" },
          x: { type: "number", description: "X position" },
          y: { type: "number", description: "Y position" },
          fillR: { type: "number", description: "Red 0-1" },
          fillG: { type: "number", description: "Green 0-1" },
          fillB: { type: "number", description: "Blue 0-1" },
          fillOpacity: { type: "number", description: "Fill opacity 0-1" },
          cornerRadius: { type: "number", description: "Corner radius in px" },
          layoutMode: { type: "string", enum: ["NONE", "HORIZONTAL", "VERTICAL"], description: "Auto-layout direction" },
          itemSpacing: { type: "number", description: "Auto-layout gap in px" },
          paddingTop: { type: "number", description: "Top padding in px" },
          paddingRight: { type: "number", description: "Right padding in px" },
          paddingBottom: { type: "number", description: "Bottom padding in px" },
          paddingLeft: { type: "number", description: "Left padding in px" },
        },
      },
    },
    {
      name: "create_line",
      description: "Create a line in Figma. Supports length, stroke color, stroke weight, position, and rotation.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Line name" },
          length: { type: "number", description: "Length in px" },
          x: { type: "number", description: "X position" },
          y: { type: "number", description: "Y position" },
          strokeR: { type: "number", description: "Red 0-1" },
          strokeG: { type: "number", description: "Green 0-1" },
          strokeB: { type: "number", description: "Blue 0-1" },
          strokeOpacity: { type: "number", description: "Stroke opacity 0-1" },
          strokeWeight: { type: "number", description: "Stroke width in px" },
          rotation: { type: "number", description: "Rotation in degrees" },
        },
      },
    },
    {
      name: "create_polygon",
      description: "Create a polygon in Figma. Supports side count, radius or size, fill color, and position.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Polygon name" },
          sides: { type: "number", description: "Number of sides (3-60)" },
          radius: { type: "number", description: "Radius in px (if width/height not provided)" },
          width: { type: "number", description: "Width in px" },
          height: { type: "number", description: "Height in px" },
          x: { type: "number", description: "X position" },
          y: { type: "number", description: "Y position" },
          fillR: { type: "number", description: "Red 0-1" },
          fillG: { type: "number", description: "Green 0-1" },
          fillB: { type: "number", description: "Blue 0-1" },
          fillOpacity: { type: "number", description: "Fill opacity 0-1" },
        },
      },
    },
    {
      name: "create_star",
      description: "Create a star in Figma. Supports point count, radius or size, fill color, and position.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Star name" },
          points: { type: "number", description: "Number of points (3-60)" },
          radius: { type: "number", description: "Radius in px (if width/height not provided)" },
          width: { type: "number", description: "Width in px" },
          height: { type: "number", description: "Height in px" },
          x: { type: "number", description: "X position" },
          y: { type: "number", description: "Y position" },
          fillR: { type: "number", description: "Red 0-1" },
          fillG: { type: "number", description: "Green 0-1" },
          fillB: { type: "number", description: "Blue 0-1" },
          fillOpacity: { type: "number", description: "Fill opacity 0-1" },
        },
      },
    },
    {
      name: "set_auto_layout",
      description: "Apply auto-layout settings to a target frame/component. Target node defaults to current selection if nodeId is omitted.",
      inputSchema: {
        type: "object",
        properties: {
          nodeId: { type: "string", description: "Target node ID (optional, defaults to selected node)" },
          layoutMode: { type: "string", enum: ["NONE", "HORIZONTAL", "VERTICAL"], description: "Auto-layout direction" },
          itemSpacing: { type: "number", description: "Gap between children in px" },
          paddingTop: { type: "number", description: "Top padding in px" },
          paddingRight: { type: "number", description: "Right padding in px" },
          paddingBottom: { type: "number", description: "Bottom padding in px" },
          paddingLeft: { type: "number", description: "Left padding in px" },
          primaryAxisAlignItems: { type: "string", enum: ["MIN", "CENTER", "MAX", "SPACE_BETWEEN"], description: "Primary axis alignment" },
          counterAxisAlignItems: { type: "string", enum: ["MIN", "CENTER", "MAX", "BASELINE"], description: "Cross axis alignment" },
          primaryAxisSizingMode: { type: "string", enum: ["FIXED", "AUTO"], description: "Primary axis sizing mode" },
          counterAxisSizingMode: { type: "string", enum: ["FIXED", "AUTO"], description: "Cross axis sizing mode" },
        },
      },
    },
    {
      name: "set_fill_color",
      description: "Set a solid fill color on a target node. Target node defaults to current selection if nodeId is omitted.",
      inputSchema: {
        type: "object",
        properties: {
          nodeId: { type: "string", description: "Target node ID (optional, defaults to selected node)" },
          fillR: { type: "number", description: "Red 0-1" },
          fillG: { type: "number", description: "Green 0-1" },
          fillB: { type: "number", description: "Blue 0-1" },
          fillOpacity: { type: "number", description: "Fill opacity 0-1" },
        },
        required: ["fillR", "fillG", "fillB"],
      },
    },
    {
      name: "set_corner_radius",
      description: "Set corner radius on a target node that supports it. Target node defaults to current selection if nodeId is omitted.",
      inputSchema: {
        type: "object",
        properties: {
          nodeId: { type: "string", description: "Target node ID (optional, defaults to selected node)" },
          cornerRadius: { type: "number", description: "Corner radius in px" },
        },
        required: ["cornerRadius"],
      },
    },
    {
      name: "get_selection",
      description: "Get the current selection in Figma.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_figma_prompt",
      description: "Get the latest prompt sent from the Figma plugin (user typed in the plugin UI). Returns the text and clears it. Call this at the start of your turn; if the returned prompt is non-null, treat it as the user's design request and fulfill it using create_frame, create_rectangle, create_ellipse, create_text, etc.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const params = (args as Record<string, unknown>) ?? {};

  if (name === "get_figma_prompt") {
    const text = lastFigmaPrompt;
    lastFigmaPrompt = null;
    return {
      content: [
        {
          type: "text" as const,
          text: text != null ? JSON.stringify({ prompt: text }) : JSON.stringify({ prompt: null, message: "No prompt from Figma." }),
        },
      ],
    };
  }

  const id = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const result = await sendToPlugin(id, name, params);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

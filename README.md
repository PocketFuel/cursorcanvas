# CursorCanvas

Chat in Cursor or Lovable. Design in Figma.

## How to get the plugin working

1. **Free port 3055 (if something is using it)**  
   In a terminal: `lsof -i :3055`. If a process is listed, quit it or run `kill <PID>`. Do **not** run `pnpm run server:start` in a terminal — Cursor will start the server.

2. **Build once**  
   In this project folder: `pnpm run build`

3. **Configure Cursor**  
   Open `.cursor/mcp.json` in this repo and set the path to **your** machine (e.g. `/Users/Hans/figma-design-mcp/server/dist/index.js`). Save, then **quit Cursor completely** and reopen it. Open this project folder.

4. **Check MCP in Cursor**  
   **Settings → Features → MCP** (or search “MCP”). Ensure **figma-design** is **enabled**. You should see tools like `create_frame`, `create_ellipse`, `get_figma_prompt`. If the server failed to start (e.g. port in use), fix step 1 and restart Cursor again.

5. **Install and run the plugin in Figma**  
   In **Figma Desktop**: **Plugins → Development → Import plugin from manifest** → choose `plugin/manifest.json` from this repo.  
   Then **Plugins → Development → CursorCanvas**. In the plugin: **Server URL** `ws://localhost:3055` (or the port shown in Cursor’s MCP log: “Connect plugin to ws://localhost:XXXX”) → **Connect**.

6. **Use it**  
   - **From Cursor:** In chat say e.g. “In Figma, create a blue circle” or “Do the Figma prompt” (to run the last prompt you sent from the plugin).  
   - **From Figma:** Type in the plugin, click **Send to Cursor**, then in Cursor say “Do the Figma prompt” or “Do it”.

---

## Quick Start (Cursor, local)

1. **Add to Cursor MCP** – In `~/.cursor/mcp.json`:

   ```json
   {
     "mcpServers": {
       "figma-design": {
         "command": "node",
         "args": ["/absolute/path/to/figma-design-mcp/server/dist/index.js"]
       }
     }
   }
   ```

   Or with npx (after publishing): `"command": "npx", "args": ["-y", "figma-design-mcp"]`

   **Important:** Use the **absolute** path to `server/dist/index.js` (e.g. `/Users/Hans/figma-design-mcp/server/dist/index.js`). Do **not** run `pnpm run server:start` when using Cursor — Cursor starts this server via MCP.

   **Project-level config:** This repo includes `.cursor/mcp.json`. Edit the path in that file to match your machine; then open this folder in Cursor and restart Cursor. See **[docs/MCP-SETUP.md](docs/MCP-SETUP.md)** for full steps so the agent gets Figma tools.

2. **Run the Figma plugin**
   - Build: `pnpm run plugin:build` (or `pnpm run build` for plugin + server)
   - In Figma: Plugins → Development → Import plugin from manifest → select `plugin/manifest.json`
   - Run the plugin (**CursorCanvas**), enter `ws://localhost:3055`, click Connect

3. **Control from Cursor or Figma**
   - **From Cursor:** Say **"In Figma,"** then your request (e.g. "In Figma, create 5 blue circles in an auto container with 12px gap horizontally"). Or say **"Do the Figma prompt"** / **"Do it"** to run whatever you last sent from the plugin.
   - **From Figma:** In the plugin, type your request, click **Send to Cursor**, then in Cursor say **"Do the Figma prompt"** or **"Do it"**. The agent will fetch the prompt and run it in Figma.

   **If the agent doesn’t see Figma tools:** See **[docs/MCP-SETUP.md](docs/MCP-SETUP.md)** — ensure `.cursor/mcp.json` has the correct path and Cursor was restarted after adding it.

## Project Structure

- `plugin/` – Figma plugin **CursorCanvas** (UI: `figma-design-ui.html`, WebSocket client, Figma API)
- `server/` – MCP server (stdio for Cursor, WebSocket for plugin)

## Scripts

- `pnpm run build` – build plugin and server
- `pnpm run test` – same as build (validates both workspaces)
- `pnpm run plugin:build` / `pnpm run server:build` – build one workspace
- `pnpm run dev` – watch plugin only (rebuilds on save; does not start the server, so it never conflicts with Cursor’s MCP)
- `pnpm run dev:standalone` – build server, watch plugin, and run server (use when Cursor is not running the MCP server)

## Environment

- `FIGSOR_PORT` – WebSocket port (default: 3055)

## Troubleshooting: “I can’t ask the AI to make a blue circle”

The AI only gets Figma tools when **Cursor** is talking to the MCP server. If the server is “running” because you ran `pnpm run server:start`, the plugin may be connected to that process, but Cursor might not have started its own MCP server, or it might be using a different process.

1. **Use only the MCP-started server**
   - Remove any separate “run the server” step. In Cursor, the server is started automatically from `mcp.json`.
   - Do **not** run `pnpm run server:start` in a terminal when you want to use “make a blue circle” in chat.
   - Build once: `pnpm run build`. Then in Cursor, open the project and run the Figma plugin. If port 3055 is already in use, the server will try 3057, 3059, etc.; check the MCP log for "Connect plugin to ws://localhost:XXXX" and use that URL in the plugin.

2. **Check MCP in Cursor**
   - Open **Cursor Settings** → search for **MCP** (or **Features** → **MCP**).
   - Confirm the `figma-design` server is listed and **enabled**. You should see tools like `create_ellipse`, `create_rectangle`, `create_frame`, etc.
   - If it’s missing or disabled, fix `~/.cursor/mcp.json` (absolute path, correct `command`/`args`), save, then **restart Cursor** fully (quit and reopen).

3. **One process, one port**
   - Only one server process should be listening on port 3055 — the one Cursor started. If you had `server:start` running, quit it, then start a new Cursor chat and run the Figma plugin again so it connects to Cursor's server.

4. **"EADDRINUSE" when running `pnpm run dev:standalone`**
   - Port 3055 or 3056 is already in use (often because Cursor started the CursorCanvas MCP server). Use **`pnpm run dev`** to only watch and rebuild the plugin; let Cursor start the server. Or stop the other process if you want to run the server yourself.

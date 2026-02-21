# CursorCanvas MCP setup – give the AI agent access to Figma tools

The Cursor **agent** (chat/Composer) only gets Figma tools when it is connected to the **same** MCP server process that the Figma plugin talks to. This doc gets that working.

## 1. Build the server

From the project root:

```bash
pnpm run build
```

So that `server/dist/index.js` exists.

## 2. Configure Cursor to start the MCP server

Cursor must start the server itself via MCP config. Two options:

### Option A: Project-level (recommended for this repo)

There is a **project-level** config at `.cursor/mcp.json` in this repo.

- **Edit** `.cursor/mcp.json` and set the **absolute** path to your machine:

  ```json
  {
    "mcpServers": {
      "figma-design": {
        "command": "node",
        "args": ["/Users/yourusername/figma-design-mcp/server/dist/index.js"]
      }
    }
  }
  ```

- Open this project in Cursor (**File → Open Folder** → this repo). Cursor will load project-level MCP from `.cursor/mcp.json`.
- **Fully quit and restart Cursor** after changing MCP config (required for changes to apply).

### Option B: User-level

Use your user config so the server is available in any project:

- **macOS/Linux:** `~/.cursor/mcp.json` (or sometimes `~/.cursor/config/mcp.json`)
- **Windows:** `%USERPROFILE%\.cursor\mcp.json`

Same content as above, with your absolute path to `server/dist/index.js`.

## 3. Confirm the agent has the tools

1. **Cursor Settings** → search **MCP** (or **Features** → **MCP**).
2. Find **figma-design** in the list and ensure it is **enabled**.
3. You should see tools such as: `create_frame`, `create_ellipse`, `create_rectangle`, `create_text`, `get_selection`, `get_figma_prompt`.

If the server is **disabled** or **missing**:

- Fix the path in `mcp.json` (must be absolute).
- Ensure `server/dist/index.js` exists (`pnpm run build`).
- **Quit Cursor completely** and reopen, then open this project.

## 4. Do not run the server manually when using Cursor

- **Do not** run `pnpm run server:start` (or `node server/dist/index.js`) in a terminal when you want the **agent** to control Figma.
- Cursor starts one MCP server process; that same process listens on `ws://localhost:3055` (or 3057, 3059…) for the plugin. If you run the server yourself, you get two processes and the plugin may connect to the one the agent is **not** using.

Use **`pnpm run dev`** to only watch/rebuild the plugin; let Cursor start the server.

## 5. Connect the Figma plugin to that server

1. In Figma Desktop: **Plugins → Development → Import plugin from manifest** → select `plugin/manifest.json`.
2. Run the **CursorCanvas** plugin.
3. Enter **Server URL:** `ws://localhost:3055` (or the port shown in Cursor’s MCP log: “Connect plugin to ws://localhost:XXXX”).
4. Click **Connect**. Status should show **Connected**.

Now:

- **From Cursor:** Say e.g. “In Figma, create 5 blue circles in an auto container with 12px gap” or “Do the Figma prompt” to run the last prompt sent from the plugin.
- **From Figma:** Type in the plugin, click **Send to Cursor**, then in Cursor say **“Do the Figma prompt”** or **“Do it”**.

The agent will use `get_figma_prompt` and the create_* tools to fulfill the request in Figma.

## Troubleshooting

| Symptom | What to do |
|--------|------------|
| Agent doesn’t have Figma tools | MCP not loaded. Check Settings → MCP; fix path in `.cursor/mcp.json` or `~/.cursor/mcp.json`; restart Cursor. |
| Plugin connects but “Create test frame” is the only thing that works | Plugin is talking to the server, but the **agent** is using a different process (or no MCP). Use only the server Cursor starts; don’t run `server:start`. |
| “Can’t reach server” in plugin | Server not running or wrong URL. Ensure Cursor has started the MCP server (see MCP in Settings), then use the URL from the MCP log (e.g. `ws://localhost:3055`). |
| Port in use (EADDRINUSE) | Another process is using 3055/3056. Quit that process, or use the next port Cursor prints (e.g. 3057) in the plugin. |

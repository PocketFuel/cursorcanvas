# CursorCanvas

Design in Figma from Cursor/Lovable/Codex using MCP tools.

## What CursorCanvas does

- Connects a Figma plugin panel to a local MCP server.
- Lets your agent call Figma tools (`create_frame`, `create_text`, `set_auto_layout`, etc.).
- Lets you send prompts from Figma to your agent with `get_figma_prompt`.
- Includes a polished plugin UI with:
  - Light/Dark theme toggle
  - Prompt templates
  - Quick direct Figma actions
  - Cursor launch helper

## Step-by-step setup

1. **Build project**
   - In this repo: `pnpm run build`

2. **Configure Cursor MCP**
   - Edit `/Users/Hans/figma-design-mcp/.cursor/mcp.json` and make sure this server exists:
   ```json
   {
     "mcpServers": {
       "cursorcanvas": {
         "command": "node",
         "args": ["/Users/Hans/figma-design-mcp/server/dist/index.js"]
       }
     }
   }
   ```
   - Quit Cursor fully, then reopen Cursor and open this repo folder.

3. **Confirm MCP server is enabled in Cursor**
   - Cursor Settings -> MCP
   - Ensure `cursorcanvas` is enabled and tools are visible.

4. **Install plugin in Figma Desktop**
   - Figma -> Plugins -> Development -> Import plugin from manifest
   - Select `/Users/Hans/figma-design-mcp/plugin/manifest.json`

5. **Run CursorCanvas plugin**
   - Figma -> Plugins -> Development -> CursorCanvas
   - Click `Connect`
   - The plugin auto-discovers localhost MCP port pairs (`3055-3080`) if needed.

## Step-by-step usage in the plugin

1. **Connection panel**
   - Connect/disconnect from MCP server.
   - Status chip uses semantic colors:
     - Red = disconnected
     - Green = connected
     - Yellow = connecting

2. **Cursor Agent panel**
   - Optional project path: where Cursor should open.
   - Edit kickoff/training prompt for design behavior.
   - Click `Open Cursor Agent`:
     - queues kickoff prompt into CursorCanvas
     - opens Cursor via `cursor://` URL

3. **Prompt Lab panel**
   - Use template chips to scaffold design prompts.
   - Write your design request.
   - Click `Send to Agent`.
   - In Cursor chat, run: `Do the Figma prompt`.

4. **Quick Tools panel**
   - Run direct actions immediately in Figma:
     - create frame/component/line/polygon/star
     - apply auto-layout to current selection

5. **Theme toggle**
   - Click `Light Mode` / `Dark Mode` in the top bar.
   - Choice is saved locally in the plugin UI.

## End-to-end debug checklist

1. `pnpm run build` succeeds.
2. Cursor MCP shows `cursorcanvas` as enabled.
3. Plugin `Connect` becomes green.
4. Send a prompt from Figma.
5. In Cursor chat run `Do the Figma prompt`.
6. Verify new nodes appear in Figma.

If connection fails:

1. Check local ports: `lsof -nP -iTCP:3055-3080 -sTCP:LISTEN`
2. Restart Cursor completely.
3. Reopen this repo in Cursor.
4. Re-run plugin and click `Connect` again.

## Scripts

- `pnpm run build` - build plugin + server
- `pnpm run plugin:build` - build plugin only
- `pnpm run server:build` - build server only
- `pnpm run dev` - watch plugin changes
- `pnpm run dev:standalone` - run server + plugin watch (without Cursor MCP)

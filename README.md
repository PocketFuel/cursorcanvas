# CursorCanvas

Chat in Figma. Generate designs in Figma.

CursorCanvas is a Figma plugin + local MCP bridge that lets you design by chatting directly in the plugin UI.

## What changed (new UX)

- Chat-first plugin UI (single workflow in Figma)
- Provider selector:
  - `CursorCanvas Local (No credits)` - built-in local agent, no external API key
  - `Codex / OpenAI` - uses OpenAI Responses API with tool calling
  - `Cursor` / `Lovable` placeholders for upcoming connectors
- Theme toggle (light/dark)
- Auto-discovery of active localhost MCP port pairs

## Quick start

1. Build:
```bash
pnpm run build
```

2. Configure Cursor MCP (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "cursorcanvas": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/CursorCanvas/server/dist/index.js"]
    }
  }
}
```

3. Restart Cursor fully and open this repo.

4. In Figma Desktop:
- Plugins -> Development -> Import plugin from manifest
- Choose `plugin/manifest.json` from this repo
- Run plugin `CursorCanvas`

5. In plugin:
- Click `Connect`
- Choose provider
- Chat in the message box

## Provider behavior

- `CursorCanvas Local`: executes common design intents directly through local tool plans.
- `Codex / OpenAI`: requires `OPENAI_API_KEY` (env) or key entered in plugin UI.
- `Cursor` and `Lovable`: currently show “coming soon”.

## Scripts

- `pnpm run build` - build plugin + server
- `pnpm run plugin:build` - build plugin
- `pnpm run server:build` - build server
- `pnpm run dev` - watch plugin only
- `pnpm run dev:standalone` - run server + plugin watch

## Troubleshooting

- If plugin cannot connect:
```bash
lsof -nP -iTCP:3055-3080 -sTCP:LISTEN
```
- Keep only one active server for the same ports when debugging.
- Plugin auto-scans local ports, so clicking `Connect` again usually resolves stale URLs.

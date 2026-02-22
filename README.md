# CursorCanvas

Chat in Figma. Generate designs in Figma.

CursorCanvas is a Figma plugin + local MCP bridge that lets you design by chatting directly in the plugin UI.

## What changed (new UX)

- Page-based plugin UI with vertical tabs:
  - `Chat`
  - `Research`
  - `Library`
- Provider selector:
  - `CursorCanvas Local (No credits)` - built-in local agent, no external API key
  - `Codex / OpenAI` - uses OpenAI Responses API with tool calling
  - `Cursor` / `Lovable` placeholders for upcoming connectors
- Theme toggle (light/dark)
- Auto-discovery of active localhost MCP port pairs
- No design preview panel in plugin (Figma canvas is the preview)
- Library page includes:
  - predefined component templates
  - typography style buttons (H1-H6, body, UI text) grouped by vertical tabs

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
- Use pages:
  - `Research`: save research brief + design profile/personalization
  - `Library`: insert templates and text styles
  - `Chat`: run generation with your selected provider

## New workflow

1. Open `Research` page and paste planning/research output.
2. Keep or edit the default design profile (senior designer + shadcn + A/B/C variants).
3. Open `Library` page and insert baseline structures (hero, nav, cards, type styles).
4. Open `Chat`, choose provider, and prompt generation/refinement.
5. Review directly on the Figma canvas, then iterate.

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

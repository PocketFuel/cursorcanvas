# Design tokens (shadcn-style)

Use these tokens when building UI in Figma via the MCP tools so designs stay consistent. All **RGB values are 0–1** for use with `fillR`, `fillG`, `fillB` in `create_rectangle`, `create_ellipse`, and `create_text`.

## Colors

### Primary (blue — buttons, links, emphasis)
- **Primary:** `fillR: 0.231, fillG: 0.51, fillB: 0.965` (hex #3b82f6)
- **Primary foreground (text on primary):** `0.98, 0.98, 1`

### Neutrals (zinc)
- **Background:** `0.98, 0.98, 0.98` (zinc-50) or dark `0.055, 0.055, 0.106` (zinc-950)
- **Foreground:** `0.055, 0.055, 0.106` (zinc-950) or dark `0.98, 0.98, 0.98`
- **Muted (subtle backgrounds):** `0.957, 0.957, 0.961` (zinc-100)
- **Muted foreground (secondary text):** `0.443, 0.443, 0.478` (zinc-500)
- **Border:** `0.894, 0.894, 0.906` (zinc-200)
- **Input / ring:** `0.894, 0.894, 0.906` (zinc-200)

### Semantic
- **Destructive:** `0.937, 0.267, 0.267` (red-500, #ef4444)
- **Destructive foreground:** `1, 1, 1`
- **Card:** same as background or `1, 1, 1` with border
- **Accent (hover states):** `0.957, 0.957, 0.961` (zinc-100)

### Common UI
- **Blue (e.g. “blue square”):** `0.231, 0.51, 0.965` (primary blue)
- **White:** `1, 1, 1`
- **Black:** `0, 0, 0`

## Typography

- **Font family:** Inter (default), or use system sans e.g. Inter.
- **Scale (px):** 12 (caption), 14 (body), 16 (body default), 18 (lead), 20 (large), 24 (h3), 30 (h2), 36–72 (h1).
- **Weights:** Regular (400), Medium (500), Semibold (600), Bold (700). Use `fontStyle: "Regular"` etc. as supported by the font.

## Spacing and radius

- **Border radius (px):** 4 (sm), 6 (default, 0.375rem), 8 (md), 12 (lg), 16 (xl), 9999 (full/pill).
- **Padding (px):** 8, 16, 24, 32.
- **Gap (auto-layout):** 8, 12, 16, 24.

Reference: shadcn/ui theming, Tailwind zinc/blue palettes. Use these values in Figma MCP tool calls for consistent, high-quality UI.

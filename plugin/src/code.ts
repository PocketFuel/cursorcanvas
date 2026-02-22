/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 460, height: 820, themeColors: true });

interface CommandMessage {
  type: "command";
  id: string;
  tool: string;
  params: Record<string, unknown>;
}

type AutoLayoutNode = FrameNode | ComponentNode;
type FillableNode = SceneNode & {
  fills: ReadonlyArray<Paint> | PluginAPI["mixed"];
};

figma.ui.onmessage = async (msg: CommandMessage) => {
  if (msg.type !== "command") return;

  const { id, tool, params } = msg;

  try {
    const result = await handleCommand(tool, params);
    figma.ui.postMessage({ type: "result", id, result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    figma.ui.postMessage({ type: "error", id, error });
  }
};

function numberParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

function booleanParam(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  return typeof value === "boolean" ? value : undefined;
}

function enumParam<T extends string>(
  params: Record<string, unknown>,
  key: string,
  validValues: readonly T[]
): T | undefined {
  const value = params[key];
  if (typeof value !== "string") return undefined;
  return (validValues as readonly string[]).includes(value) ? (value as T) : undefined;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function colorParam(
  params: Record<string, unknown>,
  rKey: string,
  gKey: string,
  bKey: string
): RGB | null {
  const r = numberParam(params, rKey);
  const g = numberParam(params, gKey);
  const b = numberParam(params, bKey);
  if (r == null || g == null || b == null) return null;
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

function isSceneNode(node: BaseNode | null): node is SceneNode {
  return node != null && "type" in node && "visible" in node;
}

function isParentNode(node: BaseNode | null): node is BaseNode & ChildrenMixin {
  return node != null && "appendChild" in node;
}

function isAutoLayoutNode(node: BaseNode | null): node is AutoLayoutNode {
  return node != null && (node.type === "FRAME" || node.type === "COMPONENT");
}

function isFillableNode(node: BaseNode | null): node is FillableNode {
  return node != null && "fills" in node;
}

function isCornerRadiusNode(node: BaseNode | null): node is SceneNode & { cornerRadius: number } {
  return node != null && "cornerRadius" in node;
}

function pickParent(): BaseNode & ChildrenMixin {
  const sel = figma.currentPage.selection;
  if (sel.length === 1 && isParentNode(sel[0])) {
    return sel[0] as BaseNode & ChildrenMixin;
  }
  if (sel.length > 0 && isParentNode(sel[0].parent)) {
    return sel[0].parent as BaseNode & ChildrenMixin;
  }
  return figma.currentPage;
}

function resolveParentNode(params: Record<string, unknown>): BaseNode & ChildrenMixin {
  const parentId = stringParam(params, "parentId");
  if (parentId) {
    const target = figma.getNodeById(parentId);
    if (!isParentNode(target)) {
      throw new Error(`Invalid parentId: ${parentId}`);
    }
    return target;
  }
  return pickParent();
}

function appendAndFocus<T extends SceneNode>(node: T, params: Record<string, unknown>): T {
  const parent = resolveParentNode(params);
  parent.appendChild(node);
  const shouldSelect = booleanParam(params, "select") ?? true;
  if (shouldSelect) {
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
  }
  return node;
}

function resolveTargetNode(params: Record<string, unknown>): SceneNode {
  const nodeId = stringParam(params, "nodeId");
  if (nodeId) {
    const node = figma.getNodeById(nodeId);
    if (isSceneNode(node)) return node;
    throw new Error(`Node not found for id ${nodeId}`);
  }
  const selected = figma.currentPage.selection[0];
  if (!selected) {
    throw new Error("Select a node or provide nodeId.");
  }
  return selected;
}

function setNodeFill(node: FillableNode, color: RGB, opacity = 1): void {
  node.fills = [
    {
      type: "SOLID",
      color,
      opacity: clamp01(opacity),
    },
  ];
}

function applyAutoLayoutSettings(node: AutoLayoutNode, params: Record<string, unknown>): void {
  const layoutMode = enumParam(params, "layoutMode", ["NONE", "HORIZONTAL", "VERTICAL"] as const);
  if (layoutMode) node.layoutMode = layoutMode;

  const itemSpacing = numberParam(params, "itemSpacing");
  if (itemSpacing != null) node.itemSpacing = itemSpacing;

  const paddingTop = numberParam(params, "paddingTop");
  const paddingRight = numberParam(params, "paddingRight");
  const paddingBottom = numberParam(params, "paddingBottom");
  const paddingLeft = numberParam(params, "paddingLeft");
  if (paddingTop != null) node.paddingTop = paddingTop;
  if (paddingRight != null) node.paddingRight = paddingRight;
  if (paddingBottom != null) node.paddingBottom = paddingBottom;
  if (paddingLeft != null) node.paddingLeft = paddingLeft;

  const primaryAxisAlignItems = enumParam(
    params,
    "primaryAxisAlignItems",
    ["MIN", "CENTER", "MAX", "SPACE_BETWEEN"] as const
  );
  if (primaryAxisAlignItems) node.primaryAxisAlignItems = primaryAxisAlignItems;

  const counterAxisAlignItems = enumParam(
    params,
    "counterAxisAlignItems",
    ["MIN", "CENTER", "MAX", "BASELINE"] as const
  );
  if (counterAxisAlignItems) node.counterAxisAlignItems = counterAxisAlignItems;

  const primaryAxisSizingMode = enumParam(params, "primaryAxisSizingMode", ["FIXED", "AUTO"] as const);
  if (primaryAxisSizingMode) node.primaryAxisSizingMode = primaryAxisSizingMode;

  const counterAxisSizingMode = enumParam(params, "counterAxisSizingMode", ["FIXED", "AUTO"] as const);
  if (counterAxisSizingMode) node.counterAxisSizingMode = counterAxisSizingMode;
}

type CanvasPreset = "desktop" | "tablet" | "mobile" | "letter" | "presentation";

function getCanvasPreset(
  raw: string | undefined
): { key: CanvasPreset; label: string; width: number; height: number } {
  const preset = raw === "tablet" || raw === "mobile" || raw === "letter" || raw === "presentation"
    ? raw
    : "desktop";

  switch (preset) {
    case "mobile":
      return { key: "mobile", label: "Mobile", width: 390, height: 844 };
    case "tablet":
      return { key: "tablet", label: "Tablet", width: 834, height: 1194 };
    case "letter":
      return { key: "letter", label: "Letter 8.5x11", width: 816, height: 1056 };
    case "presentation":
      return { key: "presentation", label: "Presentation", width: 1366, height: 768 };
    case "desktop":
    default:
      return { key: "desktop", label: "Desktop", width: 1440, height: 1024 };
  }
}

function applyMainCanvasLayout(frame: FrameNode): void {
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "FIXED";
  frame.counterAxisSizingMode = "FIXED";
  frame.primaryAxisAlignItems = "MIN";
  frame.counterAxisAlignItems = "MIN";
  frame.itemSpacing = 24;
  frame.paddingTop = 32;
  frame.paddingRight = 32;
  frame.paddingBottom = 32;
  frame.paddingLeft = 32;
  frame.clipsContent = false;
}

async function handleCommand(
  tool: string,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (tool) {
    case "ensure_canvas_frame": {
      const preset = getCanvasPreset(stringParam(params, "preset"));
      const requestedName = stringParam(params, "name") ?? `${preset.label} Canvas`;
      const forcePreset = booleanParam(params, "forcePreset") ?? false;
      const frameId = stringParam(params, "frameId");
      const useSelectedFrame = booleanParam(params, "useSelectedFrame") ?? false;

      let frame: FrameNode | null = null;
      let created = false;

      if (frameId) {
        const existing = figma.getNodeById(frameId);
        if (existing?.type === "FRAME") {
          frame = existing;
        }
      }

      if (!frame && useSelectedFrame) {
        const selected = figma.currentPage.selection[0];
        if (selected?.type === "FRAME") {
          frame = selected;
        }
      }

      if (!frame) {
        frame = figma.createFrame();
        frame.name = requestedName;
        frame.resize(preset.width, preset.height);
        const viewport = figma.viewport.center;
        frame.x = viewport.x - preset.width / 2;
        frame.y = viewport.y - preset.height / 2;
        figma.currentPage.appendChild(frame);
        created = true;
      }

      if (created || forcePreset) {
        frame.resize(preset.width, preset.height);
      }

      frame.name = requestedName;
      applyMainCanvasLayout(frame);
      figma.currentPage.selection = [frame];
      figma.viewport.scrollAndZoomIntoView([frame]);
      return {
        id: frame.id,
        name: frame.name,
        preset: preset.key,
        width: frame.width,
        height: frame.height,
        created,
      };
    }

    case "create_frame": {
      const frame = figma.createFrame();
      frame.name = stringParam(params, "name") ?? "Frame";
      frame.x = numberParam(params, "x") ?? 0;
      frame.y = numberParam(params, "y") ?? 0;
      frame.resize(numberParam(params, "width") ?? 100, numberParam(params, "height") ?? 100);

      const fill = colorParam(params, "fillR", "fillG", "fillB");
      if (fill) {
        const opacity = numberParam(params, "fillOpacity") ?? 1;
        setNodeFill(frame, fill, opacity);
      }

      const cornerRadius = numberParam(params, "cornerRadius");
      if (cornerRadius != null) frame.cornerRadius = cornerRadius;

      applyAutoLayoutSettings(frame, params);
      appendAndFocus(frame, params);
      return { id: frame.id, name: frame.name };
    }

    case "create_component": {
      const component = figma.createComponent();
      component.name = stringParam(params, "name") ?? "Component";
      component.x = numberParam(params, "x") ?? 0;
      component.y = numberParam(params, "y") ?? 0;
      component.resize(numberParam(params, "width") ?? 160, numberParam(params, "height") ?? 64);

      const fill = colorParam(params, "fillR", "fillG", "fillB");
      if (fill) {
        const opacity = numberParam(params, "fillOpacity") ?? 1;
        setNodeFill(component, fill, opacity);
      }

      const cornerRadius = numberParam(params, "cornerRadius");
      if (cornerRadius != null) component.cornerRadius = cornerRadius;

      applyAutoLayoutSettings(component, params);
      appendAndFocus(component, params);
      return { id: component.id, name: component.name };
    }

    case "create_text": {
      let fontFamily = stringParam(params, "fontFamily") ?? "Inter";
      let fontStyle = stringParam(params, "fontStyle") ?? "Regular";
      try {
        await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
      } catch {
        fontFamily = "Inter";
        fontStyle = "Regular";
        await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
      }

      const text = figma.createText();
      text.fontName = { family: fontFamily, style: fontStyle };
      text.characters = stringParam(params, "text") ?? "Text";
      text.fontSize = numberParam(params, "fontSize") ?? 16;
      text.x = numberParam(params, "x") ?? 0;
      text.y = numberParam(params, "y") ?? 0;

      const fill = colorParam(params, "fillR", "fillG", "fillB");
      if (fill) {
        const opacity = numberParam(params, "fillOpacity") ?? 1;
        setNodeFill(text, fill, opacity);
      }

      appendAndFocus(text, params);
      return { id: text.id, characters: text.characters };
    }

    case "create_rectangle": {
      const rect = figma.createRectangle();
      rect.name = stringParam(params, "name") ?? "Rectangle";
      rect.resize(numberParam(params, "width") ?? 100, numberParam(params, "height") ?? 100);
      rect.x = numberParam(params, "x") ?? 0;
      rect.y = numberParam(params, "y") ?? 0;

      const fill = colorParam(params, "fillR", "fillG", "fillB");
      if (fill) {
        const opacity = numberParam(params, "fillOpacity") ?? 1;
        setNodeFill(rect, fill, opacity);
      }

      const cornerRadius = numberParam(params, "cornerRadius");
      if (cornerRadius != null) rect.cornerRadius = cornerRadius;

      appendAndFocus(rect, params);
      return { id: rect.id, name: rect.name };
    }

    case "create_ellipse": {
      const ellipse = figma.createEllipse();
      ellipse.name = stringParam(params, "name") ?? "Ellipse";
      ellipse.resize(numberParam(params, "width") ?? 100, numberParam(params, "height") ?? 100);
      ellipse.x = numberParam(params, "x") ?? 0;
      ellipse.y = numberParam(params, "y") ?? 0;

      const fill = colorParam(params, "fillR", "fillG", "fillB");
      if (fill) {
        const opacity = numberParam(params, "fillOpacity") ?? 1;
        setNodeFill(ellipse, fill, opacity);
      }

      appendAndFocus(ellipse, params);
      return { id: ellipse.id, name: ellipse.name };
    }

    case "create_line": {
      const line = figma.createLine();
      line.name = stringParam(params, "name") ?? "Line";
      const length = numberParam(params, "length") ?? 120;
      line.resize(length, 0);
      line.x = numberParam(params, "x") ?? 0;
      line.y = numberParam(params, "y") ?? 0;

      const stroke = colorParam(params, "strokeR", "strokeG", "strokeB");
      if (stroke) {
        line.strokes = [{ type: "SOLID", color: stroke, opacity: clamp01(numberParam(params, "strokeOpacity") ?? 1) }];
      }
      const strokeWeight = numberParam(params, "strokeWeight");
      if (strokeWeight != null) line.strokeWeight = strokeWeight;

      const rotation = numberParam(params, "rotation");
      if (rotation != null) line.rotation = rotation;

      appendAndFocus(line, params);
      return { id: line.id, name: line.name };
    }

    case "create_polygon": {
      const polygon = figma.createPolygon();
      polygon.name = stringParam(params, "name") ?? "Polygon";
      const sides = numberParam(params, "sides");
      if (sides != null) polygon.pointCount = clampInt(sides, 3, 60);

      const width = numberParam(params, "width");
      const height = numberParam(params, "height");
      const radius = numberParam(params, "radius");
      if (width != null || height != null) {
        polygon.resize(width ?? (height ?? 100), height ?? (width ?? 100));
      } else if (radius != null) {
        const size = Math.max(1, radius * 2);
        polygon.resize(size, size);
      } else {
        polygon.resize(100, 100);
      }

      polygon.x = numberParam(params, "x") ?? 0;
      polygon.y = numberParam(params, "y") ?? 0;

      const fill = colorParam(params, "fillR", "fillG", "fillB");
      if (fill) {
        const opacity = numberParam(params, "fillOpacity") ?? 1;
        setNodeFill(polygon, fill, opacity);
      }

      appendAndFocus(polygon, params);
      return { id: polygon.id, name: polygon.name, sides: polygon.pointCount };
    }

    case "create_star": {
      const star = figma.createStar();
      star.name = stringParam(params, "name") ?? "Star";
      const points = numberParam(params, "points");
      if (points != null) star.pointCount = clampInt(points, 3, 60);

      const width = numberParam(params, "width");
      const height = numberParam(params, "height");
      const radius = numberParam(params, "radius");
      if (width != null || height != null) {
        star.resize(width ?? (height ?? 100), height ?? (width ?? 100));
      } else if (radius != null) {
        const size = Math.max(1, radius * 2);
        star.resize(size, size);
      } else {
        star.resize(100, 100);
      }

      star.x = numberParam(params, "x") ?? 0;
      star.y = numberParam(params, "y") ?? 0;

      const fill = colorParam(params, "fillR", "fillG", "fillB");
      if (fill) {
        const opacity = numberParam(params, "fillOpacity") ?? 1;
        setNodeFill(star, fill, opacity);
      }

      appendAndFocus(star, params);
      return { id: star.id, name: star.name, points: star.pointCount };
    }

    case "set_auto_layout": {
      const node = resolveTargetNode(params);
      if (!isAutoLayoutNode(node)) {
        throw new Error("Target node must be a frame or component for auto-layout.");
      }
      applyAutoLayoutSettings(node, params);
      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);
      return { id: node.id, name: node.name, layoutMode: node.layoutMode };
    }

    case "set_fill_color": {
      const node = resolveTargetNode(params);
      if (!isFillableNode(node)) {
        throw new Error("Target node does not support fill color.");
      }
      const fill = colorParam(params, "fillR", "fillG", "fillB");
      if (!fill) throw new Error("fillR, fillG, and fillB are required.");
      const opacity = numberParam(params, "fillOpacity") ?? 1;
      setNodeFill(node, fill, opacity);
      figma.currentPage.selection = [node];
      return { id: node.id, name: node.name };
    }

    case "set_corner_radius": {
      const node = resolveTargetNode(params);
      if (!isCornerRadiusNode(node)) {
        throw new Error("Target node does not support corner radius.");
      }
      const radius = numberParam(params, "cornerRadius");
      if (radius == null) throw new Error("cornerRadius is required.");
      node.cornerRadius = radius;
      figma.currentPage.selection = [node];
      return { id: node.id, name: node.name, cornerRadius: node.cornerRadius };
    }

    case "get_selection": {
      const selection = figma.currentPage.selection;
      return {
        nodes: selection.map((node) => ({
          id: node.id,
          name: node.name,
          type: node.type,
          x: node.x,
          y: node.y,
          width: "width" in node ? node.width : undefined,
          height: "height" in node ? node.height : undefined,
        })),
      };
    }

    case "open_external_url": {
      const url = stringParam(params, "url");
      if (!url) {
        throw new Error("url is required.");
      }
      await figma.openExternal(url);
      return { ok: true, url };
    }

    case "resize_ui": {
      const requestedWidth = numberParam(params, "width") ?? 460;
      const requestedHeight = numberParam(params, "height") ?? 820;
      const width = Math.round(Math.max(320, Math.min(920, requestedWidth)));
      const height = Math.round(Math.max(520, Math.min(1640, requestedHeight)));
      figma.ui.resize(width, height);
      return { width, height };
    }

    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

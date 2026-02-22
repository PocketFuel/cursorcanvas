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
  if (sel.length === 1 && "appendChild" in sel[0]) {
    return sel[0] as BaseNode & ChildrenMixin;
  }
  if (sel.length > 0 && sel[0].parent && "appendChild" in sel[0].parent) {
    return sel[0].parent as BaseNode & ChildrenMixin;
  }
  return figma.currentPage;
}

function appendAndFocus<T extends SceneNode>(node: T): T {
  pickParent().appendChild(node);
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
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

async function handleCommand(
  tool: string,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (tool) {
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
      appendAndFocus(frame);
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
      appendAndFocus(component);
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

      appendAndFocus(text);
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

      appendAndFocus(rect);
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

      appendAndFocus(ellipse);
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

      appendAndFocus(line);
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

      appendAndFocus(polygon);
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

      appendAndFocus(star);
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

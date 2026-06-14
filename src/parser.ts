import { unzipSync, strFromU8 } from "fflate";
import type { Artboard, Layer, Paint, ParsedDocument, Warning } from "./types";

const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_ENTRIES = 5000;

type Json = Record<string, unknown>;
type Archive = Record<string, Uint8Array>;

const object = (value: unknown): Json => (value && typeof value === "object" ? value as Json : {});
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
const number = (value: unknown, fallback = 0): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;

function color(value: unknown, fallback = "transparent"): string {
  if (typeof value === "string") return value;
  const c = object(value);
  if (typeof c.value === "string") return c.value;
  if (c.value && typeof c.value === "object") {
    const nested = object(c.value);
    const r = number(nested.r ?? nested.red, 0);
    const g = number(nested.g ?? nested.green, 0);
    const b = number(nested.b ?? nested.blue, 0);
    const a = number(c.alpha ?? nested.a ?? nested.alpha, 1);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (c.color && c.color !== value) return color(c.color, fallback);
  const r = number(c.r ?? c.red, 0);
  const g = number(c.g ?? c.green, 0);
  const b = number(c.b ?? c.blue, 0);
  const a = number(c.a ?? c.alpha, 1);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function childNodes(node: Json): unknown[] {
  const shape = object(node.shape);
  return array(node.children ?? node.layers ?? object(node.group).children ?? (shape.path ? undefined : shape.children));
}

function bounds(node: Json): { x: number; y: number; width: number; height: number } {
  const shape = object(node.shape);
  const b = object(node.bounds ?? node.frame ?? node.globalBounds ?? shape);
  const transform = object(node.transform);
  const rx = number(shape.rx);
  const ry = number(shape.ry);
  return {
    x: number(transform.tx ?? transform.x ?? b.x ?? node.x),
    y: number(transform.ty ?? transform.y ?? b.y ?? node.y),
    width: number(b.width ?? b.w ?? node.width, rx * 2),
    height: number(b.height ?? b.h ?? node.height, ry * 2),
  };
}

function paint(value: unknown): Paint | undefined {
  if (!value) return undefined;
  const p = object(value);
  const type = string(p.type).toLowerCase();
  if (type === "none") return undefined;
  if (type === "pattern") {
    const pattern = object(p.pattern);
    const uid = string(object(object(pattern.meta).ux).uid);
    return uid ? { type: "pattern", asset: uid } : undefined;
  }
  const gradient = object(p.gradient);
  const gradientResources = object(object(object(gradient.meta).ux).gradientResources);
  const stops = array(p.stops ?? p.colorStops ?? gradient.stops ?? gradientResources.stops);
  if (type.includes("gradient") && stops.length) {
    const normalizedStops = stops.map((stop) => {
      const s = object(stop);
      return { offset: number(s.offset ?? s.position), color: color(s.color ?? s) };
    });
    if (string(gradientResources.type).toLowerCase() === "radial") {
      return {
        type: "radial-gradient",
        cx: number(gradient.cx, 0.5),
        cy: number(gradient.cy, 0.5),
        r: number(gradient.r, 0.5),
        stops: normalizedStops,
      };
    }
    return {
      type: "linear-gradient",
      angle: number(p.angle ?? gradient.angle),
      stops: normalizedStops,
    };
  }
  return { type: "solid", color: color(p.color ?? p.value ?? value) };
}

function inferType(node: Json): Layer["type"] {
  const shape = object(node.shape);
  const raw = string(shape.type ?? node.type ?? node.kind ?? node.shape).toLowerCase();
  if (raw.includes("artboard")) return "group";
  if (raw.includes("group") || raw.includes("container")) return "group";
  if (raw.includes("rect")) return "rect";
  if (raw.includes("ellipse") || raw.includes("circle")) return "ellipse";
  if (raw.includes("path") || raw.includes("line") || raw.includes("compound") || shape.path || node.path || node.pathData) return "path";
  if (raw.includes("text") || node.text || node.content) return "text";
  if (raw.includes("image") || node.image || node.href) return "image";
  if (childNodes(node).length) return "group";
  return "unknown";
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  const root = object(value);
  if (typeof root.rawText === "string") return root.rawText;
  const paragraphs = array(root.paragraphs);
  if (!paragraphs.length) return string(root.text ?? root.value);
  return paragraphs.map((paragraph) => {
    const p = object(paragraph);
    const lines = array(p.lines);
    return lines.map((line) => {
      const spans = Array.isArray(line) ? line : array(object(line).spans);
      return spans.map((span) => string(object(span).text ?? span)).join("");
    }).join("\n");
  }).join("\n");
}

function textLines(value: unknown, fallbackSize: number): Array<{ text: string; x: number; y: number; fontSize?: number }> | undefined {
  const root = object(value);
  const rawText = string(root.rawText ?? root.text ?? root.value);
  const paragraphs = array(root.paragraphs);
  if (!rawText || !paragraphs.length) return undefined;
  const lines: Array<{ text: string; x: number; y: number; fontSize?: number }> = [];
  for (const paragraph of paragraphs) {
    for (const lineValue of array(object(paragraph).lines)) {
      const spans = Array.isArray(lineValue) ? lineValue : array(object(lineValue).spans);
      const first = object(spans[0]);
      if (!spans.length) continue;
      const from = Math.min(...spans.map((span) => number(object(span).from)));
      const to = Math.max(...spans.map((span) => number(object(span).to, from)));
      if (to <= from) continue;
      const lineText = rawText.slice(from, to);
      const lineFont = object(object(first.style).font);
      lines.push({
        text: lineText,
        x: number(first.x),
        y: number(first.y),
        fontSize: number(lineFont.size, fallbackSize),
      });
    }
  }
  return lines.length ? lines : undefined;
}

type ResourceIndex = Map<string, Json>;

function mergeSyncRef(node: Json, resources: ResourceIndex): Json {
  if (string(node.type) !== "syncRef") return node;
  const source = resources.get(string(node.syncSourceGuid));
  if (!source) return node;
  const sourceGroup = object(source.group);
  const sourceShape = object(source.shape);
  const instanceGroup = object(node.group);
  const instanceShape = object(node.shape);
  return {
    ...source,
    ...node,
    type: source.type,
    name: node.name ?? source.name,
    style: node.style ?? source.style,
    transform: node.transform ?? source.transform,
    group: Object.keys(instanceGroup).length ? { ...sourceGroup, ...instanceGroup } : source.group,
    shape: Object.keys(instanceShape).length ? { ...sourceShape, ...instanceShape } : source.shape,
  };
}

function normalizeLayer(
  nodeValue: unknown,
  warnings: Warning[],
  index: number,
  offset = { x: 0, y: 0 },
  resources: ResourceIndex = new Map(),
): Layer {
  const original = object(nodeValue);
  const node = mergeSyncRef(original, resources);
  const b = bounds(node);
  const style = object(node.style);
  const shape = object(node.shape);
  const pattern = object(object(style.fill).pattern);
  const patternMeta = object(object(pattern.meta).ux);
  const textStyle = object(node.textStyle ?? style.text ?? style.font);
  const fontSize = number(textStyle.fontSize ?? textStyle.size ?? node.fontSize, 16);
  const type = inferType(node);
  const name = string(node.name, `${type} ${index + 1}`);
  if (type === "unknown") {
    warnings.push({ code: "unsupported-layer", message: "An unsupported layer was skipped.", layer: name });
  }
  const children = childNodes(node).map((child, childIndex) => normalizeLayer(child, warnings, childIndex, { x: 0, y: 0 }, resources));
  const stroke = object(style.stroke ?? node.stroke);
  const hasStroke = Boolean(style.stroke || node.stroke) && string(stroke.type).toLowerCase() !== "none";
  const transform = object(node.transform);
  return {
    id: string(node.id ?? node.guid, `${type}-${index}`),
    name,
    type,
    ...b,
    x: b.x + offset.x,
    y: b.y + offset.y,
    opacity: number(style.opacity ?? node.opacity, 1),
    visible: node.visible !== false && node.hidden !== true,
    blendMode: string(style.blendMode ?? node.blendMode) || undefined,
    rotation: number(node.rotation ?? object(node.transform).rotation) || undefined,
    matrix: transform.a !== undefined || transform.b !== undefined || transform.c !== undefined || transform.d !== undefined
      ? { a: number(transform.a, 1), b: number(transform.b), c: number(transform.c), d: number(transform.d, 1) }
      : undefined,
    fill: paint(style.fill ?? node.fill),
    stroke: hasStroke ? color(stroke.color ?? style.stroke ?? node.stroke) : undefined,
    strokeWidth: hasStroke ? number(stroke.width ?? style.strokeWidth ?? node.strokeWidth) || undefined : undefined,
    radius: number(shape.radius ?? shape.cornerRadius ?? node.radius ?? node.cornerRadius ?? style.cornerRadius) || undefined,
    path: string(shape.path ?? shape.pathData ?? node.path ?? node.pathData ?? node.d) || undefined,
    text: textContent(node.text ?? node.content ?? node.value) || undefined,
    textLines: textLines(node.text ?? node.content ?? node.value, fontSize),
    fontSize,
    fontFamily: string(textStyle.fontFamily ?? textStyle.family ?? node.fontFamily, "Arial"),
    fontWeight: string(textStyle.fontWeight ?? textStyle.style ?? node.fontWeight, "400"),
    textColor: color(textStyle.color ?? style.fill ?? node.fill, "#111111"),
    imageAsset: string(node.image ?? node.href ?? node.resource ?? patternMeta.uid ?? pattern.href ?? object(style.fill).href ?? object(style.fill).ref) || undefined,
    children: children.length ? children : undefined,
  };
}

function parseJsonEntry(archive: Archive, name: string): Json | undefined {
  try {
    return object(JSON.parse(strFromU8(archive[name])));
  } catch {
    return undefined;
  }
}

function collectArtboardNodes(root: Json): unknown[] {
  const direct = childNodes(root);
  const explicit = direct.filter((entry) => string(object(entry).type).toLowerCase().includes("artboard"));
  if (explicit.length) return explicit;
  const resources = object(root.resources);
  const resourceArtboards = array(resources.artboards);
  return resourceArtboards.length ? resourceArtboards : direct;
}

type ManifestArtboard = { id: string; path: string; name: string; bounds: { x: number; y: number; width: number; height: number } };

function manifestArtboards(manifest: Json): ManifestArtboard[] {
  const found: ManifestArtboard[] = [];
  const visit = (value: unknown) => {
    const node = object(value);
    const path = string(node.path);
    if (path.startsWith("artboard-")) {
      const b = object(node["uxdesign#bounds"]);
      found.push({
        id: path.replace(/^artboard-/, ""),
        path,
        name: string(node.name, path),
        bounds: { x: number(b.x), y: number(b.y), width: number(b.width, 375), height: number(b.height, 812) },
      });
    }
    array(node.children).forEach(visit);
  };
  visit(manifest);
  return found;
}

function normalizeArtboard(value: unknown, warnings: Warning[], index: number, info?: ManifestArtboard, resources: ResourceIndex = new Map()): Artboard {
  const node = object(value);
  const artboard = object(node.artboard);
  const artboardOwnsLayers = childNodes(artboard).length > 0;
  const b = bounds(Object.keys(artboard).length ? { ...node, ...artboard } : node);
  const viewport = object(node.viewportHeight ? node : artboard);
  const width = info?.bounds.width || b.width || number(viewport.width, 375);
  const height = info?.bounds.height || b.height || number(viewport.height ?? viewport.viewportHeight, 812);
  const origin = info?.bounds ?? { x: 0, y: 0 };
  const layers = childNodes(artboardOwnsLayers ? artboard : node);
  return {
    id: string(node.id ?? node.guid, `artboard-${index}`),
    name: info?.name ?? string(node.name ?? artboard.name, `Artboard ${index + 1}`),
    x: origin.x || b.x,
    y: origin.y || b.y,
    width,
    height,
    background: color(node.background ?? object(node.style).fill, "#ffffff"),
    layers: layers.map((layer, layerIndex) => normalizeLayer(layer, warnings, layerIndex, { x: -origin.x, y: -origin.y }, resources)),
  };
}

function indexResources(root: Json | undefined): ResourceIndex {
  const index: ResourceIndex = new Map();
  const seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const node = object(value);
    const id = string(node.id);
    if (id) index.set(id, node);
    Object.values(node).forEach((child) => {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    });
  };
  visit(root);
  return index;
}

function imageMime(bytes: Uint8Array, name: string): string | undefined {
  if (/\.svg$/i.test(name) || strFromU8(bytes.subarray(0, 100)).includes("<svg")) return "image/svg+xml";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (strFromU8(bytes.subarray(0, 4)) === "GIF8") return "image/gif";
  if (strFromU8(bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return undefined;
}

function extractAssets(archive: Archive, warnings: Warning[]): Record<string, string> {
  const assets: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(archive)) {
    const mime = imageMime(bytes, name);
    if (!mime) continue;
    try {
      const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
      assets[name] = `data:${mime};base64,${btoa(binary)}`;
      assets[name.split("/").pop() ?? name] = assets[name];
    } catch {
      warnings.push({ code: "asset-error", message: `Could not decode image asset ${name}.` });
    }
  }
  return assets;
}

export function parseXdBuffer(buffer: ArrayBuffer, fileName = "Untitled.xd"): ParsedDocument {
  if (buffer.byteLength > MAX_ARCHIVE_BYTES) throw new Error("The XD file is larger than the 200 MB safety limit.");
  let archive: Archive;
  let totalOriginalSize = 0;
  let entryCount = 0;
  try {
    archive = unzipSync(new Uint8Array(buffer), {
      filter: (entry) => {
        entryCount += 1;
        totalOriginalSize += entry.originalSize;
        if (entryCount > MAX_ENTRIES) throw new Error("The XD file contains too many archive entries.");
        if (entry.originalSize > MAX_ENTRY_BYTES) throw new Error("The XD file contains an entry larger than the 50 MB safety limit.");
        if (totalOriginalSize > MAX_ARCHIVE_BYTES) throw new Error("The expanded XD file is larger than the 200 MB safety limit.");
        return /(^|\/)manifest$/i.test(entry.name) || /\.(agc|json|png|jpe?g|gif|webp|svg)$/i.test(entry.name) ||
          /^resources\/[^/]+$/i.test(entry.name);
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("safety limit")) throw error;
    if (error instanceof Error && error.message.includes("too many archive entries")) throw error;
    throw new Error("The selected file is not a readable XD/ZIP package.");
  }

  const warnings: Warning[] = [];
  const manifestEntry = Object.keys(archive).find((name) => /(^|\/)manifest$/i.test(name));
  const manifest = manifestEntry ? parseJsonEntry(archive, manifestEntry) : undefined;
  const manifestBoards = manifest ? manifestArtboards(manifest) : [];
  const sharedResourcesName = Object.keys(archive).find((name) => /^resources\/graphics\/graphicContent\.agc$/i.test(name));
  const resources = indexResources(sharedResourcesName ? parseJsonEntry(archive, sharedResourcesName) : undefined);
  const pasteboardName = Object.keys(archive).find((name) => /^artwork\/pasteboard\/graphics\/graphicContent\.agc$/i.test(name));
  const pasteboard = pasteboardName ? parseJsonEntry(archive, pasteboardName) : undefined;
  const boardEntries = Object.keys(archive).filter((name) => /^artwork\/artboard-[^/]+\/graphics\/graphicContent\.agc$/i.test(name));
  let nodes: Array<{ node: unknown; info?: ManifestArtboard }> = [];
  for (const name of boardEntries) {
    const artwork = parseJsonEntry(archive, name);
    if (!artwork) continue;
    const path = name.split("/")[1];
    const info = manifestBoards.find((board) => board.path === path);
    nodes.push(...collectArtboardNodes(artwork).map((node) => ({ node, info })));
  }
  if (!nodes.length) {
    const fallbackName = Object.keys(archive).find((name) => /(^|\/)(graphicContent\.agc|artwork\.json|document\.json)$/i.test(name));
    const artwork = fallbackName ? parseJsonEntry(archive, fallbackName) : undefined;
    if (!artwork) throw new Error("This XD package does not contain readable artwork data.");
    nodes = collectArtboardNodes(artwork).map((node) => ({ node }));
  }
  if (!nodes.length) warnings.push({ code: "no-artboards", message: "No artboards were found in the artwork data." });
  let version: string | undefined;
  if (manifest) {
    try {
      version = string(manifest.version ?? manifest.appVersion) || undefined;
    } catch {
      warnings.push({ code: "manifest-error", message: "The package manifest could not be read." });
    }
  }
  return {
    name: fileName.replace(/\.xd$/i, ""),
    version,
    artboards: nodes.map(({ node, info }, index) => normalizeArtboard(node, warnings, index, info, resources)),
    pasteboardLayers: pasteboard
      ? childNodes(pasteboard).map((layer, index) => normalizeLayer(layer, warnings, index, { x: 0, y: 0 }, resources))
      : [],
    assets: extractAssets(archive, warnings),
    warnings,
  };
}

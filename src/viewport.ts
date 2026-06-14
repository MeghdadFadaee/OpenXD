import type { Artboard, ParsedDocument } from "./types";

export type DocumentBounds = { x: number; y: number; width: number; height: number };
export type ViewportSize = { width: number; height: number };
export type ViewTransform = { zoom: number; pan: { x: number; y: number } };

export function artboardBounds(document: ParsedDocument): DocumentBounds {
  if (!document.artboards.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...document.artboards.map((artboard) => artboard.x));
  const y = Math.min(...document.artboards.map((artboard) => artboard.y));
  const right = Math.max(...document.artboards.map((artboard) => artboard.x + artboard.width));
  const bottom = Math.max(...document.artboards.map((artboard) => artboard.y + artboard.height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function fitBounds(bounds: DocumentBounds, viewport: ViewportSize, padding = 80, maxZoom = 1): ViewTransform {
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  return {
    zoom: Math.min(maxZoom, availableWidth / bounds.width, availableHeight / bounds.height),
    pan: { x: 0, y: 0 },
  };
}

export function focusArtboard(artboard: Artboard, bounds: DocumentBounds, viewport: ViewportSize, padding = 80): ViewTransform {
  const zoom = Math.min(2, (viewport.width - padding * 2) / artboard.width, (viewport.height - padding * 2) / artboard.height);
  const documentCenter = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const artboardCenter = { x: artboard.x + artboard.width / 2, y: artboard.y + artboard.height / 2 };
  return {
    zoom,
    pan: {
      x: -(artboardCenter.x - documentCenter.x) * zoom,
      y: -(artboardCenter.y - documentCenter.y) * zoom,
    },
  };
}

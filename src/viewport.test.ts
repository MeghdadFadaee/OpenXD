import { describe, expect, it } from "vitest";
import type { Artboard, ParsedDocument } from "./types";
import { artboardBounds, fitBounds, focusArtboard } from "./viewport";

const artboards: Artboard[] = [
  { id: "a", name: "A", x: -500, y: -100, width: 200, height: 400, background: "#fff", layers: [] },
  { id: "b", name: "B", x: 300, y: 500, width: 300, height: 200, background: "#fff", layers: [] },
];
const document: ParsedDocument = { name: "Demo", artboards, pasteboardLayers: [], assets: {}, warnings: [] };

describe("viewport helpers", () => {
  it("measures artboards with negative document coordinates", () => {
    expect(artboardBounds(document)).toEqual({ x: -500, y: -100, width: 1100, height: 800 });
  });

  it("fits complete bounds inside the viewport", () => {
    expect(fitBounds({ x: -500, y: -100, width: 1100, height: 800 }, { width: 1200, height: 900 }, 50)).toEqual({
      zoom: 1,
      pan: { x: 0, y: 0 },
    });
  });

  it("fits complete bounds inside a narrow mobile viewport", () => {
    const transform = fitBounds({ x: -500, y: -100, width: 1100, height: 800 }, { width: 390, height: 700 }, 40);
    expect(transform.zoom).toBeCloseTo(310 / 1100);
    expect(transform.pan).toEqual({ x: 0, y: 0 });
  });

  it("focuses an artboard relative to the document center", () => {
    const transform = focusArtboard(artboards[0], artboardBounds(document), { width: 1000, height: 800 }, 100);
    expect(transform.zoom).toBe(1.5);
    expect(transform.pan.x).toBeGreaterThan(0);
    expect(transform.pan.y).toBeGreaterThan(0);
  });
});

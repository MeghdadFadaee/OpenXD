import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseXdBuffer } from "./parser";

function packageBuffer(artwork: unknown, manifest: unknown = { version: "60.0" }): ArrayBuffer {
  const bytes = zipSync({
    manifest: strToU8(JSON.stringify(manifest)),
    "artwork/graphicContent.agc": strToU8(JSON.stringify(artwork)),
  });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function multiArtboardPackage(): ArrayBuffer {
  const bytes = zipSync({
    manifest: strToU8(JSON.stringify({
      children: [{ children: [{ path: "artboard-board-1", name: "Manifest name", "uxdesign#bounds": { x: 100, y: 50, width: 360, height: 800 } }] }],
    })),
    "artwork/artboard-board-1/graphics/graphicContent.agc": strToU8(JSON.stringify({
      artboards: { board: {} },
      children: [{
        type: "artboard",
        id: "board-1",
        artboard: { children: [{ type: "rectangle", transform: { tx: 120, ty: 80 }, shape: { type: "rect", width: 40, height: 20 } }] },
      }],
    })),
  });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("parseXdBuffer", () => {
  it("parses an artboard and common layers", () => {
    const document = parseXdBuffer(packageBuffer({
      children: [{
        type: "artboard",
        id: "board-1",
        name: "Login",
        bounds: { x: 0, y: 0, width: 375, height: 812 },
        background: "#ffffff",
        children: [
          { type: "rectangle", name: "Button", bounds: { x: 20, y: 100, width: 200, height: 44 }, fill: "#6633ff" },
          { type: "text", name: "Label", bounds: { x: 30, y: 110, width: 100, height: 20 }, text: "Continue", textStyle: { fontSize: 16, color: "#ffffff" } },
        ],
      }],
    }), "sample.xd");

    expect(document.name).toBe("sample");
    expect(document.version).toBe("60.0");
    expect(document.artboards).toHaveLength(1);
    expect(document.artboards[0].layers.map((layer) => layer.type)).toEqual(["rect", "text"]);
    expect(document.warnings).toHaveLength(0);
  });

  it("keeps parsing and warns about unknown layers", () => {
    const document = parseXdBuffer(packageBuffer({
      children: [{ type: "artboard", children: [{ type: "future-3d-layer", name: "Model" }] }],
    }));

    expect(document.artboards).toHaveLength(1);
    expect(document.warnings[0]).toMatchObject({ code: "unsupported-layer", layer: "Model" });
  });

  it("supports nested AGC geometry, transforms, and rich text", () => {
    const document = parseXdBuffer(packageBuffer({
      children: [{
        type: "artboard",
        artboard: { name: "Nested", width: 400, height: 300 },
        children: [{
          type: "shape",
          transform: { tx: 40, ty: 60 },
          shape: { type: "rect", width: 120, height: 32, cornerRadius: 8 },
          style: { fill: { type: "solid", color: { value: "#123456" } } },
        }, {
          type: "text",
          text: { paragraphs: [{ lines: [{ spans: [{ text: "Rich text" }] }] }] },
        }],
      }],
    }));

    expect(document.artboards[0]).toMatchObject({ name: "Nested", width: 400, height: 300 });
    expect(document.artboards[0].layers[0]).toMatchObject({
      type: "rect", x: 40, y: 60, width: 120, height: 32, radius: 8,
      fill: { type: "solid", color: "#123456" },
    });
    expect(document.artboards[0].layers[1].text).toBe("Rich text");
  });

  it("rejects a non-archive", () => {
    const buffer = new TextEncoder().encode("not an xd file").buffer;
    expect(() => parseXdBuffer(buffer)).toThrow("not a readable XD/ZIP package");
  });

  it("reports artwork packages with no artboards", () => {
    const document = parseXdBuffer(packageBuffer({ children: [] }));
    expect(document.warnings).toContainEqual(expect.objectContaining({ code: "no-artboards" }));
  });

  it("parses separately packaged artboards using manifest names and origins", () => {
    const document = parseXdBuffer(multiArtboardPackage());
    expect(document.artboards[0]).toMatchObject({ name: "Manifest name", width: 360, height: 800 });
    expect(document.artboards[0].layers[0]).toMatchObject({ type: "rect", x: 20, y: 30, width: 40, height: 20 });
  });

  it("recognizes XD pattern fills as image paints", () => {
    const document = parseXdBuffer(packageBuffer({
      children: [{
        type: "artboard",
        children: [{
          type: "shape",
          shape: { type: "rect", width: 100, height: 80 },
          style: { fill: { type: "pattern", pattern: { meta: { ux: { uid: "image-id" } } } } },
        }],
      }],
    }));
    expect(document.artboards[0].layers[0]).toMatchObject({ type: "rect", fill: { type: "pattern", asset: "image-id" } });
  });

  it("preserves nested color alpha and does not render compound operands twice", () => {
    const document = parseXdBuffer(packageBuffer({
      children: [{
        type: "artboard",
        children: [{
          type: "shape",
          style: {
            blendMode: "soft-light",
            fill: { type: "solid", color: { value: { r: 10, g: 20, b: 30 }, alpha: 0.25 } },
          },
          shape: {
            type: "compound",
            path: "M 0 0 L 10 0 L 10 10 Z",
            children: [{ type: "shape", shape: { type: "path", path: "M 0 0 L 1 1" } }],
          },
        }],
      }],
    }));
    expect(document.artboards[0].layers[0]).toMatchObject({
      type: "path",
      blendMode: "soft-light",
      fill: { type: "solid", color: "rgba(10, 20, 30, 0.25)" },
    });
    expect(document.artboards[0].layers[0].children).toBeUndefined();
  });

  it("uses ellipse radii and positioned RTL text lines", () => {
    const document = parseXdBuffer(packageBuffer({
      children: [{
        type: "artboard",
        children: [{
          type: "group",
          transform: { tx: 100, ty: 200 },
          group: { children: [{
            type: "shape",
            transform: { tx: 10, ty: 20 },
            shape: { type: "ellipse", cx: 50, cy: 40, rx: 50, ry: 40 },
          }, {
            type: "text",
            transform: { tx: 30, ty: 60 },
            style: { font: { size: 24 } },
            text: {
              rawText: "اشتراک 12",
              paragraphs: [{ lines: [[
                { from: 7, to: 9, x: -90, y: 4 },
                { from: 0, to: 7 },
              ]] }],
            },
          }] },
        }],
      }],
    }));
    const group = document.artboards[0].layers[0];
    expect(group.children?.[0]).toMatchObject({ type: "ellipse", width: 100, height: 80 });
    expect(group.children?.[1].textLines).toEqual([{ text: "اشتراک 12", x: -90, y: 4, fontSize: 24 }]);
  });

  it("resolves shared syncRef components and nested XD colors", () => {
    const bytes = zipSync({
      manifest: strToU8(JSON.stringify({})),
      "resources/graphics/graphicContent.agc": strToU8(JSON.stringify({
        resources: { meta: { ux: { symbols: [{
          type: "shape",
          id: "source-shape",
          shape: { type: "rect", width: 50, height: 30 },
          style: { fill: { type: "solid", color: { value: { r: 126, g: 61, b: 254 } } } },
        }] } } },
      })),
      "artwork/artboard-board-1/graphics/graphicContent.agc": strToU8(JSON.stringify({
        children: [{
          type: "artboard",
          artboard: { children: [{ type: "syncRef", syncSourceGuid: "source-shape", transform: { tx: 10, ty: 20 } }] },
        }],
      })),
    });
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const document = parseXdBuffer(buffer);

    expect(document.warnings).toHaveLength(0);
    expect(document.artboards[0].layers[0]).toMatchObject({
      type: "rect",
      x: 10,
      y: 20,
      fill: { type: "solid", color: "rgba(126, 61, 254, 1)" },
    });
  });

  it("extracts pasteboard annotations with global coordinates", () => {
    const bytes = zipSync({
      manifest: strToU8(JSON.stringify({})),
      "artwork/artboard-board-1/graphics/graphicContent.agc": strToU8(JSON.stringify({
        children: [{ type: "artboard", artboard: { children: [] } }],
      })),
      "artwork/pasteboard/graphics/graphicContent.agc": strToU8(JSON.stringify({
        children: [{
          type: "text",
          name: "Annotation",
          transform: { tx: -200, ty: 300 },
          text: { rawText: "Outside note" },
        }, {
          type: "shape",
          name: "Arrow",
          transform: { tx: 40, ty: 50 },
          shape: { type: "path", path: "M 0 0 L 20 20" },
        }],
      })),
    });
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const document = parseXdBuffer(buffer);

    expect(document.pasteboardLayers).toHaveLength(2);
    expect(document.pasteboardLayers[0]).toMatchObject({ type: "text", x: -200, y: 300, text: "Outside note" });
    expect(document.pasteboardLayers[1]).toMatchObject({ type: "path", x: 40, y: 50 });
  });
});

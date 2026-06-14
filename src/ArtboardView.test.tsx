import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArtboardView } from "./ArtboardView";
import type { ParsedDocument } from "./types";

const document: ParsedDocument = {
  name: "Demo",
  assets: {},
  warnings: [],
  pasteboardLayers: [],
  artboards: [{
    id: "board",
    name: "Welcome",
    x: 0,
    y: 0,
    width: 320,
    height: 640,
    background: "#fff",
    layers: [{
      id: "title",
      name: "Title",
      type: "text",
      x: 20,
      y: 20,
      width: 200,
      height: 40,
      opacity: 1,
      visible: true,
      text: "Hello OpenXD",
      fontSize: 24,
    }],
  }],
};

describe("ArtboardView", () => {
  it("renders the selected artboard and its text", () => {
    render(<ArtboardView artboard={document.artboards[0]} document={document} />);
    expect(screen.getByRole("img", { name: "Welcome" })).toBeInTheDocument();
    expect(screen.getByText("Hello OpenXD")).toBeInTheDocument();
  });

  it("renders radial gradients, image patterns, and blend modes", () => {
    const painted: ParsedDocument = {
      ...document,
      assets: { texture: "data:image/png;base64,AAAA" },
      artboards: [{
        ...document.artboards[0],
        layers: [{
          id: "gradient",
          name: "Glow",
          type: "ellipse",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          opacity: 1,
          visible: true,
          blendMode: "screen",
          fill: {
            type: "radial-gradient",
            cx: 0.5,
            cy: 0.5,
            r: 0.5,
            stops: [{ offset: 0, color: "#fff" }, { offset: 1, color: "rgba(255, 255, 255, 0)" }],
          },
        }, {
          id: "pattern",
          name: "Texture",
          type: "rect",
          x: 0,
          y: 100,
          width: 100,
          height: 100,
          opacity: 1,
          visible: true,
          fill: { type: "pattern", asset: "texture" },
        }],
      }],
    };
    const { container } = render(<ArtboardView artboard={painted.artboards[0]} document={painted} />);
    expect(container.querySelector("radialGradient")).toBeInTheDocument();
    expect(container.querySelector("pattern image")).toHaveAttribute("href", painted.assets.texture);
    expect(container.querySelector('g[style*="screen"]')).toBeInTheDocument();
  });

  it("renders positioned text lines at XD coordinates", () => {
    const positioned: ParsedDocument = {
      ...document,
      artboards: [{
        ...document.artboards[0],
        layers: [{
          ...document.artboards[0].layers[0],
          textLines: [{ text: "Placed", x: -80, y: 4, fontSize: 32 }],
        }],
      }],
    };
    const { container } = render(<ArtboardView artboard={positioned.artboards[0]} document={positioned} />);
    const line = container.querySelector("tspan");
    expect(line).toHaveAttribute("x", "-80");
    expect(line).toHaveAttribute("y", "4");
    expect(line).toHaveAttribute("font-size", "32");
  });
});

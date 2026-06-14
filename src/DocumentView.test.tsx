import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DocumentView } from "./DocumentView";
import type { ParsedDocument } from "./types";

beforeAll(() => {
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: -100, y: -50, width: 700, height: 500 }),
  });
});

const document: ParsedDocument = {
  name: "Full page",
  assets: {},
  warnings: [],
  artboards: [
    { id: "a", name: "First", x: -100, y: 0, width: 200, height: 300, background: "#fff", layers: [] },
    { id: "b", name: "Second", x: 300, y: 0, width: 200, height: 300, background: "#fff", layers: [] },
  ],
  pasteboardLayers: [{
    id: "note",
    name: "Note",
    type: "text",
    x: 120,
    y: 350,
    width: 100,
    height: 20,
    opacity: 1,
    visible: true,
    text: "Outside annotation",
  }],
};

describe("DocumentView", () => {
  it("renders all artboards and pasteboard annotations in one SVG", () => {
    render(<DocumentView document={document} bounds={{ x: -100, y: -50, width: 700, height: 500 }} onBoundsChange={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Full page pasteboard" })).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByText("Outside annotation")).toBeInTheDocument();
  });
});

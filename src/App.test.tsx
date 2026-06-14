import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

vi.stubGlobal("Worker", class {
  postMessage() {}
  terminate() {}
});

describe("App canvas selection", () => {
  it("does not expose a viewer canvas before a file is opened", () => {
    render(<App />);
    expect(screen.getByText("Open an Adobe XD file")).toBeInTheDocument();
  });

  it("keeps normal document text non-selectable by CSS", () => {
    const { container } = render(<App />);
    fireEvent.doubleClick(container);
    expect(container.querySelector(".selectable-text")).not.toBeInTheDocument();
  });
});

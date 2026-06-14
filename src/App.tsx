import { useCallback, useEffect, useRef, useState } from "react";
import { DocumentView } from "./DocumentView";
import type { ParsedDocument } from "./types";
import { artboardBounds, fitBounds, focusArtboard, type DocumentBounds } from "./viewport";
import "./styles.css";

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 4;

function DropScreen({ openFile, loading, error }: { openFile: (file: File) => void; loading: boolean; error: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <main
      className={`drop-screen ${dragging ? "dragging" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) openFile(file);
      }}
    >
      <section className="drop-card">
        <div className="logo">XD</div>
        <p className="eyebrow">Private, browser-only viewer</p>
        <h1>Open an Adobe XD file</h1>
        <p className="lede">Inspect artboards without uploading your design. Your file stays in this browser tab.</p>
        <button className="primary" onClick={() => inputRef.current?.click()} disabled={loading}>
          {loading ? "Opening file..." : "Choose .xd file"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xd,application/zip"
          hidden
          onChange={(event) => event.target.files?.[0] && openFile(event.target.files[0])}
        />
        <span className="drop-hint">or drop a file anywhere here</span>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </main>
  );
}

export default function App() {
  const [document, setDocument] = useState<ParsedDocument | null>(null);
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(0.1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [bounds, setBounds] = useState<DocumentBounds>({ x: 0, y: 0, width: 1, height: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const dragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const touchRef = useRef<{
    mode: "pan" | "pinch";
    x: number;
    y: number;
    distance: number;
    pan: { x: number; y: number };
    zoom: number;
  } | null>(null);
  const canvasRef = useRef<HTMLElement>(null);
  const selectedTextRef = useRef<SVGTextElement | null>(null);

  const clearTextSelection = useCallback(() => {
    selectedTextRef.current?.classList.remove("selectable-text");
    selectedTextRef.current = null;
    window.getSelection()?.removeAllRanges();
  }, []);

  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const fit = useCallback(() => {
    if (!document) return;
    const canvas = canvasRef.current?.getBoundingClientRect();
    const transform = fitBounds(bounds, {
      width: canvas?.width ?? window.innerWidth - 280,
      height: canvas?.height ?? window.innerHeight - 64,
    });
    setZoom(Math.max(MIN_ZOOM, transform.zoom));
    setPan(transform.pan);
  }, [bounds, document]);

  useEffect(() => { fit(); }, [fit]);
  useEffect(() => {
    const refit = () => fit();
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [fit]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !document) return;
    const center = (touches: TouchList) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    });
    const distance = (touches: TouchList) =>
      Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
    const begin = (event: TouchEvent) => {
      event.preventDefault();
      if (event.touches.length >= 2) {
        const point = center(event.touches);
        touchRef.current = { mode: "pinch", ...point, distance: distance(event.touches), pan: panRef.current, zoom: zoomRef.current };
      } else if (event.touches.length === 1) {
        touchRef.current = {
          mode: "pan",
          x: event.touches[0].clientX,
          y: event.touches[0].clientY,
          distance: 0,
          pan: panRef.current,
          zoom: zoomRef.current,
        };
      }
    };
    const move = (event: TouchEvent) => {
      event.preventDefault();
      const gesture = touchRef.current;
      if (!gesture) return;
      if (event.touches.length >= 2) {
        const point = center(event.touches);
        if (gesture.mode !== "pinch") {
          touchRef.current = { mode: "pinch", ...point, distance: distance(event.touches), pan: panRef.current, zoom: zoomRef.current };
          return;
        }
        setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, gesture.zoom * distance(event.touches) / gesture.distance)));
        setPan({ x: gesture.pan.x + point.x - gesture.x, y: gesture.pan.y + point.y - gesture.y });
      } else if (event.touches.length === 1 && gesture.mode === "pan") {
        setPan({
          x: gesture.pan.x + event.touches[0].clientX - gesture.x,
          y: gesture.pan.y + event.touches[0].clientY - gesture.y,
        });
      }
    };
    const end = (event: TouchEvent) => {
      event.preventDefault();
      if (event.touches.length) begin(event);
      else touchRef.current = null;
    };
    canvas.addEventListener("touchstart", begin, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end, { passive: false });
    canvas.addEventListener("touchcancel", end, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", begin);
      canvas.removeEventListener("touchmove", move);
      canvas.removeEventListener("touchend", end);
      canvas.removeEventListener("touchcancel", end);
    };
  }, [document]);

  const openFile = useCallback(async (file: File) => {
    setLoading(true);
    setError("");
    if (!file.name.toLowerCase().endsWith(".xd")) {
      setLoading(false);
      setError("Choose a file with the .xd extension.");
      return;
    }
    const worker = new Worker(new URL("./parser.worker.ts", import.meta.url), { type: "module" });
    try {
      const buffer = await file.arrayBuffer();
      worker.onmessage = (event: MessageEvent<{ document?: ParsedDocument; error?: string }>) => {
        setLoading(false);
        worker.terminate();
        if (event.data.error) setError(event.data.error);
        else if (event.data.document) {
          setDocument(event.data.document);
          setActive(0);
          setBounds(artboardBounds(event.data.document));
          setWarningsOpen(event.data.document.warnings.length > 0);
        }
      };
      worker.onerror = () => {
        setLoading(false);
        setError("The viewer could not parse this file.");
        worker.terminate();
      };
      worker.postMessage({ buffer, name: file.name }, [buffer]);
    } catch {
      setLoading(false);
      setError("The selected file could not be read.");
      worker.terminate();
    }
  }, []);

  if (!document) return <DropScreen openFile={openFile} loading={loading} error={error} />;
  const focus = (index: number) => {
    const artboard = document.artboards[index];
    if (!artboard) return;
    const canvas = canvasRef.current?.getBoundingClientRect();
    const transform = focusArtboard(artboard, bounds, {
      width: canvas?.width ?? window.innerWidth - 280,
      height: canvas?.height ?? window.innerHeight - 64,
    });
    setActive(index);
    setZoom(Math.max(MIN_ZOOM, transform.zoom));
    setPan(transform.pan);
    setSidebarOpen(false);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <button className="menu-button" onClick={() => setSidebarOpen((open) => !open)} aria-label="Toggle artboards" aria-expanded={sidebarOpen}>☰</button>
          <span>XD</span><strong>{document.name}</strong>{document.version && <small>v{document.version}</small>}
        </div>
        <div className="toolbar">
          <button onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value / 1.2))} aria-label="Zoom out">−</button>
          <output>{Math.round(zoom * 100)}%</output>
          <button onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value * 1.2))} aria-label="Zoom in">+</button>
          <button onClick={fit}>Fit</button>
          <button className="clear" onClick={() => { setDocument(null); setError(""); }}>Close</button>
        </div>
      </header>
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-title"><strong>Artboards</strong><span>{document.artboards.length}</span></div>
        <div className="artboard-list">
          {document.artboards.map((item, index) => (
            <button className={index === active ? "active" : ""} key={item.id + index} onClick={() => focus(index)}>
              <span className="miniature" style={{ aspectRatio: `${item.width}/${item.height}`, background: item.background }} />
              <span><strong>{item.name}</strong><small>{item.width} × {item.height}</small></span>
            </button>
          ))}
          {!document.artboards.length && <p className="empty">No artboards found.</p>}
        </div>
        {!!document.warnings.length && (
          <div className="warnings">
            <button onClick={() => setWarningsOpen((open) => !open)}>
              <span>Compatibility warnings</span><b>{document.warnings.length}</b>
            </button>
            {warningsOpen && <ul>{document.warnings.map((warning, index) => <li key={index}>{warning.message}{warning.layer && <small>{warning.layer}</small>}</li>)}</ul>}
          </div>
        )}
      </aside>
      {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close artboards" />}
      <main
        ref={canvasRef}
        className="canvas"
        onWheel={(event) => {
          event.preventDefault();
          setZoom((value) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value * (event.deltaY > 0 ? 0.9 : 1.1))));
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "touch") return;
          if (event.detail < 2) clearTextSelection();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY, originX: pan.x, originY: pan.y };
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== "touch" && dragRef.current) {
            setPan({ x: dragRef.current.originX + event.clientX - dragRef.current.x, y: dragRef.current.originY + event.clientY - dragRef.current.y });
          }
        }}
        onPointerUp={(event) => {
          if (event.pointerType !== "touch") dragRef.current = null;
        }}
        onPointerCancel={(event) => {
          if (event.pointerType !== "touch") dragRef.current = null;
        }}
        onDoubleClick={(event) => {
          const target = event.target instanceof Element ? event.target.closest("text") : null;
          if (!(target instanceof SVGTextElement)) return;
          clearTextSelection();
          target.classList.add("selectable-text");
          selectedTextRef.current = target;
          const range = window.document.createRange();
          range.selectNodeContents(target);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }}
      >
        {document.artboards.length || document.pasteboardLayers.length ? (
          <div
            className="stage document-stage"
            style={{ width: bounds.width, height: bounds.height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            <DocumentView document={document} bounds={bounds} onBoundsChange={setBounds} />
          </div>
        ) : <div className="canvas-empty">This file has no displayable artboards.</div>}
      </main>
    </div>
  );
}

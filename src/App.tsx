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
  const dragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const canvasRef = useRef<HTMLElement>(null);

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
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span>XD</span><strong>{document.name}</strong>{document.version && <small>v{document.version}</small>}</div>
        <div className="toolbar">
          <button onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - 0.1))} aria-label="Zoom out">−</button>
          <output>{Math.round(zoom * 100)}%</output>
          <button onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + 0.1))} aria-label="Zoom in">+</button>
          <button onClick={fit}>Fit</button>
          <button className="clear" onClick={() => { setDocument(null); setError(""); }}>Close file</button>
        </div>
      </header>
      <aside className="sidebar">
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
      <main
        ref={canvasRef}
        className="canvas"
        onWheel={(event) => {
          event.preventDefault();
          setZoom((value) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value * (event.deltaY > 0 ? 0.9 : 1.1))));
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY, originX: pan.x, originY: pan.y };
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          setPan({ x: dragRef.current.originX + event.clientX - dragRef.current.x, y: dragRef.current.originY + event.clientY - dragRef.current.y });
        }}
        onPointerUp={() => { dragRef.current = null; }}
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

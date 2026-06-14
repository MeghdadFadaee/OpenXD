import { useLayoutEffect, useRef } from "react";
import { LayerView } from "./ArtboardView";
import type { ParsedDocument } from "./types";
import type { DocumentBounds } from "./viewport";

type Props = {
  document: ParsedDocument;
  bounds: DocumentBounds;
  onBoundsChange: (bounds: DocumentBounds) => void;
};

export function DocumentView({ document, bounds, onBoundsChange }: Props) {
  const pasteboardRef = useRef<SVGGElement>(null);

  useLayoutEffect(() => {
    const artboardLeft = document.artboards.length ? Math.min(...document.artboards.map((artboard) => artboard.x)) : 0;
    const artboardTop = document.artboards.length ? Math.min(...document.artboards.map((artboard) => artboard.y)) : 0;
    const artboardRight = document.artboards.length ? Math.max(...document.artboards.map((artboard) => artboard.x + artboard.width)) : 1;
    const artboardBottom = document.artboards.length ? Math.max(...document.artboards.map((artboard) => artboard.y + artboard.height)) : 1;
    const pasteboardBox = document.pasteboardLayers.length ? pasteboardRef.current?.getBBox() : undefined;
    const left = Math.min(artboardLeft, pasteboardBox?.x ?? artboardLeft);
    const top = Math.min(artboardTop, pasteboardBox?.y ?? artboardTop);
    const right = Math.max(artboardRight, pasteboardBox ? pasteboardBox.x + pasteboardBox.width : artboardRight);
    const bottom = Math.max(artboardBottom, pasteboardBox ? pasteboardBox.y + pasteboardBox.height : artboardBottom);
    const padding = 40;
    const measured = {
      x: Math.floor(left - padding),
      y: Math.floor(top - padding),
      width: Math.ceil(right - left + padding * 2),
      height: Math.ceil(bottom - top + padding * 2),
    };
    if (measured.x !== bounds.x || measured.y !== bounds.y || measured.width !== bounds.width || measured.height !== bounds.height) {
      onBoundsChange(measured);
    }
  }, [bounds, document, onBoundsChange]);

  return (
    <svg
      className="document-view"
      width={bounds.width}
      height={bounds.height}
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      role="img"
      aria-label={`${document.name} pasteboard`}
    >
      <defs>
        {document.artboards.map((artboard, index) => (
          <clipPath id={`artboard-clip-${index}`} key={artboard.id + index}>
            <rect x={artboard.x} y={artboard.y} width={artboard.width} height={artboard.height} />
          </clipPath>
        ))}
      </defs>
      <g>
        {document.artboards.map((artboard, artboardIndex) => (
          <g key={artboard.id + artboardIndex}>
            <text className="document-artboard-label" x={artboard.x} y={artboard.y - 12}>{artboard.name}</text>
            <g clipPath={`url(#artboard-clip-${artboardIndex})`}>
              <rect x={artboard.x} y={artboard.y} width={artboard.width} height={artboard.height} fill={artboard.background} />
              <g transform={`translate(${artboard.x} ${artboard.y})`}>
                {artboard.layers.map((layer, index) => (
                  <LayerView key={layer.id + index} layer={layer} document={document} path={`${artboard.id}-${index}`} />
                ))}
              </g>
            </g>
          </g>
        ))}
        <g ref={pasteboardRef}>
          {document.pasteboardLayers.map((layer, index) => (
            <LayerView key={layer.id + index} layer={layer} document={document} path={`pasteboard-${index}`} />
          ))}
        </g>
      </g>
    </svg>
  );
}

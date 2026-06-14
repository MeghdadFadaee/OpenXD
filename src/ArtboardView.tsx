import type { Artboard, Layer, ParsedDocument } from "./types";

type Props = {
  artboard: Artboard;
  document: ParsedDocument;
};

function assetUrl(document: ParsedDocument, reference?: string): string | undefined {
  if (!reference) return undefined;
  if (reference.startsWith("data:")) return reference;
  return document.assets[reference] ?? document.assets[reference.replace(/^\.?\//, "")] ??
    document.assets[reference.split("/").pop() ?? reference];
}

function blendMode(value?: string): React.CSSProperties["mixBlendMode"] {
  if (!value) return undefined;
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`) as React.CSSProperties["mixBlendMode"];
}

export function LayerView({ layer, document, path }: { layer: Layer; document: ParsedDocument; path: string }) {
  if (!layer.visible || layer.type === "unknown") return null;
  const transform = layer.matrix
    ? `matrix(${layer.matrix.a} ${layer.matrix.b} ${layer.matrix.c} ${layer.matrix.d} ${layer.x} ${layer.y})${layer.rotation ? ` rotate(${layer.rotation} ${layer.width / 2} ${layer.height / 2})` : ""}`
    : `translate(${layer.x} ${layer.y})${layer.rotation ? ` rotate(${layer.rotation} ${layer.width / 2} ${layer.height / 2})` : ""}`;
  const gradientId = `gradient-${path.replace(/[^a-z0-9]/gi, "-")}`;
  const fill = layer.fill?.type === "solid" ? layer.fill.color : layer.fill ? `url(#${gradientId})` : "transparent";
  const common = {
    fill,
    stroke: layer.stroke ?? "none",
    strokeWidth: layer.strokeWidth ?? 0,
    opacity: layer.opacity,
  };
  const children = layer.children?.map((child, index) => (
    <LayerView key={child.id + index} layer={child} document={document} path={`${path}-${index}`} />
  ));
  const paintDefinition = layer.fill?.type === "linear-gradient" ? (
    <defs>
      <linearGradient id={gradientId} gradientTransform={`rotate(${layer.fill.angle})`}>
        {layer.fill.stops.map((stop, index) => <stop key={index} offset={stop.offset} stopColor={stop.color} />)}
      </linearGradient>
    </defs>
  ) : layer.fill?.type === "radial-gradient" ? (
    <defs>
      <radialGradient id={gradientId} cx={layer.fill.cx} cy={layer.fill.cy} r={layer.fill.r}>
        {layer.fill.stops.map((stop, index) => <stop key={index} offset={stop.offset} stopColor={stop.color} />)}
      </radialGradient>
    </defs>
  ) : layer.fill?.type === "pattern" && assetUrl(document, layer.fill.asset) ? (
    <defs>
      <pattern id={gradientId} width="1" height="1" patternContentUnits="objectBoundingBox">
        <image href={assetUrl(document, layer.fill.asset)} width="1" height="1" preserveAspectRatio="xMidYMid slice" />
      </pattern>
    </defs>
  ) : null;

  let shape: React.ReactNode;
  switch (layer.type) {
    case "rect":
      shape = <rect width={layer.width} height={layer.height} rx={layer.radius} {...common} />;
      break;
    case "ellipse":
      shape = <ellipse cx={layer.width / 2} cy={layer.height / 2} rx={layer.width / 2} ry={layer.height / 2} {...common} />;
      break;
    case "path":
      shape = <path d={layer.path} {...common} />;
      break;
    case "text":
      shape = (
        <text
          x={0}
          y={0}
          fill={layer.textColor}
          opacity={layer.opacity}
          fontSize={layer.fontSize}
          fontFamily={layer.fontFamily}
          fontWeight={layer.fontWeight}
        >
          {layer.textLines?.map((line, index) => (
            <tspan key={index} x={line.x} y={line.y} fontSize={line.fontSize}>{line.text}</tspan>
          )) ?? layer.text?.split("\n").map((line, index) => (
            <tspan key={index} x={0} y={index * (layer.fontSize ?? 16) * 1.2}>{line}</tspan>
          ))}
        </text>
      );
      break;
    case "image": {
      const href = assetUrl(document, layer.imageAsset);
      shape = href
        ? <image href={href} width={layer.width} height={layer.height} preserveAspectRatio="xMidYMid slice" opacity={layer.opacity} />
        : <rect width={layer.width} height={layer.height} fill="#e6e8ef" stroke="#a8adbd" strokeDasharray="6 4" />;
      break;
    }
    default:
      shape = null;
  }
  return <g transform={transform} style={{ mixBlendMode: blendMode(layer.blendMode) }}>{paintDefinition}{shape}{children}</g>;
}

export function ArtboardView({ artboard, document }: Props) {
  return (
    <svg
      className="artboard"
      width={artboard.width}
      height={artboard.height}
      viewBox={`0 0 ${artboard.width} ${artboard.height}`}
      role="img"
      aria-label={artboard.name}
    >
      <rect width={artboard.width} height={artboard.height} fill={artboard.background} />
      {artboard.layers.map((layer, index) => (
        <LayerView key={layer.id + index} layer={layer} document={document} path={`${artboard.id}-${index}`} />
      ))}
    </svg>
  );
}

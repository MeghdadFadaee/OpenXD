export type Warning = {
  code: string;
  message: string;
  layer?: string;
};

export type Paint =
  | { type: "solid"; color: string }
  | { type: "linear-gradient"; angle: number; stops: Array<{ offset: number; color: string }> }
  | { type: "radial-gradient"; cx: number; cy: number; r: number; stops: Array<{ offset: number; color: string }> }
  | { type: "pattern"; asset: string };

export type Layer = {
  id: string;
  name: string;
  type: "group" | "rect" | "ellipse" | "path" | "text" | "image" | "unknown";
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  blendMode?: string;
  rotation?: number;
  matrix?: { a: number; b: number; c: number; d: number };
  fill?: Paint;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  path?: string;
  text?: string;
  textLines?: Array<{ text: string; x: number; y: number; fontSize?: number }>;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  textColor?: string;
  imageAsset?: string;
  children?: Layer[];
};

export type Artboard = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  background: string;
  layers: Layer[];
};

export type ParsedDocument = {
  name: string;
  version?: string;
  artboards: Artboard[];
  pasteboardLayers: Layer[];
  assets: Record<string, string>;
  warnings: Warning[];
};

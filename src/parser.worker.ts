import { parseXdBuffer } from "./parser";

self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer; name: string }>) => {
  try {
    self.postMessage({ document: parseXdBuffer(event.data.buffer, event.data.name) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Could not open this XD file." });
  }
};

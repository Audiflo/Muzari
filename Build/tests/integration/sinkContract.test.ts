import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { AudioGraph } from "../../src/platform/audio/graph";
import { StreamingDecoderBackend } from "../../src/platform/audio/backends/StreamingDecoderBackend";

const NO_SOURCE = "flo backend has no loaded source to play";

describe("StreamingDecoderBackend sink contract", () => {
  let graph: AudioGraph;
  let backend: StreamingDecoderBackend;

  beforeEach(() => {
    graph = new AudioGraph();
    backend = new StreamingDecoderBackend(graph, "flo");
  });

  afterEach(() => {
    backend.dispose();
    graph.dispose();
  });

  it("rejects play() before any source is loaded", async () => {
    await expect(backend.play()).rejects.toThrow(NO_SOURCE);
  });

  it("rejects play() again after a stop releases the source", async () => {
    backend.stop();
    await expect(backend.play()).rejects.toThrow(NO_SOURCE);
  });

  it("stops silently before a source is loaded", () => {
    const ended: boolean[] = [];
    backend.onEnded(() => ended.push(true));

    expect(() => backend.stop()).not.toThrow();
    expect(ended).toEqual([]);
  });
});

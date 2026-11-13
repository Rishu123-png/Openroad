import { Engine } from "@babylonjs/core/Engines/engine";

/** Thrown when the browser cannot give us a usable WebGL context. */
export class GraphicsUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      "This browser could not start WebGL. Turn on hardware acceleration in the browser settings, " +
        "update the graphics driver, or try a current version of Chrome or Edge.",
      { cause },
    );
    this.name = "GraphicsUnavailableError";
  }
}

/** Creates the WebGL engine (WebGL 2 where available, falling back to WebGL 1). */
export function createEngine(canvas: HTMLCanvasElement): Engine {
  try {
    return new Engine(canvas, true, {
      // Sharp on high-DPI screens; revisit when graphics settings exist.
      adaptToDeviceRatio: true,
      powerPreference: "high-performance",
      stencil: false,
    });
  } catch (error) {
    throw new GraphicsUnavailableError(error);
  }
}

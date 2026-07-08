declare module "marzipano" {
  export class Viewer {
    constructor(element: HTMLElement, options?: Record<string, unknown>);
    createScene(options: Record<string, unknown>): { switchTo(options?: Record<string, unknown>): void };
    destroy(): void;
  }

  export class ImageUrlSource {
    static fromString(url: string): ImageUrlSource;
  }

  export class EquirectGeometry {
    constructor(levels: Array<{ width: number }>);
  }

  export class RectilinearView {
    constructor(parameters?: Record<string, number>, limiter?: unknown);
    static limit: { traditional(maxResolution: number, maxVerticalFov: number): unknown };
  }
}

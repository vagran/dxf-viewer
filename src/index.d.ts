export { DxfLoader } from './DxfLoader';

/** See TextRenderer.DefaultOptions for default values and documentation. */
export type TextRendererOptions = {
  curveSubdivision: number;
  fallbackChar: string;
};

/** See DxfScene.DefaultOptions for default values and documentation. */
export type DxfSceneOptions = {
  arcTessellationAngle: number;
  minArcTessellationSubdivisions: number;
  wireframeMesh: boolean;
  textOptions: TextRendererOptions;
};

/** See DxfLoader.DefaultOptions for default values and documentation. */
export type DxfLoaderOptions = {
  clearColor: THREE.Color;
  colorCorrection?: boolean;
  blackWhiteInversion?: boolean;
  pointSize?: number;
  sceneOptions?: DxfSceneOptions;
};

export type DxfLoaderLoadParams = {
  url: string;
  fonts: string[] | null;
  progressCbk?:
    | ((
        phase: 'font' | 'fetch' | 'parse' | 'prepare',
        processedSize: number,
        totalSize: number,
      ) => void)
    | null;
  workerFactory?: (() => Worker) | null;
};

export type LayerInfo = {
  name: string;
  color: number;
};

export type EventName = 'loaded' | 'cleared' | 'destroyed' | 'message';

export declare class DxfLoader {
  constructor(domContainer: HTMLElement, options: DxfLoaderOptions | null);
  bounds: DxfBounds;
  origin: { x: number; y: number };
  Load(params: DxfLoaderLoadParams): Promise<void>;
  GetLayers(): Iterable<LayerInfo>;
  ShowLayer(name: string, show: boolean): void;
  Clear(): void;
  Destroy(): void;
  GetScene(): THREE.Scene;
  GetOrigin(): THREE.Vector2;
  GetIsFlat(): boolean;
  Subscribe(eventName: EventName, eventHandler: (event: any) => void): void;
  Unsubscribe(eventName: EventName, eventHandler: (event: any) => void): void;
}

export declare namespace DxfLoader {
  export function SetupWorker(): void;
}

export type PatternLineDef = {
    angle: number
    base?: THREE.Vector2
    offset: THREE.Vector2
    dashes?: number[]
}

export class Pattern {
    constructor(lines: PatternLineDef[], name: string | null)

    static ParsePatFile(content: String): Pattern
}

export function RegisterPattern(pattern: Pattern, isMetric: boolean): void

/** @return {?Pattern} */
export function LookupPattern(name: string, isMetric: boolean): Pattern | null

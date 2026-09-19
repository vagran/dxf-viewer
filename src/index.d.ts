/* `three` ships no type declarations of its own, so the THREE.* types below come from
 * `@types/three`, which is a regular dependency of this package for that reason. Without this
 * import the declarations reference an unresolved namespace and fail to compile for consumers who
 * have not set `skipLibCheck`.
 */
import type * as THREE from "three"

/** See TextRenderer.DefaultOptions for default values and documentation. */
export type TextRendererOptions = {
    curveSubdivision?: number,
    fallbackChar?: string
}

/** See DxfScene.DefaultOptions for default values and documentation. */
export type DxfSceneOptions = {
    arcTessellationAngle?: number,
    minArcTessellationSubdivisions?: number,
    wireframeMesh?: boolean,
    suppressPaperSpace?: boolean,
    textOptions?: TextRendererOptions,
}

/** See DxfViewer.DefaultOptions for default values and documentation. */
export type DxfViewerOptions = {
    canvasWidth?: number,
    canvasHeight?: number,
    autoResize?: boolean,
    clearColor?: THREE.Color,
    clearAlpha?: number,
    canvasAlpha?: boolean,
    canvasPremultipliedAlpha?: boolean,
    antialias?: boolean,
    colorCorrection?: boolean,
    blackWhiteInversion?: boolean,
    pointSize?: number,
    sceneOptions?: DxfSceneOptions,
    retainParsedDxf?: boolean,
    preserveDrawingBuffer?: boolean,
    fileEncoding?: string
    renderer?: THREE.WebGLRenderer | null,
}

export type DxfViewerLoadParams = {
    url: string,
    fonts?: string[] | null,
    progressCbk?: ((phase: "font" | "fetch" | "parse" | "prepare",
                   processedSize: number, totalSize: number) => void) | null,
    workerFactory?: (() => Worker) | null
}

export type LayerInfo = {
    name: string,
    displayName: string,
    color: number
}

export type EventName = "loaded" | "cleared" | "destroyed" | "resized" | "pointerdown" |
    "pointerup" | "viewChanged" | "message"

/** A parsed DXF document. The bundled parser has no type model of its own, so its output is
 * deliberately untyped here.
 */
export type ParsedDxf = any

export declare class DxfViewer {
    constructor(domContainer: HTMLElement, options?: DxfViewerOptions | null)
    Clear(): void
    Destroy(): void
    FitView(minX: number, maxX: number, minY: number, maxY: number, padding?: number): void
    GetCamera(): THREE.OrthographicCamera
    GetCanvas(): HTMLCanvasElement
    /** The parsed document, retained only when the `retainParsedDxf` option is set. */
    GetDxf(): ParsedDxf
    GetLayers(nonEmptyOnly?: boolean): Iterable<LayerInfo>
    GetOrigin(): THREE.Vector2
    GetBounds(): {maxX: number, maxY: number, minX: number, minY: number} | null
    GetRenderer(): THREE.WebGLRenderer | null
    GetScene(): THREE.Scene
    HasRenderer(): boolean
    Load(params: DxfViewerLoadParams): Promise<void>
    Render(): void
    SetSize(width: number, height: number): void
    SetView(center: THREE.Vector3, width: number): void
    ShowLayer(name: string, show: boolean): void
    Subscribe(eventName: EventName, eventHandler: (event: any) => void): void
    Unsubscribe(eventName: EventName, eventHandler: (event: any) => void): void
}

export declare namespace DxfViewer {
    export function SetupWorker(): void

    /** Severity of a `message` event. */
    export const MessageLevel: {
        readonly INFO: "info",
        readonly WARN: "warn",
        readonly ERROR: "error"
    }

    /** Default value for each member of DxfViewerOptions. */
    export const DefaultOptions: DxfViewerOptions
}

/** Fetches and parses a DXF file. */
export declare class DxfFetcher {
    constructor(url: string, encoding?: string)
    /** `totalSize` is null for the "parse" phase, and zero when the server sends no
     * Content-Length.
     */
    Fetch(progressCbk?: ((phase: "fetch" | "parse", receivedSize: number,
                          totalSize: number | null) => void) | null): Promise<ParsedDxf>
}

export type PatternLineDef = {
    angle: number
    base?: THREE.Vector2
    offset: THREE.Vector2
    dashes?: number[]
}

export declare class Pattern {
    constructor(lines: PatternLineDef[], name?: string | null, offsetInLineSpace?: boolean)

    readonly name: string | null

    static ParsePatFile(content: string): Pattern

    /** Whether this pattern cannot be the same as `named`, comparing only what an embedded
     * definition preserves: line count, line angles and dash signs.
     */
    ContradictsNamedPattern(named: Pattern): boolean
}

export function RegisterPattern(pattern: Pattern, isMetric?: boolean): void

export function LookupPattern(name: string, isMetric?: boolean): Pattern | null

/** See TextRenderer.DefaultOptions for default values and documentation. */
export type TextRendererOptions = {
    curveSubdivision: number,
    fallbackChar: string
}

/** See DxfScene.DefaultOptions for default values and documentation. */
export type DxfSceneOptions = {
    arcTessellationAngle: number,
    minArcTessellationSubdivisions: number,
    wireframeMesh: boolean,
    textOptions: TextRendererOptions,
}

/** See DxfViewer.DefaultOptions for default values and documentation. */
export type DxfViewerOptions = {
    canvasWidth: number,
    canvasHeight: number,
    autoResize: boolean,
    clearColor: THREE.Color,
    clearAlpha: number,
    canvasAlpha: boolean,
    canvasPremultipliedAlpha: boolean,
    antialias: boolean,
    colorCorrection: boolean,
    blackWhiteInversion: boolean,
    pointSize: number,
    sceneOptions: DxfSceneOptions,
}

export type DxfViewerLoadParams = {
    url: string,
    fonts: string[] | null,
    progressCbk: ((phase: "font" | "fetch" | "parse" | "prepare",
                   processedSize: number, totalSize: number) => void) | null,
    workerFactory: (() => Worker) | null
}

export type LayerInfo = {
    name: string,
    color: number
}

export type EventName = "loaded" | "cleared" | "destroyed" | "resized" | "pointerdown" |
    "pointerup" | "viewChanged" | "message"

export declare class DxfViewer {
    constructor(domContainer: HTMLElement, options: DxfViewerOptions | null)
    HasRenderer(): boolean
    GetCanvas(): HTMLCanvasElement
    SetSize(width: number, height: number): void
    Load(params: DxfViewerLoadParams): Promise<void>
    Render(): void
    GetLayers(): Iterable<LayerInfo>
    ShowLayer(name: string, show: boolean): void
    Clear(): void
    Destroy(): void
    SetView(center: THREE.Vector3, width: number): void
    FitView(minX: number, maxX: number, minY: number, maxY: number, padding: number): void
    GetScene(): THREE.Scene
    GetCamera(): THREE.Camera
    GetOrigin(): THREE.Vector2
    Subscribe(eventName: EventName, eventHandler: (event: any) => void): void
    Unsubscribe(eventName: EventName, eventHandler: (event: any) => void): void
}

export declare namespace DxfViewer {
    export function SetupWorker(): void
}

/* An inventory of the public API as `src/index.d.ts` promises it, compiled the way a consumer
 * compiles it. Every public entry point gets at least one line here; a name that disappears from
 * the declarations, or a signature that stops matching the JavaScript, fails this file.
 *
 * Two settings carry most of the value and are deliberate:
 *
 *  - `dxf-viewer` is imported **by package name**, not by relative path, so `main`, `types` and
 *    module resolution are exercised the way they are for a consumer. A relative import would
 *    typecheck the declarations while testing none of the packaging around them.
 *  - `skipLibCheck` is **false**. It is `true` in most starter tsconfigs, which is why a broken
 *    `index.d.ts` can ship without anyone noticing.
 *
 * This file is never executed. It only has to compile.
 */
import {
    DxfViewer,
    DxfFetcher,
    Pattern,
    RegisterPattern,
    LookupPattern,
    type DxfViewerOptions,
    type DxfViewerLoadParams,
    type LayerInfo,
    type PatternLineDef
} from "dxf-viewer"

declare const container: HTMLElement

/* ---- DxfViewer: construction ---- */

const options: DxfViewerOptions = {
    canvasWidth: 800,
    autoResize: true,
    sceneOptions: {suppressPaperSpace: true, textOptions: {fallbackChar: "?"}},
    retainParsedDxf: true
}
const viewer = new DxfViewer(container, options)
new DxfViewer(container, null)
new DxfViewer(container)

/* ---- DxfViewer: instance methods ---- */

const params: DxfViewerLoadParams = {url: "/drawing.dxf", fonts: ["/Roboto.ttf"]}
viewer.Load(params).then(() => viewer.Render())

const layers: Iterable<LayerInfo> = viewer.GetLayers()
viewer.GetLayers(true)
for (const layer of layers) {
    viewer.ShowLayer(layer.name, layer.color !== 0)
}

viewer.FitView(0, 100, 0, 100)
viewer.FitView(0, 100, 0, 100, 0.2)
viewer.SetSize(640, 480)
viewer.GetCanvas()
viewer.GetCamera()
viewer.GetScene()
viewer.GetOrigin()
viewer.GetBounds()
viewer.GetRenderer()
viewer.HasRenderer()
viewer.GetDxf()
viewer.Clear()
viewer.Destroy()

const OnLoaded = (): void => {}
viewer.Subscribe("loaded", OnLoaded)
viewer.Unsubscribe("loaded", OnLoaded)

/* ---- DxfViewer: statics ---- */

DxfViewer.SetupWorker()
const level: "warn" = DxfViewer.MessageLevel.WARN
const defaults: DxfViewerOptions = DxfViewer.DefaultOptions

/* ---- DxfFetcher ---- */

new DxfFetcher("/drawing.dxf")
const fetcher = new DxfFetcher("/drawing.dxf", "windows-1252")
fetcher.Fetch()
fetcher.Fetch((phase, received, total) => console.log(phase, received, total))

/* ---- Patterns ---- */

const lineDef: PatternLineDef = {angle: 0, offset: {x: 0, y: 1} as PatternLineDef["offset"]}
new Pattern([lineDef])
const pattern = new Pattern([lineDef], "MYPATTERN")
new Pattern([lineDef], "MYPATTERN", false)
Pattern.ParsePatFile("*MYPATTERN\n0, 0,0, 0,1\n")
RegisterPattern(pattern)
RegisterPattern(pattern, true)
const found: Pattern | null = LookupPattern("ANSI31")
LookupPattern("ANSI31", false)

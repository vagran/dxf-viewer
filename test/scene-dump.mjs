/** Builds a scene from a DXF file and renders it as canonical text, for golden comparison.
 *
 * Not a test file itself; `scene.test.mjs` drives it.
 *
 * The format has two halves, because they fail for different reasons:
 *
 *  - The **batch list**, in scene order. Batches are draw calls, and their order is paint order,
 *    so this half is sensitive to batching and ordering changes and deliberately not sorted.
 *  - The **primitives**, sorted. This half says what geometry came out, independent of how it was
 *    packed. Sorting keeps an unrelated batching change from rewriting every line of it.
 *
 * Coordinates are rounded to 4 decimals. Scene vertices are float32, whose absolute error at the
 * magnitudes the fixtures use (under 100) is about 8e-6 — well inside that, so the rounding is
 * what makes the goldens stable rather than hiding anything real. Fixtures deliberately stay
 * small-coordinate for this reason; see test/fixtures/gen/generate.py.
 */
import fs from "node:fs"

import DxfParser from "../src/parser/DxfParser.js"
import {DxfScene, ColorCode} from "../src/DxfScene.js"
import {SceneReader} from "../src/SceneReader.js"
import {BatchingKey} from "../src/BatchingKey.js"

const GEOMETRY_TYPE_NAMES = Object.fromEntries(
    Object.entries(BatchingKey.GeometryType).map(([name, value]) => [value, name]))

/** @return {Promise<{}>} The serialized scene for a DXF file.
 *
 * No font fetchers are supplied, so text entities produce no geometry. Fixtures that need text
 * are not covered by this harness.
 */
export async function BuildScene(dxfPath, sceneOptions = undefined) {
    const dxf = new DxfParser().parseSync(fs.readFileSync(dxfPath, "utf-8"))
    const scene = new DxfScene(sceneOptions ? {sceneOptions} : undefined)
    await scene.Build(dxf)
    return scene.scene
}

function Num(value) {
    const rounded = Math.round(value * 1e4) / 1e4
    /* Negative zero would otherwise render as "-0" depending on which side of zero the float32
     * rounding landed. */
    return String(rounded === 0 ? 0 : rounded)
}

function Point([x, y]) {
    return `(${Num(x)}, ${Num(y)})`
}

function Color(value) {
    if (value === ColorCode.BY_LAYER) {
        return "BYLAYER"
    }
    if (value === ColorCode.BY_BLOCK) {
        return "BYBLOCK"
    }
    return (value >>> 0).toString(16).padStart(6, "0")
}

function Name(value) {
    return value === null ? "-" : JSON.stringify(value)
}

function FormatBatch(batch) {
    const key = batch.key
    const parts = [
        GEOMETRY_TYPE_NAMES[key.geometryType] ?? `UNKNOWN(${key.geometryType})`,
        `layer=${Name(key.layerName)}`,
        `block=${Name(key.blockName)}`,
        `color=${Color(key.color)}`,
        `lineType=${key.lineType ?? "-"}`
    ]
    if (batch.chunks) {
        const vertices = batch.chunks.reduce((n, c) => n + c.verticesSize, 0)
        const indices = batch.chunks.reduce((n, c) => n + c.indicesSize, 0)
        parts.push(`chunks=${batch.chunks.length}`, `vertices=${vertices}`, `indices=${indices}`)
    } else if (batch.transformsSize !== undefined) {
        parts.push(`transforms=${batch.transformsSize}`)
    } else {
        parts.push(`vertices=${batch.verticesSize}`)
    }
    return parts.join(" ")
}

/** @return {string} Canonical, newline-terminated dump of a scene. */
export function FormatDump(scene) {
    const reader = new SceneReader(scene)
    const lines = []

    const origin = reader.GetOrigin()
    lines.push(`origin ${Point([origin.x, origin.y])}`)

    const bounds = reader.GetBounds()
    lines.push(bounds === null ? "bounds -" :
               `bounds ${Point([bounds.minX, bounds.minY])} ${Point([bounds.maxX, bounds.maxY])}`)

    const layers = [...reader.GetLayers()]
    lines.push(`layers ${layers.length}`)
    for (const layer of layers) {
        lines.push(`  ${Name(layer.name)} color=${Color(layer.color)}`)
    }

    lines.push(`batches ${scene.batches.length}`)
    for (const batch of scene.batches) {
        lines.push(`  ${FormatBatch(batch)}`)
    }

    const primitives = []
    for (const primitive of reader.ReadPrimitives()) {
        primitives.push(`  ${primitive.type} layer=${Name(primitive.layer)} ` +
                        `color=${Color(primitive.color)} ` +
                        primitive.vertices.map(Point).join(" "))
    }
    primitives.sort()
    lines.push(`primitives ${primitives.length}`)
    lines.push(...primitives)

    return lines.join("\n") + "\n"
}

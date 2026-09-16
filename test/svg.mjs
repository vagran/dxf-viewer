#!/usr/bin/env node
/** Renders a DXF to SVG, for looking at.
 *
 *     npm run svg -- test/fixtures/dimension-linear.dxf
 *     npm run svg -- test-data/enterprise/turtle.dxf /tmp/turtle.svg
 *     npm run svg -- drawing.dxf out.svg --background=#fff
 *     npm run svg -- drawing.dxf out.svg --font /path/Roboto.ttf --font /path/NotoSans.ttf
 *     npm run svg -- drawing.dxf out.svg --png          # also rasterize, to actually look at it
 *
 * This is a review and debugging aid, not a test: nothing here asserts anything, and no SVG is
 * committed. The scene dumps in test/expected/ say what the geometry *is*; they cannot tell you
 * whether a drawing *looks* right, and that is the gap this fills -- without starting the example
 * project, and without a GPU.
 *
 * It renders the same primitives the dumps are built from, through SceneReader, so what it shows
 * is what the library decided to draw rather than a second opinion about the file. Anything
 * SceneReader cannot see is invisible here too: line widths, line types and paper space, none of
 * which the library implements yet.
 *
 * **Pass --font to read the text.** Without it the generated test font is used, in which every
 * glyph is a rectangle by design -- fine for asserting layout, useless for looking at. Repeat the
 * option to give a fallback chain; the library moves to the next font only for a character the
 * earlier ones have no glyph for, which is how CJK coverage is usually added.
 *
 * Because it takes any path it works on the private corpus in test-data/ as well as on fixtures --
 * which committed per-fixture SVG goldens never could, and the corpus is where the hard drawings
 * are.
 */
import fs from "node:fs"
import path from "node:path"
import {execFileSync} from "node:child_process"

import {BuildScene} from "./scene-dump.mjs"
import {SceneReader, PrimitiveType} from "../src/SceneReader.js"

/** Margin around the drawing, as a fraction of its larger side. */
const MARGIN_FRACTION = 0.02

function Luminance(color) {
    const Linear = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    return Linear(((color & 0xff0000) >>> 16) / 255) * 0.2126 +
           Linear(((color & 0xff00) >>> 8) / 255) * 0.7152 +
           Linear((color & 0xff) / 255) * 0.0722
}

/** The viewer's default color handling: `blackWhiteInversion` on, `colorCorrection` off.
 *
 * Without it a drawing is half invisible whichever background is chosen -- BYLAYER geometry is
 * white and synthesized dimensions are black. The `colorCorrection` option, which is off by
 * default in the viewer too, is not reproduced.
 */
function TransformColor(color, backgroundLuminance, invert) {
    if (!invert) {
        return color
    }
    if (color === 0xffffff && backgroundLuminance >= 0.8) {
        return 0
    }
    if (color === 0 && backgroundLuminance <= 0.2) {
        return 0xffffff
    }
    return color
}

const Hex = color => "#" + (color >>> 0).toString(16).padStart(6, "0")

const Escape = text => text.replace(/[&<>"]/g, c =>
    ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"})[c])

const USAGE = [
    "Usage: npm run svg -- <input.dxf> [output.svg] [options]",
    "",
    "  --font <path.ttf>     Font to render text with. Repeat for a fallback chain; the next",
    "                        font is used only for characters the earlier ones lack. Without",
    "                        this the generated test font is used, whose glyphs are all",
    "                        rectangles - right for asserting layout, useless for reading.",
    "  --background <color>  SVG background, default #000000 (the viewer's clear color).",
    "  --no-invert           Literal colors, without the viewer's black/white inversion.",
    "  --no-text             Supply no fonts at all, so text produces no geometry.",
    "  --stroke <width>      Line width in device pixels, default 1. Raise it for a raster:",
    "                        a 1px line lands between pixels and antialiases to a dimmer",
    "                        shade, which makes thin-line colors unreliable to judge by eye.",
    "  --png                 Also write a PNG beside the SVG, via rsvg-convert.",
    "  --width <px>          Raster width, default 1400. Implies --png.",
    "",
    "The output path is optional; it defaults to the input with a .svg extension.",
    "Both --opt=value and --opt value are accepted."
].join("\n")

/** Options take either `--opt value` or `--opt=value`; both forms turn up in habit and neither is
 * worth being strict about.
 */
function ParseArgs(argv) {
    const options = {background: "#000000", invert: true, fonts: [], noText: false,
                     stroke: 1, png: false, width: 1400, files: []}
    const VALUE_OPTIONS = new Map([
        ["--font", value => options.fonts.push(value)],
        ["--background", value => {
            options.background = value
        }],
        ["--stroke", value => {
            options.stroke = Number(value)
        }],
        ["--width", value => {
            options.width = Number(value); options.png = true
        }]
    ])

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === "--no-text") {
            options.noText = true
            continue
        }
        if (arg === "--png") {
            options.png = true
            continue
        }
        if (arg === "--no-invert") {
            options.invert = false
            continue
        }
        if (arg === "--help" || arg === "-h") {
            options.help = true
            continue
        }

        const separator = arg.indexOf("=")
        const name = arg.startsWith("--") && separator !== -1 ? arg.slice(0, separator) : arg
        const handler = VALUE_OPTIONS.get(name)
        if (handler) {
            let value
            if (separator !== -1 && name !== arg) {
                value = arg.slice(separator + 1)
            } else {
                value = argv[++i]
                if (value === undefined || value.startsWith("--")) {
                    throw new Error(`${name} needs a value`)
                }
            }
            handler(value)
            continue
        }

        if (arg.startsWith("--")) {
            throw new Error(`Unrecognized option: ${arg}`)
        }
        options.files.push(arg)
    }
    return options
}

/** Coordinates are float32, so their decimal expansion is long noise -- 3.6111111640930176 for
 * what is really 3.6111. Rounding keeps a corpus-sized drawing's file from being mostly digits.
 */
const N = value => {
    const rounded = Math.round(value * 1e4) / 1e4
    return String(rounded === 0 ? 0 : rounded)
}

/** SVG has y growing downwards and DXF upwards, so every y is negated and the view box flipped
 * with it. Doing that in the coordinates rather than with a transform keeps stroke widths and
 * `vector-effect` behaving normally.
 */
const Y = y => N(-y)

function BuildSvg(scene, {background, invert, stroke}) {
    const reader = new SceneReader(scene)
    const backgroundLuminance = Luminance(parseInt(background.replace("#", ""), 16) || 0)

    /* One path element per layer, color and kind, rather than per primitive: a corpus drawing has
     * hundreds of thousands of primitives, and an element each would be unopenable.
     */
    const groups = new Map()
    const counts = {POINT: 0, POLYLINE: 0, TRIANGLE: 0}
    let bounds = null

    for (const primitive of reader.ReadPrimitives()) {
        counts[primitive.type]++
        const color = TransformColor(primitive.color, backgroundLuminance, invert)
        const layer = primitive.layer ?? "(none)"
        const key = JSON.stringify([layer, color, primitive.type])
        let group = groups.get(key)
        if (!group) {
            group = {layer, color, type: primitive.type, parts: []}
            groups.set(key, group)
        }

        for (const [x, y] of primitive.vertices) {
            if (bounds === null) {
                bounds = {minX: x, maxX: x, minY: y, maxY: y}
            } else {
                bounds.minX = Math.min(bounds.minX, x)
                bounds.maxX = Math.max(bounds.maxX, x)
                bounds.minY = Math.min(bounds.minY, y)
                bounds.maxY = Math.max(bounds.maxY, y)
            }
        }

        if (primitive.type === PrimitiveType.POINT) {
            group.parts.push(primitive.vertices[0])
            continue
        }
        const [first, ...rest] = primitive.vertices
        group.parts.push(`M${N(first[0])} ${Y(first[1])}` +
                         rest.map(([x, y]) => `L${N(x)} ${Y(y)}`).join("") +
                         (primitive.type === PrimitiveType.TRIANGLE ? "Z" : ""))
    }

    if (bounds === null) {
        bounds = {minX: 0, maxX: 1, minY: 0, maxY: 1}
    }
    const width = Math.max(bounds.maxX - bounds.minX, Number.EPSILON)
    const height = Math.max(bounds.maxY - bounds.minY, Number.EPSILON)
    const margin = Math.max(width, height) * MARGIN_FRACTION
    const viewBox = [bounds.minX - margin, -bounds.maxY - margin,
                     width + margin * 2, height + margin * 2].map(N)
    const pointRadius = Math.max(width, height) / 500

    /* Grouped by layer so a reader can find or hide one in a browser's inspector. */
    const byLayer = new Map()
    for (const group of groups.values()) {
        if (!byLayer.has(group.layer)) {
            byLayer.set(group.layer, [])
        }
        byLayer.get(group.layer).push(group)
    }

    const out = []
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(" ")}" ` +
             "width=\"1200\" height=\"900\" preserveAspectRatio=\"xMidYMid meet\">")
    out.push(`<rect x="${viewBox[0]}" y="${viewBox[1]}" width="${viewBox[2]}" ` +
             `height="${viewBox[3]}" fill="${Escape(background)}"/>`)
    for (const [layer, layerGroups] of [...byLayer].sort((a, b) => a[0].localeCompare(b[0]))) {
        out.push(`<g data-layer="${Escape(layer)}">`)
        for (const group of layerGroups) {
            const color = Hex(group.color)
            if (group.type === PrimitiveType.POINT) {
                /* Zero-length subpaths with a round linecap render as dots, which collapses what
                 * would otherwise be one element per point -- 15k of them in some drawings -- into
                 * a single path. Stroke width is in user units here, so it scales with the view
                 * and the dots stay the same size relative to the drawing.
                 */
                const dots = group.parts
                    .map(([x, y]) => `M${N(x)} ${Y(y)}l0 0`)
                    .join("")
                out.push(`<path d="${dots}" fill="none" stroke="${color}" ` +
                         `stroke-width="${N(pointRadius * 2)}" stroke-linecap="round"/>`)
            } else if (group.type === PrimitiveType.TRIANGLE) {
                out.push(`<path d="${group.parts.join("")}" fill="${color}" stroke="none"/>`)
            } else {
                out.push(`<path d="${group.parts.join("")}" fill="none" stroke="${color}" ` +
                         `stroke-width="${N(stroke)}" vector-effect="non-scaling-stroke"/>`)
            }
        }
        out.push("</g>")
    }
    out.push("</svg>")
    return {svg: out.join("\n") + "\n", counts, groups: groups.size, layers: byLayer.size}
}

let options
try {
    options = ParseArgs(process.argv.slice(2))
} catch (error) {
    console.error(error.message)
    console.error("")
    console.error(USAGE)
    process.exit(1)
}
if (options.help || options.files.length === 0 || options.files.length > 2) {
    console.log(USAGE)
    process.exit(options.help ? 0 : 1)
}
for (const font of options.fonts) {
    if (!fs.existsSync(font)) {
        console.error(`Font not found: ${font}`)
        process.exit(1)
    }
}
const [input, output = input.replace(/\.dxf$/i, "") + ".svg"] = options.files

/* The scene build is chatty on stdout; keep the summary below readable. */
const realLog = console.log
console.log = () => {}
const scene = await BuildScene(input, {
    fonts: options.noText ? false : (options.fonts.length > 0 ? options.fonts : true)
})
console.log = realLog

const {svg, counts, groups, layers} = BuildSvg(scene, options)
fs.writeFileSync(output, svg)
console.log(`${path.relative(process.cwd(), output)}  ${(svg.length / 1024).toFixed(1)} KiB`)
console.log(`  ${counts.POLYLINE} polylines, ${counts.TRIANGLE} triangles, ${counts.POINT} points`)
console.log(`  ${groups} path elements across ${layers} layer(s)`)

if (options.png) {
    /* rsvg-convert is a system tool, not a dependency of anything here; say so plainly rather
     * than failing with an exec error. */
    const pngPath = output.replace(/\.svg$/i, "") + ".png"
    try {
        execFileSync("rsvg-convert",
                     ["-w", String(options.width), "-b", options.background, output,
                      "-o", pngPath],
                     {stdio: ["ignore", "ignore", "pipe"]})
        console.log(`${path.relative(process.cwd(), pngPath)}  ` +
                    `${(fs.statSync(pngPath).size / 1024).toFixed(1)} KiB`)
    } catch (error) {
        console.error(`Could not rasterize: ${error.message.trim().split("\n")[0]}`)
        console.error("--png needs rsvg-convert on PATH (librsvg). The SVG above was still " +
                      "written.")
        process.exit(1)
    }
}
if (counts.TRIANGLE > 0 && options.fonts.length === 0 && !options.noText) {
    console.log("  note: text rendered with the generated test font — every glyph is a " +
                "rectangle. Pass --font=<path.ttf> to read it.")
}

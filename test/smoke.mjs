#!/usr/bin/env node
/** Builds every drawing available and reports what the library complained about, plus the numbers
 * worth watching for regressions — no browser, no dev server, no clicking.
 *
 *     npm run smoke                                  # everything available
 *     npm run smoke -- test-data/enterprise/city.dxf # or an explicit list
 *     node --max-old-space-size=6144 test/smoke.mjs  # if the largest files run out of heap
 *
 * Exits non-zero if anything warned or failed validation, so it can gate a commit.
 *
 * **Corpus-optional by design.** With test-data/ present it sweeps all of it; without, it falls
 * back to test/fixtures/ and still passes. One command that is correct both for a contributor who
 * has no corpus and for a checkout that has one, so the instruction is a single line for everyone.
 * test-data/ holds customer and user-reported drawings that cannot be redistributed, so CI only
 * ever sees the fixtures — the real value of this is local, against the files that are actually
 * hard.
 *
 * **No goldens.** Everything asserted is either an invariant or a warning count, so adding a
 * drawing costs nothing: no expected output to generate, nothing to review. A file attached to a
 * bug report is covered the moment it lands in test-data/.
 *
 * The output is deliberately stable line for line: run it before a change, run it after, and
 * `diff` the two. A moved batch count on an unchanged drawing means the batching changed.
 *
 * What this is NOT: it drives DxfParser and DxfScene directly, which is the half of the pipeline
 * with no DOM. It never constructs a DxfViewer, so nothing here checks materials, shaders or
 * colors as rendered — and it passes no font fetchers, so text layout is skipped entirely. A file
 * whose only problem is text looks clean here. The example project remains the real check.
 */
import fs from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"

import DxfParser from "../src/parser/DxfParser.js"
import {DxfScene} from "../src/DxfScene.js"
import {ValidateScene} from "./validate-scene.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Prefer the real corpus; fall back to the fixtures so the command works in a bare checkout. */
function DefaultFiles() {
    for (const dirs of [["test-data", path.join("test-data", "enterprise")], ["test/fixtures"]]) {
        const files = []
        for (const dir of dirs) {
            const full = path.join(repoRoot, dir)
            if (!fs.existsSync(full)) {
                continue
            }
            for (const name of fs.readdirSync(full).sort()) {
                if (name.toLowerCase().endsWith(".dxf")) {
                    files.push(path.join(full, name))
                }
            }
        }
        if (files.length > 0) {
            return files
        }
    }
    return []
}

function FormatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KiB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/** Collapse near-identical messages so a file that warns per hatch line reports one line with a
 * count. Handles are hex and would otherwise make every message unique.
 */
function GroupMessages(messages) {
    const counts = new Map()
    for (const message of messages) {
        const key = message.replace(/\b[0-9A-Fa-f]{4,}\b/g, "#")
        counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

async function ScanFile(file) {
    const warnings = []
    const logs = []
    const real = {warn: console.warn, error: console.error, log: console.log}
    console.warn = (...args) => warnings.push(args.join(" "))
    console.error = (...args) => warnings.push(args.join(" "))
    console.log = (...args) => logs.push(args.join(" "))

    let stats = null
    let issues = []
    let error = null
    try {
        const content = fs.readFileSync(file, "utf-8")
        const parseStart = performance.now()
        const dxf = new DxfParser().parseSync(content)
        const parseMs = performance.now() - parseStart

        const buildStart = performance.now()
        const dxfScene = new DxfScene()
        /* No font fetchers: text is skipped. See the header comment. */
        await dxfScene.Build(dxf)
        const buildMs = performance.now() - buildStart

        const scene = dxfScene.scene
        issues = ValidateScene(scene)
        stats = {
            parseMs,
            buildMs,
            batches: scene.batches.length,
            layers: scene.layers.length,
            vertices: scene.vertices.byteLength,
            indices: scene.indices.byteLength,
            transforms: scene.transforms.byteLength
        }
    } catch (e) {
        error = e
    } finally {
        Object.assign(console, real)
    }
    return {warnings, logs, stats, issues, error}
}

const files = process.argv.length > 2 ? process.argv.slice(2) : DefaultFiles()
if (files.length === 0) {
    console.log("No DXF files found. Expected test-data/ or test/fixtures/ to hold some.")
    process.exit(1)
}

let badFiles = 0
for (const file of files) {
    const {warnings, logs, stats, issues, error} = await ScanFile(file)
    console.log(`\n${path.relative(repoRoot, file)}`)
    if (error) {
        console.log(`  FAILED: ${error}`)
        badFiles++
        continue
    }
    console.log(`  parse ${Math.round(stats.parseMs)} ms, build ${Math.round(stats.buildMs)} ms`)
    console.log(`  ${stats.batches} batches, ${stats.layers} layers, ` +
                `${FormatBytes(stats.vertices)} vertices, ${FormatBytes(stats.indices)} indices, ` +
                `${FormatBytes(stats.transforms)} transforms`)

    /* "Unhandled entity type" is a console.log rather than a warning, and is normal for entity
     * kinds the library does not implement — but a *new* name showing up is worth a look. */
    for (const line of [...new Set(logs.filter(l => l.startsWith("Unhandled entity type")))].sort()) {
        console.log(`  note: ${line}`)
    }

    for (const issue of issues) {
        console.log(`  INVALID: ${issue}`)
    }
    if (warnings.length === 0 && issues.length === 0) {
        console.log("  no warnings")
    }
    for (const [message, count] of GroupMessages(warnings)) {
        console.log(`  WARN x${count}: ${message}`)
    }
    if (warnings.length > 0 || issues.length > 0) {
        badFiles++
    }
}

console.log(`\n${files.length} file(s) scanned, ${badFiles} with problems`)
process.exit(badFiles > 0 ? 1 : 0)

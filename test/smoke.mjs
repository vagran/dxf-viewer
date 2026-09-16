#!/usr/bin/env node
/** Builds every drawing available and reports what the library complained about, plus the numbers
 * worth watching for regressions — no browser, no dev server, no clicking.
 *
 *     npm run smoke                                  # everything available
 *     npm run smoke -- test-data/enterprise/city.dxf # or an explicit list
 *     node --max-old-space-size=6144 test/smoke.mjs  # if the largest files run out of heap
 *
 * Exits non-zero if anything warned or failed validation, so it can gate a commit. The exception
 * is a drawing listed in expected-warnings.mjs, which exists to make a guard fire: its warning is
 * expected, and its *absence* is what fails the run.
 *
 * **Corpus-optional by design.** It sweeps test/fixtures/ plus test-data/ if there is one, and
 * skips whichever is absent. One command that is correct both for a contributor who has no corpus
 * and for a checkout that has one, so the instruction is a single line for everyone. test-data/
 * holds customer and user-reported drawings that cannot be redistributed, so CI only ever sees the
 * fixtures — the real value of this is local, against the files that are actually hard, but the
 * fixtures are swept locally too so a CI-only failure cannot hide there.
 *
 * **No goldens.** Everything asserted is either an invariant or a warning count, so adding a
 * drawing costs nothing: no expected output to generate, nothing to review. A file attached to a
 * bug report is covered the moment it lands in test-data/.
 *
 * The output is deliberately stable line for line: run it before a change, run it after, and
 * `diff` the two. A moved batch count on an unchanged drawing means the batching changed. Timings
 * are the one thing that varies between runs, so set DXF_SMOKE_NO_TIMINGS=1 to leave them out and
 * get a diff with no noise in it at all.
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
import {ExpectedWarnings} from "./expected-warnings.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Every directory swept by default, in output order. Each one is optional: whichever are present
 * are swept, so the same command is correct in a bare checkout and in one with a corpus.
 *
 * The fixtures come first so that what CI sees is a *prefix* of a local run, and the two outputs
 * can be diffed directly.
 */
const DEFAULT_DIRS = ["test/fixtures", "test-data", path.join("test-data", "enterprise")]

/** Sweep all of DEFAULT_DIRS rather than the first that exists. The fixtures are cheap — ~35 ms of
 * parse and build against the corpus's seconds — and skipping them locally means the half of the
 * sweep CI actually runs is the half nobody ever sees before pushing.
 */
function DefaultFiles() {
    const files = []
    for (const dir of DEFAULT_DIRS) {
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
    return files
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

/** Split a file's warnings against its allowlist in expected-warnings.mjs.
 *
 * @param {string[]} warnings Messages captured while building.
 * @param {string[]} expected Substrings this drawing is supposed to warn about.
 * @return {{unexpected: string[], seen: string[], missing: string[]}} `missing` holds the
 *      expected substrings that never matched, which is a regression in its own right.
 */
function PartitionWarnings(warnings, expected) {
    const unexpected = []
    const seen = []
    const missing = new Set(expected)
    for (const warning of warnings) {
        const pattern = expected.find(p => warning.includes(p))
        if (pattern === undefined) {
            unexpected.push(warning)
        } else {
            seen.push(warning)
            missing.delete(pattern)
        }
    }
    return {unexpected, seen, missing: [...missing]}
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

/* Timings are the only part of the output that changes between runs on an unchanged tree. */
const noTimings = process.env.DXF_SMOKE_NO_TIMINGS === "1"

const files = process.argv.length > 2 ? process.argv.slice(2) : DefaultFiles()
if (files.length === 0) {
    console.log(`No DXF files found. Expected some in ${DEFAULT_DIRS.join(", ")}.`)
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
    if (!noTimings) {
        console.log(`  parse ${Math.round(stats.parseMs)} ms, ` +
                    `build ${Math.round(stats.buildMs)} ms`)
    }
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

    const key = path.relative(repoRoot, file).split(path.sep).join("/")
    const {unexpected, seen, missing} = PartitionWarnings(warnings, ExpectedWarnings[key] ?? [])
    if (unexpected.length === 0 && issues.length === 0 && seen.length === 0 &&
        missing.length === 0) {
        console.log("  no warnings")
    }
    for (const [message, count] of GroupMessages(unexpected)) {
        console.log(`  WARN x${count}: ${message}`)
    }
    for (const [message, count] of GroupMessages(seen)) {
        console.log(`  expected WARN x${count}: ${message}`)
    }
    /* The guard this drawing exists to exercise did not fire. */
    for (const pattern of missing) {
        console.log(`  MISSING expected warning: ${pattern}`)
    }
    if (unexpected.length > 0 || issues.length > 0 || missing.length > 0) {
        badFiles++
    }
}

console.log(`\n${files.length} file(s) scanned, ${badFiles} with problems`)
process.exit(badFiles > 0 ? 1 : 0)

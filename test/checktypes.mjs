#!/usr/bin/env node
/** Type-checks the JSDoc in `src/` against the code it documents, and fails on the diagnostics
 * that mean a comment is wrong.
 *
 *     npm run checktypes            # gate, as CI runs it
 *     npm run checktypes -- --all   # every diagnostic, including the ungated ones
 *
 * This is `tsc --checkJs` over `src/` with `test/tsconfig.checktypes.json`, filtered. Nothing is
 * emitted and `src/index.d.ts` is not involved — `npm run typecheck` is the separate job that
 * compiles a consumer against the published declarations.
 *
 * **Why filtered.** Checking all of `src/` reports ~175 diagnostics, and the great majority say
 * the same thing: a parsed DXF entity is documented as `{object}`, because that is what it is, so
 * every property read off one is "property does not exist". Typing the DXF entity model is a real
 * project and not this one. Gating everything would mean gating nothing, so GATED lists the codes
 * where a diagnostic means the *documentation* is wrong rather than the type model being thin:
 *
 *  - `TS2304` / `TS2749` — a `@param` or `@returns` names a type that does not resolve. Always a
 *    documentation bug: the name is misspelled, the type was never defined, or it lives in another
 *    module and was never brought into scope. `@import {T} from "./m.js"` is how to bring it in —
 *    jsdoc ignores that tag and still renders the type by name, so it costs nothing.
 *  - `TS8###` — the JSDoc-specific family, `@param` naming a parameter the function does not have
 *    among them. `checkdoc` reports that one too and with a better message; this is here so the
 *    rest of the family is covered as the compiler grows it.
 *
 * Everything else is reported as a count under `--all` and never fails the run. Widening the gate
 * is a matter of moving a code into GATED once the sources are clean of it.
 *
 * **Not a replacement for `checkdoc`.** The compiler is indifferent to everything that makes a
 * comment readable rather than correct: it accepts `@param name {Type}` in either order, accepts a
 * `@param` with no type, and has its own type grammar rather than jsdoc's. The two tools overlap
 * on exactly one rule, the one noted above.
 *
 * **The grammars differ, and that matters before widening.** `TS1005`/`TS1064`/`TS2300` here are
 * almost all Closure-style `function(A): B` types, which jsdoc requires and TypeScript rejects,
 * while TypeScript's `(a: A) => B` is a hard error in jsdoc. Tuples and `import("./m.js").T` fork
 * the same way. Gating those codes means choosing TypeScript's grammar as the one the comments are
 * written in, which is a decision about which documentation generator can still read them.
 */
import {spawnSync} from "node:child_process"
import path from "node:path"
import {fileURLToPath} from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Diagnostic codes that fail the run — an unresolved type name, a value used as a type, and the
 * JSDoc-specific family. See the note above for why these and nothing else.
 */
const GATED = [/^TS2304$/, /^TS2749$/, /^TS8\d{3}$/]

/** @param {string} code Such as "TS2304".
 * @returns {boolean} True if a diagnostic with this code fails the run.
 */
function IsGated(code) {
    return GATED.some(re => re.test(code))
}

/** One line of tsc output.
 * @typedef {object} Diagnostic
 * @property {string} file Path relative to the repository root.
 * @property {number} line
 * @property {string} code Such as "TS2304".
 * @property {string} message
 */

/** Parse tsc's default (non-pretty) output.
 * @param {string} out
 * @returns {Diagnostic[]}
 */
function ParseDiagnostics(out) {
    const result = []
    for (const line of out.split("\n")) {
        const m = line.match(/^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/)
        if (m) {
            result.push({
                file: path.relative(repoRoot, path.resolve(repoRoot, m[1])),
                line: Number(m[2]),
                code: m[3],
                message: m[4]
            })
        }
    }
    return result
}

function Main() {
    const showAll = process.argv.includes("--all")
    const tsc = path.join(repoRoot, "node_modules", ".bin", "tsc")
    const project = path.join(repoRoot, "test", "tsconfig.checktypes.json")
    const run = spawnSync(tsc, ["-p", project], {cwd: repoRoot, encoding: "utf8"})

    if (run.error) {
        console.error(`Could not run tsc (${run.error.message}). Run \`npm install\` first.`)
        process.exitCode = 2
        return
    }

    const all = ParseDiagnostics((run.stdout ?? "") + (run.stderr ?? ""))
    if (all.length === 0 && run.status !== 0) {
        /* tsc failed for a reason that is not a diagnostic — a bad config, a missing file. */
        console.error(run.stdout || run.stderr || `tsc exited ${run.status}`)
        process.exitCode = 2
        return
    }

    const gated = all.filter(d => IsGated(d.code))
    const rest = all.filter(d => !IsGated(d.code))

    for (const d of gated) {
        console.log(`${d.file}:${d.line}: ${d.code}: ${d.message}`)
    }

    if (showAll) {
        console.log(`\nUngated (${rest.length}) — reported, never failed:`)
        const byCode = new Map()
        for (const d of rest) {
            byCode.set(d.code, (byCode.get(d.code) ?? 0) + 1)
        }
        for (const [code, n] of [...byCode].sort((a, b) => b[1] - a[1])) {
            console.log(`  ${String(n).padStart(4)}  ${code}`)
        }
        for (const d of rest) {
            console.log(`  ${d.file}:${d.line}: ${d.code}: ${d.message}`)
        }
    }

    if (gated.length > 0) {
        console.log(`\n${gated.length} gated diagnostic(s); ${rest.length} ungated.`)
        process.exitCode = 1
        return
    }
    console.log(`No gated diagnostics; ${rest.length} ungated ` +
                "(`npm run checktypes -- --all` lists them).")
}

Main()

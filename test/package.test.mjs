/** Checks on what the published package promises, as opposed to what it does.
 *
 * `package.json`'s `files` list means `src/` ships verbatim to consumers, who then resolve its
 * imports against whatever `dependencies` declares. A module that `src/` imports but only
 * `devDependencies` names resolves here — where dev dependencies are installed — and fails there.
 * Nothing in a normal test run notices, because a linked or locally-installed copy always has the
 * dev dependencies present.
 */
import {test} from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const srcDir = path.join(repoRoot, "src")
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"))

/** Matches the specifier of a static import/export, and of a dynamic `import()`. */
const SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g

/** @return {string[]} Every `.js` and `.d.ts` file under `src/`, as absolute paths. */
function CollectSources(dir) {
    const result = []
    for (const entry of fs.readdirSync(dir, {withFileTypes: true}).sort(
             (a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            result.push(...CollectSources(full))
        } else if (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts")) {
            result.push(full)
        }
    }
    return result
}

/** Reduce an import specifier to the package it resolves to, or null if it is not a bare one.
 *
 * "three/src/extras/ShapeUtils.js" -> "three", "@scope/pkg/sub" -> "@scope/pkg", "./x.js" -> null
 */
function PackageOf(specifier) {
    if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) {
        return null
    }
    const parts = specifier.split("/")
    return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

test("every package src/ imports is a runtime dependency", () => {
    const declared = new Set(Object.keys(pkg.dependencies ?? {}))
    const offenders = []
    for (const file of CollectSources(srcDir)) {
        const content = fs.readFileSync(file, "utf-8")
        for (const [, specifier] of content.matchAll(SPECIFIER_RE)) {
            const name = PackageOf(specifier)
            if (name !== null && !declared.has(name)) {
                offenders.push(`${path.relative(repoRoot, file)} imports "${specifier}"`)
            }
        }
    }
    assert.deepStrictEqual([...new Set(offenders)].sort(), [],
                           "shipped sources import packages missing from `dependencies`")
})

test("@types/three ships as a runtime dependency", () => {
    /* `three` ships no type declarations of its own at any version, so `src/index.d.ts` gets its
     * `THREE.*` types from `@types/three`. A declaration file's type dependencies have to be
     * regular dependencies: as a devDependency it is absent for every consumer, and `index.d.ts`
     * fails to compile for them while still compiling here. This is not covered by the check
     * above, because nothing imports `@types/three` by name — TypeScript picks it up implicitly.
     */
    assert.ok(pkg.dependencies?.["@types/three"],
              "@types/three must be in `dependencies`, not `devDependencies`")
    assert.ok(!pkg.devDependencies?.["@types/three"],
              "@types/three must not be duplicated in `devDependencies`")
})

test("files list ships the sources and the type declarations", () => {
    assert.ok(pkg.files?.includes("src"), "`files` must include src/")
    assert.ok(fs.existsSync(path.join(srcDir, "index.d.ts")), "src/index.d.ts must exist")
    assert.strictEqual(pkg.types, "src/index.d.ts", "`types` must name the declarations")
})

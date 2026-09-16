/** Every module under `src/` must be importable on its own by a native-ESM consumer.
 *
 * The package ships raw ES modules, so a browser or a plain `node` importing one file directly has
 * no bundler to paper over a mistake. Two classes of bug only appear this way:
 *
 *  - an extensionless relative specifier, which bundlers resolve silently and native ESM rejects;
 *  - a circular import whose evaluation order only works when the graph is entered through
 *    `index.js`.
 *
 * Each module is imported in its **own node process**, which is the part that matters: a single
 * process shares the module registry, so importing `DxfScene.js` first would initialize a cycle's
 * other members and hide exactly the failure this is looking for.
 */
import {test} from "node:test"
import {execFile} from "node:child_process"
import {promisify} from "node:util"
import fs from "node:fs"
import path from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const srcDir = path.join(repoRoot, "src")

/** @return {string[]} Every `.js` file under `src/`, sorted, as absolute paths. */
function CollectModules(dir) {
    const result = []
    for (const entry of fs.readdirSync(dir, {withFileTypes: true}).sort(
             (a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            result.push(...CollectModules(full))
        } else if (entry.name.endsWith(".js")) {
            result.push(full)
        }
    }
    return result
}

for (const file of CollectModules(srcDir)) {
    test(`import ${path.relative(repoRoot, file)}`, async () => {
        const url = pathToFileURL(file).href
        await execFileAsync(process.execPath,
                            ["--input-type=module", "-e", `await import(${JSON.stringify(url)})`],
                            {cwd: repoRoot})
    })
}

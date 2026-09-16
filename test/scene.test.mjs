/** Golden comparison of what DxfScene produces for each synthetic fixture.
 *
 * Every fixture in test/fixtures/ is built and dumped through SceneReader, and the result is
 * compared to test/expected/<name>.dump. To accept a deliberate change:
 *
 *     DXF_UPDATE_GOLDENS=1 npm test
 *
 * and then read the diff. A golden that is regenerated without being read is worse than no test,
 * so the dumps are written to be checkable against the generator script that produced the fixture.
 */
import {test} from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"

import {BuildScene, FormatDump} from "./scene-dump.mjs"

const testDir = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(testDir, "fixtures")
const expectedDir = path.join(testDir, "expected")

const update = process.env.DXF_UPDATE_GOLDENS === "1"

const fixtures = fs.readdirSync(fixturesDir)
    .filter(name => name.endsWith(".dxf"))
    .sort()

assert.ok(fixtures.length > 0, "no fixtures found — was test/fixtures/ generated?")

for (const fixture of fixtures) {
    const name = path.basename(fixture, ".dxf")
    test(`scene dump: ${name}`, async () => {
        const dump = FormatDump(await BuildScene(path.join(fixturesDir, fixture)))
        const goldenPath = path.join(expectedDir, `${name}.dump`)

        if (update) {
            fs.mkdirSync(expectedDir, {recursive: true})
            fs.writeFileSync(goldenPath, dump)
            return
        }

        assert.ok(fs.existsSync(goldenPath),
                  `missing golden ${path.relative(testDir, goldenPath)}; ` +
                  "run DXF_UPDATE_GOLDENS=1 npm test")
        assert.strictEqual(dump, fs.readFileSync(goldenPath, "utf-8"))
    })
}

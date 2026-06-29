import { minify } from "terser"
import { readFileSync } from "fs"

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"))
const deps = Object.keys(pkg.dependencies)

function terserPlugin() {
    return {
        name: "terser",
        async renderChunk(code, chunk, { sourcemap }) {
            const result = await minify(code, {
                module: true,
                sourceMap: sourcemap ? { asObject: true } : false
            })
            return { code: result.code, map: result.map ?? null }
        }
    }
}

export default {
    input: "src/index.js",
    external: id => deps.some(dep => id === dep || id.startsWith(dep + "/")),
    output: {
        file: "dist/dxf-viewer.js",
        format: "es",
        sourcemap: true
    },
    plugins: [terserPlugin()]
}

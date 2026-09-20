#!/usr/bin/env node
/** Checks that the JSDoc comments in src/ say what they mean to say — no browser, no corpus, no
 * dependencies.
 *
 *     npm run checkdoc                 # all of src/
 *     npm run checkdoc -- src/DxfScene.js src/TextRenderer.js
 *
 * Exits non-zero on the first file with a problem reported, so it can gate a commit.
 *
 * **Why this exists rather than jsdoc itself.** `jsdoc -X` exits non-zero on a type expression its
 * parser cannot read, and that is all it does: it accepts `@param name {Type}` as readily as
 * `@param {Type} name`, accepts a `@param` naming a parameter the function does not have, and
 * accepts one with no type at all. Every one of those renders as something wrong rather than as an
 * error, which is how `DxfViewer.Load` came to document four positional parameters for a function
 * taking one destructured object. Those are the regressions worth a gate, so the gate is here and
 * costs no devDependency.
 *
 * What is checked:
 *
 *  - Tag order is `@param {Type} name`. The inverted order jsdoc tolerates, most other generators
 *    do not: documentation.js renders the type as part of the prose.
 *  - `@returns`, never the `@return` alias, so the codebase reads one way.
 *  - Every `@param`, `@property` and `@returns` carries a type.
 *  - Type expressions avoid the constructs jsdoc's parser rejects outright — see BAD_TYPES.
 *  - A documented parameter name exists in the signature it is attached to. A destructured object
 *    is one parameter, so its fields are documented as properties of it — `@param {object} params`
 *    plus `@param {Type} params.field` — and a bare field name is reported. The wrapper name is
 *    the comment's own invention, since the parameter has none, so any name will do; a function
 *    may take several destructured objects and they are labelled in order.
 *
 * What is NOT checked: whether a parameter is documented at all. Partial documentation is normal
 * here — plenty of methods describe only the argument that is not obvious — so requiring
 * completeness would report hundreds of lines nobody intends to write. This catches what is wrong,
 * not what is missing.
 */
import fs from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Type expressions jsdoc's parser rejects, each with the form that works instead. The patterns
 * are deliberately narrow: this is not a grammar, it is a list of the mistakes this codebase has
 * actually made, and a new one should be added here when it is found rather than generalized for.
 */
const BAD_TYPES = [
    {
        pattern: /\}\s*\[\]/,
        message: "record type with a `[]` suffix; write Array<{...}> instead"
    },
    {
        pattern: /\w\[\s*\d+\s*\]/,
        message: "fixed-size array like `number[2]`; write Array<number[]> or number[] instead"
    },
    {
        pattern: /^\s*\??\s*\[[^\]]*,/,
        message: "tuple type; jsdoc has none, use Array and name the elements in the description"
    },
    {
        pattern: /\bFunction\s*</,
        message: "Function<...>; write function(ArgType): ReturnType instead"
    }
]

/** Statement keywords that a naive "name followed by (" match would otherwise take for a function
 * declaration.
 */
const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "do", "else", "with"])

/** Split on commas which are not nested inside braces, brackets or parentheses.
 * @param {string} s
 * @returns {string[]} Trimmed, with empty entries dropped.
 */
function SplitTopLevel(s) {
    const parts = []
    let depth = 0
    let cur = ""
    for (const c of s) {
        if (c === "{" || c === "[" || c === "(") {
            depth++
        } else if (c === "}" || c === "]" || c === ")") {
            depth--
        }
        if (c === "," && depth === 0) {
            parts.push(cur)
            cur = ""
        } else {
            cur += c
        }
    }
    parts.push(cur)
    return parts.map(p => p.trim()).filter(p => p !== "")
}

/** Read a balanced `{...}` or `(...)` run.
 * @param {string} s
 * @param {number} start Index of the opening delimiter.
 * @returns {?{inner: string, end: number}} Null if it never closes.
 */
function ReadBalanced(s, start) {
    const open = s[start]
    const close = open === "{" ? "}" : ")"
    let depth = 0
    for (let i = start; i < s.length; i++) {
        if (s[i] === open) {
            depth++
        } else if (s[i] === close) {
            depth--
            if (depth === 0) {
                return {inner: s.slice(start + 1, i), end: i}
            }
        }
    }
    return null
}

/** The parameters a signature actually declares, in order.
 * @param {string} sig Signature text from the name through the closing parenthesis.
 * @returns {?Array<{name: ?string, fields: ?string[]}>} One entry per parameter. A destructured
 *  object has no name of its own and carries its property names instead. Null if the text does not
 *  parse.
 */
function ParseSignature(sig) {
    const open = sig.indexOf("(")
    if (open < 0) {
        return null
    }
    const parens = ReadBalanced(sig, open)
    if (!parens) {
        return null
    }
    const params = []
    for (const part of SplitTopLevel(parens.inner)) {
        if (part.startsWith("{")) {
            const obj = ReadBalanced(part, 0)
            if (!obj) {
                return null
            }
            params.push({
                name: null,
                fields: SplitTopLevel(obj.inner)
                    .map(f => f.split(/[=:]/)[0].trim())
                    .filter(f => /^[A-Za-z_$][\w$]*$/.test(f))
            })
            continue
        }
        const name = part.replace(/^\.\.\./, "").split("=")[0].trim()
        if (/^[A-Za-z_$][\w$]*$/.test(name)) {
            params.push({name, fields: null})
        }
    }
    return params
}

/** Find the declaration a doc comment is attached to.
 * @param {string[]} lines
 * @param {number} from Index of the line after the comment's closing delimiter.
 * @returns {?string} Signature text, or null if the comment documents something else — a class, a
 *  constant, a typedef.
 */
function FindSignature(lines, from) {
    let i = from
    while (i < lines.length && lines[i].trim() === "") {
        i++
    }
    if (i >= lines.length) {
        return null
    }
    const first = lines[i]
    const m = first.match(
        /^\s*(?:export\s+)?(?:default\s+)?(?:static\s+)?(?:async\s+)?(?:function\s+)?\*?\s*([A-Za-z_$][\w$]*)\s*\(/)
    if (!m || KEYWORDS.has(m[1])) {
        return null
    }
    /* The parameter list may wrap over several lines. */
    let sig = first.slice(first.indexOf(m[1]))
    let j = i
    while (ReadBalanced(sig, sig.indexOf("(")) === null && j + 1 < lines.length) {
        j++
        sig += " " + lines[j].trim()
    }
    return ReadBalanced(sig, sig.indexOf("(")) === null ? null : sig
}

/** Pull the `{...}` type off the start of a tag's text.
 * @param {string} text Everything after the tag name.
 * @returns {?{type: string, rest: string}} Null if the text does not start with a type.
 */
function TakeType(text) {
    const s = text.trimStart()
    if (!s.startsWith("{")) {
        return null
    }
    const braced = ReadBalanced(s, 0)
    if (!braced) {
        return null
    }
    return {type: braced.inner, rest: s.slice(braced.end + 1).trim()}
}

/** One doc comment, already stripped of its delimiters and leading asterisks.
 * @typedef {object} DocBlock
 * @property {number} startLine 1-based line of the opening delimiter.
 * @property {Array<{line: number, tag: string, text: string}>} tags One entry per tag, with
 *  continuation lines folded in.
 * @property {number} afterLine 0-based index of the line following the comment.
 */

/** Extract every doc comment from a source file.
 * @param {string[]} lines
 * @returns {DocBlock[]}
 */
function ParseDocBlocks(lines) {
    const blocks = []
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trimStart().startsWith("/**")) {
            continue
        }
        const start = i
        const body = []
        let j = i
        for (; j < lines.length; j++) {
            let text = lines[j]
            if (j === start) {
                text = text.slice(text.indexOf("/**") + 3)
            }
            const close = text.indexOf("*/")
            const done = close >= 0
            if (done) {
                text = text.slice(0, close)
            }
            body.push({line: j + 1, text: text.replace(/^\s*\*/, "").trim()})
            if (done) {
                break
            }
        }
        /* Fold continuation lines into the tag they belong to. */
        const tags = []
        for (const {line, text} of body) {
            const m = text.match(/^@([A-Za-z]+)\s*(.*)$/)
            if (m) {
                tags.push({line, tag: m[1], text: m[2]})
            } else if (tags.length > 0) {
                tags[tags.length - 1].text += " " + text
            }
        }
        blocks.push({startLine: start + 1, tags, afterLine: j + 1})
        i = j
    }
    return blocks
}

/** Render a parameter list for an error message.
 * @param {Array<{name: ?string, fields: ?string[]}>} params
 * @returns {string}
 */
function DescribeParams(params) {
    return params.map(p => p.name ?? `{${p.fields.join(", ")}}`).join(", ")
}

/** Check documented parameter names against the signature.
 *
 * A destructured parameter has no name of its own, so the doc comment has to invent one, and a
 * function may take several. They are claimed in order: the first documented name that is neither
 * a real parameter nor a field labels the first destructured parameter, and so on. What that
 * ordering buys is the one case worth catching — a documented name which *is* a field of some
 * destructured parameter is the drift, because it reads as a parameter the function does not have.
 *
 * @param {Array<{name: ?string, fields: ?string[]}>} params
 * @param {Array<{line: number, name: string}>} documented In source order.
 * @param {function(number, string): void} report
 */
function CheckNames(params, documented, report) {
    const named = new Set(params.filter(p => p.name !== null).map(p => p.name))
    const objects = params.filter(p => p.fields !== null)
    const labels = new Map()
    let nextObject = 0

    const Claim = name => {
        if (nextObject >= objects.length) {
            return null
        }
        const fields = objects[nextObject].fields
        nextObject++
        labels.set(name, fields)
        return fields
    }

    for (const {line, name} of documented) {
        const [head, ...rest] = name.split(".")
        const field = rest.join(".")

        if (field === "") {
            if (named.has(head) || labels.has(head)) {
                continue
            }
            if (objects.some(o => o.fields.includes(head))) {
                report(line, `@param ${head} names a destructured field as if it were a ` +
                             `parameter — document it as \`<name>.${head}\``)
            } else if (Claim(head) === null) {
                report(line, `@param ${head} — no such parameter (has: ${DescribeParams(params)})`)
            }
            continue
        }

        /* An ordinary object parameter has an unknown shape, so only a label's fields are known
         * well enough to check.
         */
        if (named.has(head)) {
            continue
        }
        const fields = labels.get(head) ?? Claim(head)
        if (fields === null) {
            report(line, `@param ${name} — no parameter named \`${head}\``)
        } else if (!fields.includes(field)) {
            report(line, `@param ${name} — the object has no field \`${field}\``)
        }
    }
}

/** Check one source file.
 * @param {string} file Path relative to the repository root.
 * @returns {Array<{line: number, message: string}>} Problems, in line order.
 */
function CheckFile(file) {
    const lines = fs.readFileSync(path.join(repoRoot, file), "utf8").split("\n")
    const problems = []
    const report = (line, message) => problems.push({line, message})

    for (const block of ParseDocBlocks(lines)) {
        const isTypedef = block.tags.some(t => t.tag === "typedef")
        const sig = isTypedef ? null : FindSignature(lines, block.afterLine)
        const parsed = sig ? ParseSignature(sig) : null
        const documented = []

        for (const {line, tag, text} of block.tags) {
            if (tag === "return") {
                report(line, "`@return` — use `@returns`")
                continue
            }
            if (tag !== "param" && tag !== "property" && tag !== "returns") {
                continue
            }

            const taken = TakeType(text)
            if (!taken) {
                /* Either the name comes first, which is the order to catch, or there is no type. */
                const inverted = text.match(/^([A-Za-z_$][\w$.]*)\s+\{/)
                if (inverted) {
                    report(line, `@${tag} ${inverted[1]} {...} — type goes first: ` +
                                 `@${tag} {...} ${inverted[1]}`)
                } else {
                    report(line, `@${tag} has no type`)
                }
                continue
            }

            for (const {pattern, message} of BAD_TYPES) {
                if (pattern.test(taken.type)) {
                    report(line, `{${taken.type}} — ${message}`)
                    break
                }
            }

            if (tag === "param") {
                const name = taken.rest.match(/^([A-Za-z_$][\w$.]*)/)
                if (name) {
                    documented.push({line, name: name[1]})
                }
            }
        }

        if (!parsed) {
            continue
        }
        CheckNames(parsed, documented, report)
    }

    return problems.sort((a, b) => a.line - b.line)
}

/** Every .js file under a directory, recursively, in stable order.
 * @param {string} dir Path relative to the repository root.
 * @returns {string[]}
 */
function CollectFiles(dir) {
    const out = []
    for (const entry of fs.readdirSync(path.join(repoRoot, dir), {withFileTypes: true})
                          .sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            out.push(...CollectFiles(rel))
        } else if (entry.name.endsWith(".js")) {
            out.push(rel)
        }
    }
    return out
}

function Main() {
    const args = process.argv.slice(2)
    const files = args.length > 0 ? args.map(a => path.relative(repoRoot, path.resolve(a)))
                                  : CollectFiles("src")
    let total = 0
    for (const file of files) {
        const problems = CheckFile(file)
        if (problems.length === 0) {
            continue
        }
        total += problems.length
        console.log(`\n${file}`)
        for (const {line, message} of problems) {
            console.log(`  ${file}:${line}: ${message}`)
        }
    }
    if (total === 0) {
        console.log(`${files.length} file(s) checked, no problems`)
        return
    }
    console.log(`\n${total} problem(s) in ${files.length} file(s) checked`)
    process.exitCode = 1
}

Main()

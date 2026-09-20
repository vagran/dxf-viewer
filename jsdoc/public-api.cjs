/* jsdoc plugin: keep the generated documentation to the package's public API.
 *
 * jsdoc documents every symbol it is given, so pointing it at the files that hold the public
 * classes also pulls in their neighbours — `Batch`, `Block`, the `InstanceType` constants — which
 * a consumer of the package can neither reach nor use. Two rules cut it back, both applied by
 * marking the doclet private, which is what jsdoc2md already filters on:
 *
 *  - Anything whose name starts with `_`, the repository's convention for internal.
 *  - Anything not reachable from `src/index.js`, per the ROOTS list below.
 *
 * ROOTS mirrors what `src/index.d.ts` declares, which is the authoritative statement of the public
 * surface. Add an export to `src/index.js` and it needs adding here too, or it is documented
 * nowhere.
 */

/** Symbols a consumer can reach, by the root of their jsdoc longname. Members of these (
 * `DxfViewer#Load`, `Pattern.ParsePatFile`) are kept with them.
 */
const ROOTS = new Set([
    "DxfViewer",
    "DxfFetcher",
    "Pattern",
    "RegisterPattern",
    "LookupPattern",
    /* Types named in the signatures above and the enum published as `DxfViewer.MessageLevel`.
     * None of them is a member of a class, so each needs naming here.
     */
    "PatternLineDef",
    "LayerInfo",
    "Bounds",
    "MessageLevel",
    /* The nested option objects, reachable as `sceneOptions` and `sceneOptions.textOptions`. Their
     * own classes are internal, so these name the option containers alone rather than the modules
     * that hold them — hence the matching below on a whole dotted prefix, not just the first name.
     */
    "DxfScene.DefaultOptions",
    "DefaultTextOptions"
])

/** Where the option objects are documented under, keyed by where they live in the code.
 *
 * Both are reached by a consumer as a plain object handed to the viewer, never by the name their
 * module gives them, and `index.d.ts` names the resulting types `DxfSceneOptions` and
 * `TextRendererOptions`. Documenting them under those names also has to happen for
 * `DxfScene.DefaultOptions` to appear at all: its parent class is internal, so dmd has no
 * documented `DxfScene` to nest it under and drops it silently, the same way a self-parented class
 * disappears.
 */
const RENAMED = new Map([
    ["DxfScene.DefaultOptions", "DxfSceneOptions"],
    ["DefaultTextOptions", "TextRendererOptions"]
])

/** Whether a symbol belongs to the public API.
 * @param {string} longname jsdoc longname, such as `DxfViewer#Load`.
 * @returns {boolean} True for a ROOTS entry and for anything nested under one.
 */
function IsPublic(longname) {
    for (const root of ROOTS) {
        if (longname === root) {
            return true
        }
        if (longname.startsWith(root) && "#.~".includes(longname[root.length])) {
            return true
        }
    }
    return false
}

/* Both rules run in `processingComplete` rather than `newDoclet`, because `memberof` is not
 * resolved yet when `newDoclet` fires and the fix below would read undefined and do nothing.
 */
exports.handlers = {
    processingComplete({doclets}) {
        for (const doclet of doclets) {
            RepairSelfParentedClass(doclet)
            StripExportsPrefix(doclet)

            if (doclet.name && doclet.name.startsWith("_")) {
                doclet.access = "private"
                continue
            }
            if (!IsPublic(String(doclet.longname || ""))) {
                doclet.access = "private"
                continue
            }
            /* After the decision, never before it: ROOTS is written in terms of where the symbols
             * live in the code, and renaming first would leave nothing for it to match.
             */
            RehostOptionObject(doclet)
        }
    }
}

/** Work around a jsdoc/dmd interaction that otherwise drops a whole class from the output.
 *
 * When a class documents its constructor — which every public class here does — jsdoc attaches the
 * documented doclet to the constructor rather than to the class, leaving the class's own doclet
 * marked undocumented and the surviving one naming itself as its own parent. dmd then has nowhere
 * to hang it and emits the class in the index with no body at all: no constructor, no methods, no
 * warning and a zero exit status. A class with no constructor, such as the internal `Batch`,
 * documents normally, which is what makes the difference easy to miss.
 *
 * Dropping the self-reference puts the class back at the top level where dmd can render it.
 *
 * @param {object} doclet Mutated in place.
 */
function RepairSelfParentedClass(doclet) {
    if (doclet.kind !== "class" || doclet.memberof !== doclet.name) {
        return
    }
    delete doclet.memberof
    /* A class whose own declaration carries no comment, only its constructor, additionally comes
     * back scoped as an instance member of itself, with `Pattern#Pattern` for a longname.
     */
    doclet.longname = doclet.name
    doclet.scope = "global"
}

/** Drop the `exports.` that jsdoc records as the code-level name of an `export class X`.
 *
 * dmd prints that name verbatim in the constructor heading, so the rendered signature reads
 * `new exports.DxfViewer(...)` — a spelling no consumer of the package ever types.
 *
 * @param {object} doclet Mutated in place.
 */
function StripExportsPrefix(doclet) {
    const code = doclet.meta && doclet.meta.code
    if (code && typeof code.name === "string") {
        code.name = code.name.replace(/^exports\./, "")
    }
}

/** Move an option object, and its properties, to the name `index.d.ts` gives its type.
 * @param {object} doclet Mutated in place.
 */
function RehostOptionObject(doclet) {
    const longname = String(doclet.longname || "")
    for (const [from, to] of RENAMED) {
        if (longname === from) {
            doclet.longname = to
            doclet.name = to
            doclet.scope = "global"
            delete doclet.memberof
            return
        }
        if (longname.startsWith(from + ".")) {
            doclet.longname = to + longname.slice(from.length)
            doclet.memberof = to
            return
        }
    }
}

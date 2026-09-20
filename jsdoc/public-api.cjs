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
    /* Typedef behind `Pattern#lines`, and the enum published as `DxfViewer.MessageLevel`. Both are
     * declared in index.d.ts and neither is a member of a class, so they need naming here.
     */
    "PatternLineDef",
    "MessageLevel"
])

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
            const root = String(doclet.longname || "").split(/[#.~]/)[0]
            if (!ROOTS.has(root)) {
                doclet.access = "private"
            }
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

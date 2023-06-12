import * as Scheme from "./Scheme"


/** Performs parsing using the provided scheme. */
export class SchemedParser<TToken> {
    /** @param scheme - Scheme represented by root node descriptor. */
    constructor(scheme: Scheme.NodeDesc) {
        this._scheme = Scheme.BuildScheme(scheme)
    }

    /** Feed next token to the parser.
     * //XXX exceptions
     */
    Feed(token: TToken): void {
        //XXX
    }

    // /////////////////////////////////////////////////////////////////////////////////////////////
    private readonly _scheme: Scheme.SchemeNode
}

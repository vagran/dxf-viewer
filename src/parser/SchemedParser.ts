import * as Scheme from "./Scheme"

class ParsingNode<TToken> {

    /** Chain of previous uncommitted terminal nodes. Set to null when committed. Set only for
     * terminal nodes.
     */
    prev: ParsingNode<TToken> | null = null
    nextCandidates: Scheme.NodeIterator | null = null
    matchCount: number = 1
    /** Set to matched token for terminal nodes only. */
    token: TToken | null = null

    /**
     * @param node - Corresponding scheme node.
     * @param parent - Parent node, null if root.
     */
    constructor(readonly node: Scheme.SchemeNode,
                readonly parent: ParsingNode<TToken> | null = null)
    {}
}

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
        if (this._curTips.length == 0) {
            /* Initial token. */
            if (!this._MatchSchemeNode(token, this._scheme, this._curTips, null, null)) {
                throw new Error("Failed to match initial token")
            }
        } else {

        }
    }

    /** Match end-of-file. */
    Finish(): void {
        //XXX
        if (this._curTips.length == 0) {
            // Initial matching.
            if (!this._MatchSchemeNode(null, this._scheme, this._curTips, null, null)) {
                throw new Error("Failed to match empty file against the grammar")
            }
        } else {
            //XXX
        }
    }

    // /////////////////////////////////////////////////////////////////////////////////////////////
    private readonly _scheme: Scheme.SchemeNode
    private _curTips: ParsingNode<TToken>[] = []

    /** Recursively traverse the specified node and match as many terminal candidates as possible.
     * @param token - Either next token or end-of-file if null.
     * @return True if some candidates found and added.
     */
    private _MatchSchemeNode(token: TToken | null, node: Scheme.SchemeNode,
                             newTips: ParsingNode<TToken>[], parent: ParsingNode<TToken> | null,
                             prev: ParsingNode<TToken> | null, matchCount: number = 1): boolean {


    }

    /** Match token to the next nodes following the specified parsing node (previously matched). */
    private _MatchNextParsingNode(token: TToken | null, node: ParsingNode<TToken>,
                                  newTips: ParsingNode<TToken>[],
                                  parent: ParsingNode<TToken> | null,
                                  prev: ParsingNode<TToken> | null): boolean {
        let ret = false
        // First determine if current node is a subject for repetitive match and try matching if so.
        const matchCount = node.matchCount + 1
        const q = node.node.quantifier
        if (q.max <= matchCount) {
            if (this._MatchSchemeNode(token, node.node, newTips, parent, prev, matchCount)) {
                if (matchCount < q.min) {
                    // Minimal number of matches not yet reached, cannot proceed to next node.
                    return true
                }
                ret = true
            } else if (node.matchCount < q.min) {
                /* Discard this candidate branch. */
                //XXX ?
                return false
            }
        }
        if (node.nextCandidates) {

            //XXX

            return ret
        }
        
    }
}

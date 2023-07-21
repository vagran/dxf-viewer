import * as Scheme from "./Scheme"

class ParsingNode<TToken> {

    /** Chain of previous uncommitted terminal nodes. Set to null when committed. Set only for
     * terminal nodes.
     */
    prev: ParsingNode<TToken> | null = null
    nextCandidates: Scheme.NodeIterator | null = null
    matchCount: number = 1
    /** Set to matched token for terminal nodes only. Also null for terminal EOF node. */
    token: TToken | null = null

    /**
     * @param node - Corresponding scheme node.
     * @param parent - Parent node, null if root.
     */
    constructor(readonly node: Scheme.SchemeNode,
                readonly parent: ParsingNode<TToken> | null = null)
    {}
}

//XXX is needed?
class SchemeEofNode extends Scheme.SchemeNode {
    override readonly isTerminal: boolean = true
    override readonly isEof: boolean = true

    protected constructor() {
        super(null, {})
    }
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
            // Initial token.
            if (this._MatchSchemeNode(token, this._scheme, this._curTips, null, null) === null) {
                throw new Error("Failed to match initial token")
            }
        } else {
            //XXX
        }
        this._FinalizeMatching()
    }

    /** Match end-of-file. */
    Finish(): void {
        //XXX
        if (this._curTips.length == 0) {
            // Initial matching.
            if (this._MatchSchemeNode(null, this._scheme, this._curTips, null, null) === null) {
                throw new Error("Failed to match empty file against the grammar")
            }
        } else {
            //XXX
        }
        this._FinalizeMatching()
        //XXX ensure single eof node matched
        //XXX commit everything
    }

    // /////////////////////////////////////////////////////////////////////////////////////////////
    private readonly _scheme: Scheme.SchemeNode
    private _curTips: ParsingNode<TToken>[] = []

    /** Recursively traverse the specified node and match as many terminal candidates as possible.
     * @param token - Either next token or end-of-file if null.
     * @return Corresponding created parsing node if matched, null if no match.
     */
    private _MatchSchemeNode(token: TToken | null, node: Scheme.SchemeNode,
                             newTips: ParsingNode<TToken>[], parent: ParsingNode<TToken> | null,
                             prev: ParsingNode<TToken> | null,
                             matchCount: number = 1): ParsingNode<TToken> | null {

        if (node.isTerminal) {
            if (token === null) {
                return node.isEof ? new ParsingNode(node, null) : null
            }
            const terminalNode = node as Scheme.SchemeTerminalNode<any, TToken>
            if (terminalNode.Match(token)) {
                const parsingNode = new ParsingNode(node, parent)
                parsingNode.prev = prev
                parsingNode.token = token
                parsingNode.matchCount = matchCount//XXX is needed here?
                newTips.push(parsingNode)
                return parsingNode
            }
            return null
        }

        const parsingNode = new ParsingNode(node, parent)
        parsingNode.matchCount = matchCount//XXX is needed?
        const interimNode = node as Scheme.SchemeInterimNode<any>

        let lastNodeCandidate: Scheme.NodeMatchCandidate | null = null
        let lastChildParsingNode: ParsingNode<TToken> | null = null

        const SetLastCandidate = (candidate: Scheme.NodeMatchCandidate | null,
                                  parsingNode: ParsingNode<TToken> | null) => {
            if (lastNodeCandidate !== null) {
                lastChildParsingNode!.nextCandidates = lastNodeCandidate.Next(candidate !== null)
            }
            lastNodeCandidate = candidate
            lastChildParsingNode = parsingNode
        }

        for (const nextNodeCandidate of interimNode.GetIterator().GetCandidates()) {
            const childParsingNode = this._MatchSchemeNode(token, nextNodeCandidate.node, newTips,
                                                           parsingNode, prev)
            if (childParsingNode !== null) {
                SetLastCandidate(nextNodeCandidate, childParsingNode)
            }
        }

        //XXX handle zero minimal match quantifier

        if (lastNodeCandidate != null) {
            SetLastCandidate(null, null)
            return parsingNode
        }
        return null
    }

    /** Match token to the next nodes following the specified parsing node (previously matched).
     * Does not ascend to parent hierarchy.
     *
     * @return Corresponding created parsing node if matched, null if no match.
     */
    private _MatchNextParsingNode(token: TToken | null, node: ParsingNode<TToken>,
                                  newTips: ParsingNode<TToken>[],
                                  parent: ParsingNode<TToken> | null,
                                  prev: ParsingNode<TToken> | null): ParsingNode<TToken> | null {
        // First determine if current node is a subject for repetitive match and try matching if so.
        const matchCount = node.matchCount + 1
        const q = node.node.quantifier
        if (q.max <= matchCount) {
            const parsingNode = this._MatchSchemeNode(token, node.node, newTips, parent, prev,
                                                      matchCount)
            if (parsingNode !== null) {
                //XXX assign matchCount here?
                if (matchCount < q.min) {
                    // Minimal number of matches not yet reached, cannot proceed to next node.
                    return parsingNode
                }
            } else if (node.matchCount < q.min) {
                /* Discard this candidate branch. */
                //XXX ?
                return null
            }
        }
        if (node.nextCandidates) {

            //XXX

            return null
        }

        //XXX match EOF if no parent

        //XXX
        return null
    }

    _FinalizeMatching() {
        const n = this._curTips.length
        if (n > 1) {
            
        }
        //XXX exclusiveMatch fallbackMatch
        //XXX commit single chain
    }
}

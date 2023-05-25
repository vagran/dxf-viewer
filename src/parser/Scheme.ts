import Token, { TokenValue } from "./Token"

//XXX
export function OrderedGroup(...items: any): any {
    return {}
}

export function UnorderedGroup(...items: any): any {
    return {}
}

export function OneOfGroup(...items: any): any {
}

interface SchemeNodeContext {
    schemeNode: SchemeNode
    parent: SchemeNodeContext | null
}

export enum MatchResult {
    /** Node does not match. */
    NO_MATCH,
    /** Node matches. May be concurrent with other match candidates. */
    MATCH,
    /** Node matches, and all the other match candidates if any should be discarded. */
    EXCLUSIVE_MATCH
}

class Quantifier {
    constructor(public readonly min: number, public readonly max: number) {}

    static FromChar(c: string): Quantifier {
        switch (c) {
        case "?":
            return new Quantifier(0, 1)
        case "*":
            return new Quantifier(0, Infinity)
        case "+":
            return new Quantifier(1, Infinity)
        }
        throw new Error(`Bad quantifier character: ${c}`)
    }
}

interface SchemeNode {
    /** Leaf node is matched against next token. Interim node is queried for children by calling
     * its `GetNextChild()` method.
     */
    readonly isLeaf: boolean

    readonly quantifier: Quantifier
}

abstract class SchemeLeafNode implements SchemeNode {
    readonly isLeaf: boolean = true

    abstract readonly quantifier: Quantifier

    /** Match node against the current token.  */
    abstract Match(token: Token): MatchResult

    /** Apply any custom transform for the token value. Default implementation just returns
     * unchanged value.
     */
    TransformValue(value: TokenValue): any {
        return value
    }
}

abstract class SchemeInterimNode implements SchemeNode {
    readonly isLeaf: boolean = false

    abstract readonly quantifier: Quantifier

    /** Get next child nodes to match current token against.
     *
     * @param ctx - Context if node is instantiated, `undefined` if the first match attempt.
     */
    abstract GetNextChild(ctx: SchemeNodeContext | null): Generator<SchemeNode>

    /**
     * Report matched node.
     * @param ctx - Current context if not first match. It may be modified if `forkCtx` is false.
     *  Otherwise new context should be returned.
     * @param node - Matched node. One of nodes previously returned by `GetNextChild()`.
     * @param forkCtx True if new context should be created and the passed one left untouched. False
     *  if passed context may be modified.
     * @returns Context with the match applied. May be passed context if `forkCtx` is false.
     */
    abstract ReportMatch(ctx: SchemeNodeContext | null, node: SchemeNode, forkCtx: boolean):
        SchemeNodeContext
}

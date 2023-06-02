
/* ************************************************************************************************/
/* Scheme declaration stuff. */

export type NodeBaseParams = {
    /** Node quantifier. */
    q?: Quantifier | string | Array<number>
    /** Corresponding AST node is created if ID is specified. */
    id?: string,
    /** Grammar symbol ID to refer by {@link NodeRef}. */
    symbolId?: any,
    /** First candidate node which matches current token, discards all the rest candidates if any,
     * when this parameter is set.
     */
    exclusiveMatch?: boolean
}

export type NodeParams<TParams> = NodeBaseParams & TParams

export type NodeFactory<TParams> = (parent: SchemeNode | null, nodeDesc: NodeParams<TParams>) =>
    SchemeNode

export type NodeDesc = {
    factory: NodeFactory<any>

    [key: string]: any
} & NodeBaseParams

export type NodeDescFactory<TParams> = (params: NodeParams<TParams>) => NodeDesc

//XXX
export type NodeFactoryParams<T> = T extends NodeFactory<infer TParams> ? TParams : never


export interface SchemeNodeImpl<TParams> {
    new (parent: SchemeNode | null, nodeDesc: NodeParams<TParams>): SchemeNode
}

export function MakeNodeFactory<TParams>(cls: SchemeNodeImpl<TParams>): NodeDescFactory<TParams> {
    return (params: NodeParams<TParams>) => {
        return {
            factory(parent: SchemeNode | null, nodeDesc: NodeParams<TParams>): SchemeNode {
                return new cls(parent, nodeDesc)
            },
            ...params
        }
    }
}

//XXX
// export type ValueTransformer = (value: TokenValue) => any

/* ************************************************************************************************/
/* Scheme implementation. */

export class Quantifier {
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

    static SINGLE = new Quantifier(1, 1)
}

class Grammar {
    readonly symbolsRegistry = new Map<any, SchemeNode>()

    RegisterSymbol(id: any, node: SchemeNode): void {
        if (this.symbolsRegistry.has(id)) {
            throw new Error(`Duplicate grammar symbol ID: ${id}`)
        }
        this.symbolsRegistry.set(id, node)
    }

    LookupSymbol(id: any): SchemeNode {
        const node = this.symbolsRegistry.get(id)
        if (!node) {
            throw new Error(`Grammar symbol not found: ${id}`)
        }
        return node
    }
}

export abstract class SchemeNode {
    /** Leaf node is matched against next token. Interim node is queried for children by calling
     * its `GetNextChild()` method.
     */
    abstract readonly isTerminal: boolean

    readonly quantifier: Quantifier

    readonly id: string | null

    /** Defined in root node only. */
    readonly grammar?: Grammar

    constructor(readonly parent: SchemeNode | null, nodeDesc: NodeBaseParams) {
        this.id = nodeDesc.id ?? null
        if (nodeDesc.q) {
            if (nodeDesc.q instanceof Quantifier) {
                this.quantifier = nodeDesc.q
            } else if (Array.isArray(nodeDesc.q)) {
                this.quantifier = new Quantifier(nodeDesc.q[0], nodeDesc.q[1])
            } else {
                this.quantifier = Quantifier.FromChar(nodeDesc.q)
            }
        } else {
            this.quantifier = Quantifier.SINGLE
        }
        if (!parent) {
            this.grammar = new Grammar()
        }
        if (nodeDesc.symbolId !== undefined) {
            this.GetGrammar().RegisterSymbol(nodeDesc.symbolId, this)
        }
    }

    GetRoot(): SchemeNode {
        let node: SchemeNode = this
        while (node.parent) {
            node = node.parent
        }
        return node
    }

    GetGrammar(): Grammar {
        return this.GetRoot().grammar!
    }
}

export abstract class SchemeTerminalNode<TParams, TToken> extends SchemeNode {
    readonly isTerminal: boolean = true

    protected constructor(parent: SchemeNode | null, nodeDesc: NodeParams<TParams>) {
        super(parent, nodeDesc)
    }

    /** Match node against the current token.
     * @return True if token matched.
     */
    abstract Match(token: TToken): boolean

    /** Evaluate the node to provide value for corresponding AST node. */
    Evaluate(token: TToken): any {}

    /** Apply any custom transform for the token value. Default implementation just returns
     * unchanged value.
     */
    //XXX
    // TransformValue(value: TokenValue): any {
    //     return value
    // }
}

/** Represents next match candidate. */
export abstract class NodeMatchCandidate {
    abstract node: SchemeNode

    /** Advance match position to next sibling node(s).
     *
     * @param forkIterator True to fork current iterator state, advance new instance and return it.
     *  Otherwise mutate current iterator. Only one candidate can mutate current iterator. Fork can
     *  happen only before the iterator state is mutated. Violating those conditions causes state
     *  validation exception.
     * @return Iterator for iterating candidates on the next position. Null if reached end of the
     *  sequence.
     */
    abstract Next(forkIterator: boolean): NodeIterator | null


    private readonly sequence: number

    protected constructor(protected readonly iterator: NodeIterator)
    {
        this.sequence = iterator.sequence
    }

    /** Should be called by {@link Next} method implementation. */
    protected ValidateNext() {
        if (this.sequence != this.iterator.sequence) {
            throw new Error("Attempting to advance already mutated iterator")
        }
    }
}

/** Iterates next match candidates. */
export abstract class NodeIterator {
    /** Get child nodes candidates list to match current token against. */
    abstract GetCandidates(): Generator<NodeMatchCandidate>

    /** Should be incremented with each state mutation. */
    sequence: number = 0
}

export abstract class SchemeInterimNode<TParams> extends SchemeNode {
    readonly isTerminal: boolean = false

    protected constructor(parent: SchemeNode | null, nodeDesc: NodeParams<TParams>) {
        super(parent, nodeDesc)
    }

    /** Get iterator for child nodes iteration. */
    abstract GetIterator(): NodeIterator

    /** Evaluate the node to provide value for corresponding AST node. */
    //XXX child nodes evaluation results, discard/replace option
    Evaluate(): any {}
}

/**
 * Build scheme from scheme description object.
 * @param rootNodeDesc - Descriptor for scheme root node.
 * @return Scheme root node.
 */
export function BuildScheme(rootNodeDesc: NodeDesc, parent: SchemeNode | null = null): SchemeNode {
    return rootNodeDesc.factory(parent, rootNodeDesc)
}

export type OrderedGroupParams = {
    content: NodeDesc[]
}

export const OrderedGroup = MakeNodeFactory(class extends SchemeInterimNode<OrderedGroupParams> {
    private content: SchemeNode[]

    constructor(parent: SchemeNode | null, nodeDesc: NodeParams<OrderedGroupParams>) {
        super(parent, nodeDesc)
        this.content = nodeDesc.content.map(desc => BuildScheme(desc, this))
    }

    override GetIterator(): NodeIterator {
        throw new Error("Method not implemented.")
    }
})

//XXX helpers for typical iterators (e.g. single item)

export type NodeRefParams = {
    refId: any
}

export const NodeRef = MakeNodeFactory(class NodeRef extends SchemeInterimNode<NodeRefParams> {
    private ref: SchemeNode

    constructor(parent: SchemeNode | null, nodeDesc: NodeParams<NodeRefParams>) {
        super(parent, nodeDesc)
        this.ref = this.GetGrammar().LookupSymbol(nodeDesc.refId)
    }

    override GetIterator(): NodeIterator {
        //XXX
        throw new Error("Method not implemented.")
    }
})

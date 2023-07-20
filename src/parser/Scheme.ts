
/* ************************************************************************************************/
/* Scheme declaration stuff. */

export type NodeBaseParams = {
    /** Grammar node name, mostly for debugging. */
    nodeName?: string
    /** Node quantifier. */
    q?: Quantifier | string | Array<number>
    /** Corresponding AST node is created if ID is specified. */
    id?: string
    /** Grammar symbol ID to refer by {@link NodeRef}. */
    symbolId?: any
    /** First candidate node which matches current token, discards all the rest candidates if any,
     * when this parameter is set.
     */
    exclusiveMatch?: boolean
    /** This node is discarded if any of other candidates matches. */
    fallbackMatch?: boolean
}

export type NodeParams<TParams> = NodeBaseParams & TParams

export type NodeFactory<TParams> = (parent: SchemeNode | null, nodeDesc: NodeParams<TParams>) =>
    SchemeNode

export type NodeDesc = {
    factory: NodeFactory<any>

    [key: string]: any
} & NodeBaseParams

export type NodeDescFactory<TParams> = (params?: NodeParams<TParams>) => NodeDesc

//XXX
export type NodeFactoryParams<T> = T extends NodeFactory<infer TParams> ? TParams : never


export interface SchemeNodeImpl<TParams> {
    new (parent: SchemeNode | null, nodeDesc: NodeParams<TParams>): SchemeNode
}

export function MakeNodeFactory<TParams>(cls: SchemeNodeImpl<TParams>): NodeDescFactory<TParams> {
    return (params?: NodeParams<TParams>) => {
        return {
            nodeName: cls.name,
            factory(parent: SchemeNode | null, nodeDesc: NodeParams<TParams>): SchemeNode {
                return new cls(parent, nodeDesc)
            },
            factoryCls: cls,
            ...params
        }
    }
}

/* ************************************************************************************************/
/* Scheme implementation. */

export class Quantifier {
    constructor(public readonly min: number, public readonly max: number) {
        if (max < min) {
            throw new Error(`Bad quantifier: max < min (${max} < ${min})`)
        }
        if (max < 1) {
            throw new Error(`Bad quantifier: max < 1 (${max})`)
        }
    }

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
    /** End of file marker node. */
    readonly isEof: boolean = false //XXX is needed?

    readonly quantifier: Quantifier

    readonly id: string | null

    /** Grammar node name, mostly for debugging. */
    readonly nodeName: string | null

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
        this.nodeName = nodeDesc?.nodeName ?? null
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

    //XXX Evaluate()?
}

export abstract class SchemeTerminalNode<TParams, TToken> extends SchemeNode {
    override readonly isTerminal: boolean = true

    protected constructor(parent: SchemeNode | null, nodeDesc: NodeParams<TParams>) {
        super(parent, nodeDesc)
    }

    /** Match node against the current token.
     * @return True if token matched.
     */
    abstract Match(token: TToken): boolean

    /** Evaluate the node to provide value for corresponding AST node. */
    Evaluate(token: TToken): any {}
}

/** Represents next match candidate. */
export abstract class NodeMatchCandidate {
    abstract readonly node: SchemeNode

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
    override readonly isTerminal: boolean = false

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
export function BuildScheme(rootNodeDesc: NodeDesc, parent: SchemeNode | null = null,
                            overrideProps?: NodeBaseParams): SchemeNode {
    let desc
    if (overrideProps) {
        desc = Object.assign({}, rootNodeDesc)
        Object.assign(desc, overrideProps)
    } else {
        desc = rootNodeDesc
    }
    return desc.factory(parent, desc)
}

/** Helper for iterator which iterates single node. */
class SingleNodeIterator extends NodeIterator {
    constructor(private node: SchemeNode) {
        super()
        const iterator = this
        this.candidate = new class SingleNodeCandidate extends NodeMatchCandidate {
            override readonly node: SchemeNode

            constructor() {
                super(iterator)
                this.node = iterator.node
            }

            override Next(_forkIterator: boolean): NodeIterator | null {
                this.ValidateNext()
                return null
            }
        }
    }

    override *GetCandidates(): Generator<NodeMatchCandidate> {
        if (this.sequence == 0) {
            yield this.candidate
        }
    }

    private readonly candidate: NodeMatchCandidate
}

// /////////////////////////////////////////////////////////////////////////////////////////////////


class OrderedGroupIterator extends NodeIterator {
    constructor(private readonly content: SchemeNode[], sequence: number = 0) {
        super()
        this.sequence = sequence
    }

    *GetCandidates(): Generator<NodeMatchCandidate> {
        if (this.sequence >= this.content.length) {
            throw new Error("Iteration out of range")
        }
        const iterator = this
        yield new class extends NodeMatchCandidate {
            override node: SchemeNode

            override Next(forkIterator: boolean): NodeIterator | null {
                this.ValidateNext()
                if (iterator.sequence == iterator.content.length - 1) {
                    return null
                }
                if (forkIterator) {
                    return new OrderedGroupIterator(iterator.content, iterator.sequence + 1)
                }
                iterator.sequence++
                return iterator
            }

            constructor() {
                super(iterator)
                this.node = iterator.content[iterator.sequence]
            }
        }
    }
}

export type OrderedGroupParams = {
    content: NodeDesc[]
}

export const OrderedGroup = MakeNodeFactory(class OrderedGroup
    extends SchemeInterimNode<OrderedGroupParams> {

    private content: SchemeNode[]

    constructor(parent: SchemeNode | null, nodeDesc: NodeParams<OrderedGroupParams>) {
        super(parent, nodeDesc)
        if (nodeDesc.content.length == 0) {
            throw new Error("Empty group content")
        }
        this.content = nodeDesc.content.map(desc => BuildScheme(desc, this))
    }

    override GetIterator(): NodeIterator {
        return new OrderedGroupIterator(this.content)
    }
})


class UnorderedGroupIterator extends NodeIterator {
    constructor(private readonly content: SchemeNode[],
                private readonly fallback: SchemeNode | null,
                sequence: number = 0) {
        super()
        this.sequence = sequence
    }

    *GetCandidates(): Generator<NodeMatchCandidate> {
        const iterator = this
        for (let idx = 0; idx < this.content.length; idx++) {
            yield new class extends NodeMatchCandidate {
                override node: SchemeNode

                override Next(forkIterator: boolean): NodeIterator | null {
                    this.ValidateNext()
                    if (iterator.content.length <= 1) {
                        return null
                    }
                    if (forkIterator) {
                        return new UnorderedGroupIterator(
                            iterator.content.slice().splice(this.idx, 1),
                            iterator.fallback,
                            iterator.sequence + 1)
                    }
                    iterator.content.splice(this.idx, 1)
                    iterator.sequence++
                    return iterator
                }

                constructor(idx: number) {
                    super(iterator)
                    this.idx = idx
                    this.node = iterator.content[idx]
                }

                private readonly idx: number
            }(idx)
        }
        if (this.fallback) {
            yield new class extends NodeMatchCandidate {
                override node: SchemeNode

                override Next(forkIterator: boolean): NodeIterator | null {
                    this.ValidateNext()
                    if (forkIterator) {
                        return new UnorderedGroupIterator(
                            iterator.content.slice(),
                            iterator.fallback,
                            iterator.sequence + 1)
                    }
                    iterator.sequence++
                    return iterator
                }

                constructor() {
                    super(iterator)
                    this.node = iterator.fallback!
                }
            }
        }
    }
}

export type UnorderedGroupParams = {
    content: NodeDesc[],
    /** Try to match to this node if neither of the candidates from content matches. */
    fallback?: NodeDesc
}

export const UnorderedGroup = MakeNodeFactory(class UnorderedGroup
    extends SchemeInterimNode<UnorderedGroupParams> {

    private content: SchemeNode[]
    private fallback: SchemeNode | null

    constructor(parent: SchemeNode | null, nodeDesc: NodeParams<UnorderedGroupParams>) {
        super(parent, nodeDesc)
        if (nodeDesc.content.length == 0) {
            throw new Error("Empty group content")
        }
        this.content = nodeDesc.content.map(desc => BuildScheme(desc, this))
        this.fallback = nodeDesc.fallback ?
            BuildScheme(nodeDesc.fallback, this, {fallbackMatch: true}) : null
    }

    override GetIterator(): NodeIterator {
        return new UnorderedGroupIterator(this.content, this.fallback)
    }
})


class OneOfGroupIterator extends NodeIterator {
    constructor(private readonly content: SchemeNode[]) {
        super()
    }

    *GetCandidates(): Generator<NodeMatchCandidate> {
        const iterator = this
        for (const node of this.content) {
            yield new class extends NodeMatchCandidate {
                override Next(_forkIterator: boolean): NodeIterator | null {
                    this.ValidateNext()
                    return null
                }

                constructor(override node: SchemeNode) {
                    super(iterator)
                }
            }(node)
        }
    }
}

export type OneOfGroupParams = {
    content: NodeDesc[]
}

export const OneOfGroup = MakeNodeFactory(class OneOfGroup
    extends SchemeInterimNode<OneOfGroupParams> {

    private content: SchemeNode[]

    constructor(parent: SchemeNode | null, nodeDesc: NodeParams<UnorderedGroupParams>) {
        super(parent, nodeDesc)
        if (nodeDesc.content.length == 0) {
            throw new Error("Empty group content")
        }
        this.content = nodeDesc.content.map(desc => BuildScheme(desc, this))
    }

    override GetIterator(): NodeIterator {
        return new OneOfGroupIterator(this.content)
    }
})


export type NodeRefParams = {
    refId: any
}

export const NodeRef = MakeNodeFactory(class NodeRef extends SchemeInterimNode<NodeRefParams> {

    constructor(parent: SchemeNode | null, nodeDesc: NodeParams<NodeRefParams>) {
        super(parent, nodeDesc)
        this.iterator = new SingleNodeIterator(this.GetGrammar().LookupSymbol(nodeDesc.refId))
    }

    override GetIterator(): NodeIterator {
        return this.iterator
    }

    private readonly iterator: SingleNodeIterator
})

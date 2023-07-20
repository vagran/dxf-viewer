import * as Scheme from "./Scheme"
import {OrderedGroup, UnorderedGroup, OneOfGroup} from "./Scheme"
import Token, {TokenValue} from "./Token"


export type ValueTransformer = (value: TokenValue) => any

type TagNodeParams = {
    code: number,
    /** Match specific value only if specified. Value is compared before transformation applied. */
    value?: any,
    valueTransformer?: ValueTransformer
}

/** Matches tag with the specified code. */
const Tag = Scheme.MakeNodeFactory(class Tag extends
    Scheme.SchemeTerminalNode<TagNodeParams, Token> {

    constructor(parent: Scheme.SchemeNode | null, nodeDesc: Scheme.NodeParams<TagNodeParams>) {
        super(parent, nodeDesc)
        this.code = nodeDesc.code
        this.value = nodeDesc.value
        this.valueTransformer = nodeDesc.valueTransformer ?? null
    }

    override Match(token: Token): boolean {
        return token.code === this.code && (this.value === undefined || this.value == token.value)
    }

    override Evaluate(token: Token): any {
        if (this.valueTransformer) {
            return this.valueTransformer(token.value)
        }
        return token.value
    }

    private readonly code: number
    private readonly value?: any
    private readonly valueTransformer: ValueTransformer | null
})


type EntityNodeParams = {
    name: string
}

function Entity(params: Scheme.NodeParams<EntityNodeParams>): Scheme.NodeDesc {
    return Tag({
        ...params,
        code: 0,
        value: params.name
    })
}


/** Matches (and discards) any tag. */
const AnyTag = Scheme.MakeNodeFactory(class AnyTag extends
    Scheme.SchemeTerminalNode<{}, Token> {

    constructor(parent: Scheme.SchemeNode | null, nodeDesc: Scheme.NodeParams<{}>) {
        super(parent, nodeDesc)
    }

    override Match(_token: Token): boolean {
        return true
    }
})


type SectionNodeParams = {
    name?: string
    content: Scheme.NodeDesc
}

/** Matches section with the specified name. */
function Section(params: Scheme.NodeParams<SectionNodeParams>): Scheme.NodeDesc {
    return OrderedGroup({
        nodeName: "Section",
        ...params,
        content: [
            Entity({name: "SECTION"}),
            Tag({code: 2, id: "name", exclusiveMatch: true}),
            params.content,
            Entity({name: "ENDSEC", exclusiveMatch: true})
        ]
    })
}


function AnySection(params?: Scheme.NodeParams<{}>): Scheme.NodeDesc {
    return Section({
        nodeName: "AnySection",
        ...params,
        content: AnyTag({q: "*"})
    })
}


type VectorNodeParams = {
    /** First component group code. 10 by default. */
    startCode?: number
}

function Vector(params?: Scheme.NodeParams<VectorNodeParams>): Scheme.NodeDesc {
    const startCode = params?.startCode ?? 10
    return OrderedGroup({
        nodeName: "Vector",
        ...params,
        content: [
            Tag({code: startCode, id: "x"}),
            Tag({code: startCode + 10, id: "y"}),
            Tag({code: startCode + 20, id: "z", q: "?"}),
        ]
    })
}

const scheme: Scheme.NodeDesc = OrderedGroup({
    content: [
        UnorderedGroup({
            /* Sections in any order. */
            //XXX requireAll
            content: [
                Section({
                    name: "Header",
                    content: OrderedGroup({
                            q: "*",
                            id: "var",
                            content: [
                                Tag({
                                    code: 9,
                                    id: "name"
                                }),
                                OneOfGroup({
                                    id: "value",
                                    content: [
                                        Vector(),
                                        AnyTag()
                                    ]
                                })
                            ]
                        })
                    }),
                Section({name: "BLOCKS", content: AnyTag()})
            ],
            fallback: AnySection()
        }),

        Entity({name: "EOF", exclusiveMatch: true})
    ]
})

export default scheme

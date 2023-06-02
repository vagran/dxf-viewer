import * as Scheme from "./Scheme"
import {OrderedGroup} from "./Scheme"
import Token, {TokenValue} from "./Token"


type EntityNodeParams = {
    name: string
}

/** Matches entity group (code 0) with the specified name. */
const Entity = Scheme.MakeNodeFactory(class Entity extends Scheme.SchemeTerminalNode<EntityNodeParams> {
    private readonly name: string

    constructor(parent: Scheme.SchemeNode | null, nodeDesc: Scheme.NodeParams<EntityNodeParams>) {
        super(parent, nodeDesc)
        this.name = nodeDesc.name
    }

    override Match(token: Token): Scheme.MatchResult {
        if (token.code === 0 && token.value === this.name) {
            return Scheme.MatchResult.MATCH
        }
        return Scheme.MatchResult.NO_MATCH
    }
})

type TagNodeParams = {
    code: number
    valueTransformer?: Scheme.ValueTransformer
}

/** Matches tag with the specified code. */
const Tag = Scheme.MakeNodeFactory(class Tag extends Scheme.SchemeTerminalNode<TagNodeParams> {
    private readonly code: number
    private readonly valueTransformer: Scheme.ValueTransformer | null

    constructor(parent: Scheme.SchemeNode | null, nodeDesc: Scheme.NodeParams<TagNodeParams>) {
        super(parent, nodeDesc)
        this.code = nodeDesc.code
        this.valueTransformer = nodeDesc.valueTransformer ?? null
    }

    override Match(token: Token): Scheme.MatchResult {
        if (token.code === this.code) {
            return Scheme.MatchResult.MATCH
        }
        return Scheme.MatchResult.NO_MATCH
    }

    override TransformValue(value: TokenValue): any {
        if (this.valueTransformer) {
            return this.valueTransformer(value)
        }
        return value
    }
})

type SectionNodeParams = {
    name: string
    content: Scheme.NodeDesc
}

/** Matches tag with the specified code. */
function Section(params: Scheme.NodeParams<SectionNodeParams>): Scheme.NodeDesc {
    return OrderedGroup({
        ...params,
        content: [
            Entity({name: "SECTION"}),
            Tag({code: 2, id: "name"}),
            params.content,
            Entity({name: "ENDSEC"})
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
                                        Vector(10),
                                        AnyTag
                                    ]
                                })
                            ]
                        })
                    }),
                Section({name: "BLOCKS"})
            ],
            fallback: AnySection
        }),

        Entity({name: "EOF"})
    ]
})

export default scheme

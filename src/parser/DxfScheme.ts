import { OrderedGroup, UnorderedGroup, OneOfGroup } from "./Scheme"

const scheme = {
    type: OrderedGroup,
    content: [{
        /* Sections in any order. */
        type: UnorderedGroup, //XXX requireAll
        content: [{
            type: Section("HEADER"),
            content: {
                type: OrderedGroup,
                q: "*",
                id: "var",
                content: [{
                    type: Tag(9),
                    id: "name"
                },
                {
                    type: OneOfGroup,
                    id: "value",
                    content: [{
                        type: Vector(10)
                    }, {
                        type: AnyTag
                    }]
                }]
            }
        }, {
            type: Section("BLOCKS")

        }],
        fallback: {
            type: AnySection
        }
    }, {
        type: Entity("EOF")
    }]
}

export default scheme

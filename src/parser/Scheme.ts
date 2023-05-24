import Group from "./Group"

//XXX
export function OrderedGroup(...items: any): any {
    return {}
}

export function UnorderedGroup(...items: any): any {
    return {}
}

export function OneOfGroup(...items: any): any {
}

interface ContextNode {
    schemeNode: SchemeNode
    parent: ContextNode | null
}

interface SchemeNode {
    Match(group: Group): ContextNode | null
}

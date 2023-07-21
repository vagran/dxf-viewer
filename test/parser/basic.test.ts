import * as Scheme from "@/parser/Scheme"
import {OrderedGroup, UnorderedGroup, OneOfGroup} from "@/parser/Scheme"
import { SchemedParser } from "@/parser/SchemedParser"





describe("Simple name-value format", () => {

    /* Implements parsing of name:number_value strings.
     */

    type CharNodeParams = {
        /* Match specific value only if specified. */
        value?: string | ((value: string) => boolean)
    }

    const Char = Scheme.MakeNodeFactory(class Char extends
        Scheme.SchemeTerminalNode<CharNodeParams, string> {

        constructor(parent: Scheme.SchemeNode | null, nodeDesc: Scheme.NodeParams<CharNodeParams>) {
            super(parent, nodeDesc)
            this.value = nodeDesc.value
        }

        override Match(token: string): boolean {
            if (this.value === undefined) {
                return true
            }
            if (typeof this.value === "string") {
                return token === this.value
            }
            return this.value(token)
        }

        override Evaluate(token: string): string {
            return token
        }

        private readonly value?: string | ((value: string) => boolean)
    })

    function SymbolStartChar(params: Scheme.NodeParams = {}): Scheme.NodeDesc {
        return Char({
            ...params,
            nodeName: "SymbolStartChar",
            value(c: string) {
                return c == "_" || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z")
            }
        })
    }

    function SymbolChar(params: Scheme.NodeParams): Scheme.NodeDesc {
        return Char({
            ...params,
            nodeName: "SymbolChar",
            value(c: string) {
                return c == "_" || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") ||
                    (c >= "0" && c <= "9")
            }
        })
    }

    function Symbol(params: Scheme.NodeParams = {}): Scheme.NodeDesc {
        return OrderedGroup({
            ...params,
            content: [
                SymbolStartChar(),
                SymbolChar({q: "*"})
            ]
        })
    }

    function NumberChar(params: Scheme.NodeParams): Scheme.NodeDesc {
        return Char({
            ...params,
            nodeName: "SymbolStartChar",
            value(c: string) {
                return  c >= "0" && c <= "9"
            }
        })
    }

    function Number(params: Scheme.NodeParams = {}): Scheme.NodeDesc {
        return Scheme.WrapNode({
            ...params,
            content: NumberChar({q: "+"})
        })
    }

    const scheme = OrderedGroup({
        q: "*",
        content: [
            Symbol(),
            Char({value: ":"}),
            Number(),
            Char({value: "\n"})
        ]
    })

    let parser= new SchemedParser(scheme)

    function Parse(text: string) {
        for (const c of text) {
            parser.Feed(c)
        }
        parser.Finish()
    }

    beforeEach(() => {
        parser= new SchemedParser(scheme)
    })

    test("Empty file", () => {
        Parse("")
    })
})

import "dxf-parser"
import DxfParser from "dxf-parser";

/** This class implements proper loading of DXF files. It ensures the event loop is not blocked and
 * a page remains responsive even for huge files. The result is "dxf-parser" output.
 */
export class DxfFetcher {
    constructor(url) {
        this.url = url
    }

    async Fetch() {
        const response = await fetch(this.url)
        const totalSize = +response.headers.get('Content-Length')

        const reader = response.body.getReader()
        let receivedSize = 0
        //XXX streaming parsing is not supported in dxf-parser for now (its parseStream() method
        // just accumulates chunks in a string buffer before parsing. Fix it later.
        let chunks = []
        while(true) {
            const {done, value} = await reader.read()
            if (done) {
                break
            }
            chunks.push(value)
            receivedSize += value.length
            //XXX progress receivedSize
            // console.log(`Received ${receivedSize} of ${totalSize}`)
        }

        const binData = new Uint8Array(receivedSize)
        let position = 0
        for(let chunk of chunks) {
            binData.set(chunk, position)
            position += chunk.length
        }
        const text = new TextDecoder("utf-8").decode(binData)

        console.log("Parsing started")//XXX
        const parser = new DxfParser()
        const dxf = parser.parseSync(text)
        console.log("Parsing done")//XXX
        return dxf
    }
}
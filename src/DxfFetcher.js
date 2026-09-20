import DxfParser from "./parser/DxfParser.js"

/** Fetches and parses DXF file. */
export class DxfFetcher {
    /** @param {string} url DXF file URL.
     * @param {string} encoding Encoding to decode the file with.
     */
    constructor(url, encoding = "utf-8") {
        this.url = url
        this.encoding = encoding
    }

    /** Fetch the file and parse it. The result is the same parsed document `DxfViewer` works
     * from, so this is the way to read a drawing without rendering it.
     *
     * @param {?Function} progressCbk Called as (phase, receivedSize, totalSize) while the file is
     *  read. Phase is "fetch" while downloading and "parse" once parsing starts.
     * @returns {Promise<object>} The parsed document. Rejects on an HTTP error or a parse failure.
     */
    async Fetch(progressCbk = null) {
        const response = await fetch(this.url)
        /* Without this the error body is fed to the parser as if it were a drawing, and an HTTP
         * failure is reported as "Cannot parse group code: <!DOCTYPE html>" or "Empty file".
         */
        if (!response.ok) {
            throw new Error(`Failed to fetch DXF file: HTTP ${response.status} ` +
                            `${response.statusText}`)
        }
        const totalSize = +response.headers.get("Content-Length")

        const reader = response.body.getReader()
        let receivedSize = 0
        //XXX streaming parsing is not supported in dxf-parser for now (its parseStream() method
        // just accumulates chunks in a string buffer before parsing. Fix it later.
        let buffer = ""
        let decoder = new TextDecoder(this.encoding)
        while (true) {
            const {done, value} = await reader.read()
            if (done) {
                buffer += decoder.decode(new ArrayBuffer(0), {stream: false})
                break
            }
            buffer += decoder.decode(value, {stream: true})
            receivedSize += value.length
            if (progressCbk !== null) {
                progressCbk("fetch", receivedSize, totalSize)
            }
        }

        if (progressCbk !== null) {
            progressCbk("parse", 0, null)
        }
        const parser = new DxfParser()
        return parser.parseSync(buffer)
    }
}

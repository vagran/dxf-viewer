/** Options for {@link DxfParser} construction. */
export class DxfParserOptions {
    /** Encoding label.
     * See https://developer.mozilla.org/en-US/docs/Web/API/Encoding_API/Encodings
     */
    encoding: string = "utf-8"
    /** Throw `TypeError` when encountering invalid encoded data when true. When false, the decoder
     * will substitute malformed data with a replacement character.
     */
    encodingFailureFatal: boolean = false
}

/**
 * DXF file stream parser. It can accept stream of input data and outputs stream of parsed entities.
 * The output stream consumer is free to build some hierarchical parsed file structure or process
 * parsed entities on the fly, thus making memory consumption independent on input file size.
 */
export class DxfParser extends EventTarget {

    constructor(options: DxfParserOptions = new DxfParserOptions()) {
        super()
        this._decoder = new TextDecoder(options.encoding, {
            fatal: options.encodingFailureFatal
        })
    }

    /** Feed next chunk to the parser.
     * @param input Next chunk of data. Can be null for final call.
     * @param isFinalChunk Set to true when final chunk is fed. `input` can be null in such case.
     */
    Feed(input: BufferSource | null, isFinalChunk = false) {
        const s = this._decoder.decode(input ?? undefined, {stream: !isFinalChunk})
        this.FeedString(s, isFinalChunk)
    }

    /** Feed next string chunk to the parser. */
    FeedString(input: string, isFinalChunk = false) {
        if (this._finalChunkSeen) {
            throw new Error("Data fed after final chunk processed")
        }
        if (isFinalChunk) {
            this._finalChunkSeen = true
        }
        //XXX
    }

    /** Feed entire `File` object to the parser.
     * @param abortSignal Optional abort signal which can interrupt the file feeding.
     */
    async FeedFile(file: File, abortSignal?: AbortSignal) {
        const size = file.size
        const CHUNK_SIZE = 0x10000
        for (let offset = 0; offset < size; offset += CHUNK_SIZE) {
            abortSignal?.throwIfAborted()
            const chunkSize = Math.min(size - offset, CHUNK_SIZE)
            const buf = await file.slice(offset, offset + chunkSize).arrayBuffer()
            this.Feed(buf, offset + chunkSize >= size)
        }
    }

    //XXX progress event

    // /////////////////////////////////////////////////////////////////////////////////////////////

    _decoder: TextDecoder
    _finalChunkSeen: boolean = false
}

import Token from "./Token"
import { GetLogger } from "@/Log"
import dxfScheme from "./DxfScheme"
import { SchemedParser } from "./SchemedParser"

const log = GetLogger("Parser")

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


export class DxfParsingError extends Error {
    readonly line: number

    constructor(msg: string, line: number, options?: ErrorOptions) {
        super(`[Line ${line}]: ${msg}`, options)
        this.line = line
    }
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
        this._schemedParser = new SchemedParser(dxfScheme)
    }

    /** Feed next chunk to the parser.
     * @param input - Next chunk of data. Can be null for final call.
     * @param isFinalChunk - Set to true when final chunk is fed. `input` can be null in such case.
     */
    Feed(input: BufferSource | null, isFinalChunk = false): void {
        const s = this._decoder.decode(input ?? undefined, {stream: !isFinalChunk})
        this.FeedString(s, isFinalChunk)
    }

    /** Feed next string chunk to the parser. */
    FeedString(input: string, isFinalChunk = false): void {
        if (this._finalChunkSeen) {
            throw new Error("Data fed after final chunk processed")
        }
        if (isFinalChunk) {
            this._finalChunkSeen = true
        }
        this._curChunk += input
        this._ProcessCurChunk()
        if (isFinalChunk) {
            this._Finalize()
        }
    }

    /** Feed entire `File` object to the parser.
     * @param abortSignal - Optional abort signal which can interrupt the file feeding.
     */
    async FeedFile(file: File, abortSignal?: AbortSignal): Promise<void> {
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

    private readonly _decoder: TextDecoder
    private _finalChunkSeen: boolean = false
    private _curChunk: string = ""
    private _curGroupCode: number | null = null
    private _curLineNum = 1
    private readonly _schemedParser: SchemedParser<Token>


    _ProcessCurChunk(): void {
        for (const s of this._ConsumeCurChunkLines()) {
            this._ProcessLine(s)
            this._curLineNum++
        }
    }

    /** Iterate all complete lines in the current chunk. The consumed lines are stripped from the
     * chunk.
     */
    *_ConsumeCurChunkLines(): IterableIterator<string> {
        let pos = 0
        const n = this._curChunk.length
        while (pos < n) {
            let sepPos = this._curChunk.indexOf("\r", pos)
            let nextPos = 0
            if (sepPos >= 0) {
                nextPos = sepPos + 1
                if (nextPos < n && this._curChunk.charAt(nextPos) == "\n") {
                    nextPos++
                }
            } else {
                sepPos = this._curChunk.indexOf("\n", pos)
                if (sepPos >= 0) {
                    nextPos = sepPos + 1
                }
            }
            if (sepPos < 0) {
                break
            }
            yield this._curChunk.substring(pos, sepPos)
            pos = nextPos
        }
        if (pos != 0) {
            this._curChunk = this._curChunk.substring(pos)
        }
    }

    _Finalize(): void {
        //XXX
    }

    _ProcessLine(line: string): void {
        if (this._curGroupCode === null) {
            const codeStr = line.trim()
            this._curGroupCode = parseInt(codeStr)
            if (isNaN(this._curGroupCode)) {
                this._Error("Bad group code: " + codeStr)
            }
            return
        }
        const token = new Token(this._curGroupCode, line)
        this._curGroupCode = null
        this._ProcessToken(token)
    }

    _ProcessToken(token: Token): void {
        this._schemedParser.Feed(token)
    }

    _Error(msg: string, cause: Error | null = null) {
        let options = undefined
        if (cause) {
            options = {cause}
        }
        throw new DxfParsingError(msg, this._curLineNum, options)
    }
}

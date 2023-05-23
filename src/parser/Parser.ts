import { GetLogger } from "@/Log"

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
     * @param abortSignal Optional abort signal which can interrupt the file feeding.
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

    _decoder: TextDecoder
    _finalChunkSeen: boolean = false
    _curChunk: string = ""
    _curGroupCode: number | null = null



    _ProcessCurChunk(): void {
        for (const s of this._ConsumeCurChunkLines()) {
            this._ProcessLine(s)
        }
    }

    /** Iterate all complete lines in the current chunk. The consumed lines are stripped from the
     * chunk.
     */
    *_ConsumeCurChunkLines(): IterableIterator<string> {
        let pos = 0
        const n = this._curChunk.length
        while (pos < n) {
            console.log(pos)//XXX
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
                return
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
        //XXX
        console.log(JSON.stringify(line))
    }
}

class Group {
    readonly code: number
    readonly value: string | number | boolean

    constructor(code: number, valueStr: string) {
        this.code = code
        this.value = Group.GetTypedValue(code, valueStr)
    }

    static ParseBoolean(s: string): boolean {
        if (s === "0") {
            return false
        }
        if (s === "1") {
            return true
        }
        throw TypeError(`String "${s}" cannot be cast to Boolean type`)
    }

    static GetTypedValue(code: number, valueStr: string): number | string | boolean {
        if (code <= 9) {
            return valueStr;
        }
        if (code >= 10 && code <= 59) {
            return parseFloat(valueStr.trim());
        }
        if (code >= 60 && code <= 99) {
            return parseInt(valueStr.trim());
        }
        if (code >= 100 && code <= 109) {
            return valueStr;
        }
        if (code >= 110 && code <= 149) {
            return parseFloat(valueStr.trim());
        }
        if (code >= 160 && code <= 179) {
            return parseInt(valueStr.trim());
        }
        if (code >= 210 && code <= 239) {
            return parseFloat(valueStr.trim());
        }
        if (code >= 270 && code <= 289) {
            return parseInt(valueStr.trim());
        }
        if (code >= 290 && code <= 299) {
            return Group.ParseBoolean(valueStr.trim());
        }
        if (code >= 300 && code <= 369) {
            return valueStr;
        }
        if (code >= 370 && code <= 389) {
            return parseInt(valueStr.trim());
        }
        if (code >= 390 && code <= 399) {
            return valueStr;
        }
        if (code >= 400 && code <= 409) {
            return parseInt(valueStr.trim());
        }
        if (code >= 410 && code <= 419) {
            return valueStr;
        }
        if (code >= 420 && code <= 429) {
            return parseInt(valueStr.trim());
        }
        if (code >= 430 && code <= 439) {
            return valueStr;
        }
        if (code >= 440 && code <= 459) {
            return parseInt(valueStr.trim());
        }
        if (code >= 460 && code <= 469) {
            return parseFloat(valueStr.trim());
        }
        if (code >= 470 && code <= 481) {
            return valueStr;
        }
        if (code === 999) {
            return valueStr;
        }
        if (code >= 1000 && code <= 1009) {
            return valueStr;
        }
        if (code >= 1010 && code <= 1059) {
            return parseFloat(valueStr.trim());
        }
        if (code >= 1060 && code <= 1071) {
            return parseInt(valueStr.trim());
        }

        log.warn("Group code does not have a defined type", { code, valueStr })
        return valueStr
    }
}

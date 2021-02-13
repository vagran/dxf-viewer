import {DxfFetcher} from "./DxfFetcher"
import {DxfScene} from "./DxfScene"

/** Wraps web-worker instance and provides unified interface to its services, including the when
 * web-worker is not used and all heavy operations are performed in main thread.
 */
export class DxfWorker {
    /** @param worker Web worker instance with DxfViewer.SetupWorker() function called. Can be null
     *  for synchronous operations.
     *  @param isWorker True for worker-side wrapper.
     */
    constructor(worker, isWorker = false) {
        this.worker = worker
        if (isWorker) {
            worker.onmessage = this._ProcessRequest.bind(this)
        } else if (worker) {
            worker.addEventListener("message", this._ProcessResponse.bind(this), false)
            worker.addEventListener("error", this._OnError.bind(this), false)
            this.reqSeq = 1
            /* Indexed by sequence. */
            this.requests = new Map()
            this.progressCbk = null
        }
    }

    /**
     * @param url DXF file URL.
     * @param fonts {?string[]} Fonts URLs.
     * @param options Viewer options. See DxfViewer.DefaultOptions.
     * @param progressCbk {Function?} (phase, processedSize, totalSize)
     */
    async Load(url, fonts, options, progressCbk) {
        if (this.worker) {
            return this._SendRequest(DxfWorker.WorkerMsg.LOAD,
                                     { url, fonts, options: this._CloneOptions(options) },
                                     progressCbk)
        } else {
            return this._Load(url, fonts, options, progressCbk)
        }
    }

    async Destroy(noWait = false) {
        if (this.worker) {
            if (!noWait) {
                await this._SendRequest(DxfWorker.WorkerMsg.DESTROY)
            }
            /* close() in the worker is not enough, instance is still visible in dev tools. */
            this.worker.terminate()
        }
    }

    async _ProcessRequest(msg) {
        const resp = {seq: msg.data.seq, type: msg.data.type}
        const transfers = []
        try {
            resp.data = await this._ProcessRequestMessage(msg.data.type, msg.data.data, transfers,
                                                          msg.data.seq)
        } catch (error) {
            resp.error = error
        }
        this.worker.postMessage(resp, transfers)
        if (msg.type === DxfWorker.WorkerMsg.DESTROY) {
            this.worker.onmessage = null
            this.worker.close()
            this.worker = null
        }
    }

    async _ProcessRequestMessage(type, data, transfers, seq) {
        switch (type) {
        case DxfWorker.WorkerMsg.LOAD: {
            const scene = await this._Load(
                data.url,
                data.fonts,
                data.options,
                (phase, size, totalSize) => this._SendProgress(seq, phase, size, totalSize))
            transfers.push(scene.vertices)
            transfers.push(scene.indices)
            transfers.push(scene.transforms)
            return scene
        }
        case DxfWorker.WorkerMsg.DESTROY:
            return null
        default:
            throw "Unknown message type: " + type
        }
    }

    async _ProcessResponse(msg) {
        const seq = msg.data.seq
        const req = this.requests.get(seq)
        if (!req) {
            console.error("Unmatched message sequence: ", seq)
            return
        }
        const data = msg.data.data
        if (msg.data.type === DxfWorker.WorkerMsg.PROGRESS && req.progressCbk) {
            req.progressCbk(data.phase, data.size, data.totalSize)
            return
        }
        this.requests.delete(seq)
        if (msg.data.hasOwnProperty("error")) {
            req.SetError(msg.data.error)
        } else {
            req.SetResponse(data)
        }
    }

    async _OnError(error) {
        console.error("DxfWorker worker error", error)
        const reqs = Array.from(this.requests.values)
        this.requests.clear()
        reqs.forEach(req => req.SetError(error))
    }

    async _SendRequest(type, data = null, progressCbk = null) {
        const seq = this.reqSeq++
        const req = new DxfWorker.Request(seq, progressCbk)
        this.requests.set(seq, req)
        this.worker.postMessage({ seq, type, data })
        return await req.GetResponse()
    }

    _SendProgress(seq, phase, size, totalSize) {
        this.worker.postMessage({
            seq,
            type: DxfWorker.WorkerMsg.PROGRESS,
            data: {phase, size, totalSize}
        })
    }

    /** @return {Object} DxfScene serialized scene. */
    async _Load(url, fonts, options, progressCbk) {
        let loadedFonts
        if (fonts) {
            loadedFonts = await this._LoadFonts(fonts, progressCbk)
        } else {
            loadedFonts = []
        }
        const dxf = await new DxfFetcher(url).Fetch(progressCbk)
        if (progressCbk) {
            progressCbk("prepare", 0, null)
        }
        const dxfScene = new DxfScene(options)
        dxfScene.Build(dxf, loadedFonts)
        return dxfScene.scene
    }

    async _LoadFonts(urls, progressCbk) {
        if (progressCbk) {
            progressCbk("font", 0, null)
        }
        const fonts = []
        const responses = []
        for (const url of urls) {
            responses.push(fetch(url).then(response => response.json()))
        }
        await Promise.allSettled(responses)
        for (const response of responses) {
            fonts.push(await response)
        }
        return fonts
    }

    _CloneOptions(options) {
        /* Default options values are taken from prototype so need to implement deep clone here. */
        if (Array.isArray(options)) {
            return options.map(o => this._CloneOptions(o))
        } else if (typeof options === "object" && options !== null) {
            const result = {}
            for (const propName in options) {
                // noinspection JSUnfilteredForInLoop
                result[propName] = this._CloneOptions(options[propName])
            }
            return result
        } else {
            return options
        }
    }
}

DxfWorker.WorkerMsg = {
    LOAD: "LOAD",
    PROGRESS: "PROGRESS",
    DESTROY: "DESTROY"
}

DxfWorker.Request = class {
    constructor(seq, progressCbk) {
        this.seq = seq
        this.progressCbk = progressCbk
        this.promise = new Promise((resolve, reject) => {
            this._Resolve = resolve
            this._Reject = reject
        })
    }

    async GetResponse() {
        return await this.promise
    }

    SetResponse(response) {
        this._Resolve(response)
    }

    SetError(error) {
        this._Reject(error)
    }
}
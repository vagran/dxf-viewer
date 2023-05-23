//XXX stub for now

export class Logger {
    log(...params: any) {
        console.log(...params)
    }

    info(...params: any) {
        console.info(...params)
    }

    warn(...params: any) {
        console.warn(...params)
    }

    error(...params: any) {
        console.error(...params)
    }

    child(name: string): Logger {
        //XXX
        return this
    }
}

export function GetLogger(name: string): Logger {
    return new Logger()
}

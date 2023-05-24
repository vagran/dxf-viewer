import { GetLogger } from "@/Log"

const log = GetLogger("Parser")

export default class Group {
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

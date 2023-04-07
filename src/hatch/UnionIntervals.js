/**
 * Find the minimum connected intervals which is equivalent to given `intervals`.
 * 
 * @param {[number, number][]} intervals 
 * @returns 
 */
export function UnionIntervals(intervals) {
    intervals.sort((a, b) => a[0] - b[0])
  
    const result = []
    let [s, e] = intervals[0]
  
    let isFirst = true
    for (const [a, b] of intervals) {
        if (isFirst) {
            isFirst = false
            continue
        }
        if (a <= e && b > e) {
            e = b
        }
        if (a > e) {
            result.push([s, e])
            s = a
            e = b
        }
    }
    result.push([s, e])
    return result
}
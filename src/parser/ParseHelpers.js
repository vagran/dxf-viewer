import AUTO_CAD_COLOR_INDEX from "./AutoCadColorIndex.js";
import ExtendedDataParser from "./ExtendedDataParser.js";

/**
 * Returns the truecolor value of the given AutoCad color index value
 * @return {Number} truecolor value as a number
 */
export function getAcadColor(index) {
    return AUTO_CAD_COLOR_INDEX[index];
}

/**
 * Parses the 2D or 3D coordinate, vector, or point. When complete,
 * the scanner remains on the last group of the coordinate.
 * @param {*} scanner
 */
export function parsePoint(scanner) {
    var point = {};

    // Reread group for the first coordinate
    scanner.rewind();
    var curr = scanner.next();

    var code = curr.code;
    point.x = curr.value;

    code += 10;
    curr = scanner.next();
    if(curr.code !== code)
        throw new Error('Expected code for point value to be ' + code +
        ' but got ' + curr.code + '.');
    point.y = curr.value;

    code += 10;
    curr = scanner.next();
    if(curr.code !== code)
    {
        // Only the x and y are specified. Don't read z.
        scanner.rewind(); // Let the calling code advance off the point
        return point;
    }
    point.z = curr.value;

    return point;
}

/** Some entities may contain embedded object which is started by group 101. All the rest data until
 * end of entity should not be interpreted as entity attributes. There is no documentation for this
 * feature.
 * @param scanner
 */
export function skipEmbeddedObject(scanner) {
    /* Ensure proper start group. */
    scanner.rewind()
    let curr = scanner.next()
    if (curr.code !== 101) {
        throw new Error("Bad call for skipEmbeddedObject()")
    }
    do {
        curr = scanner.next()
    } while (curr.code !== 0)
    scanner.rewind()
}

/**
 * Attempts to parse codes common to all entities. Returns true if the group
 * was handled by this function.
 * @param {*} entity - the entity currently being parsed
 * @param {*} curr - the current group being parsed
 */
export function checkCommonEntityProperties(entity, curr, scanner) {
    let xdataParser = null
    while (curr.code >= 1000) {
        if (xdataParser == null) {
            xdataParser = new ExtendedDataParser()
        }
        if (xdataParser.Feed(curr)) {
            xdataParser.Finish(entity)
            xdataParser = null
        } else {
            curr = scanner.next()
        }
    }
    if (xdataParser) {
        xdataParser.Finish(entity)
        /* Groups following XDATA should be parsed on next iteration. */
        scanner.rewind()
        return true
    }

    switch(curr.code) {
        case 0:
            entity.type = curr.value;
            break;
        case 5:
            entity.handle = curr.value;
            break;
        case 6:
            entity.lineType = curr.value;
            break;
        case 8: // Layer name
            entity.layer = curr.value;
            break;
        case 48:
            entity.lineTypeScale = curr.value;
            break;
        case 60:
            entity.hidden = !!curr.value;
            break;
        case 62: // Acad Index Color. 0 inherits ByBlock. 256 inherits ByLayer. Default is bylayer
            entity.colorIndex = curr.value;
            entity.color = getAcadColor(Math.abs(curr.value));
            break;
        case 67:
            entity.inPaperSpace = curr.value !== 0;
            break;
        case 100:
            //ignore
            break;
        case 330:
            entity.ownerHandle = curr.value;
            break;
        case 347:
            entity.materialObjectHandle = curr.value;
            break;
        case 370:
            //From https://www.woutware.com/Forum/Topic/955/lineweight?returnUrl=%2FForum%2FUserPosts%3FuserId%3D478262319
            // An integer representing 100th of mm, must be one of the following values:
            // 0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211.
            // -3 = STANDARD, -2 = BYLAYER, -1 = BYBLOCK
            entity.lineweight = curr.value;
            break;
        case 420: // TrueColor Color
            entity.color = curr.value;
            break;
        default:
            return false;
    }
    return true;
}

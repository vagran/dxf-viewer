
import * as helpers from "../ParseHelpers.js"

/* ACAD_TABLE parser. Extracts the subset needed for two render paths:
 *   1. Preferred: delegate to the anonymous `*T` block referenced by group code 2 (the block
 *      already contains the AutoCAD-authored grid and text geometry).
 *   2. Fallback: a minimal grid built from row heights (140) and column widths (141), with cell
 *      text strings (1 / 304) placed inside each cell.
 * Formulas, cell format overrides, merged cells, and block-content cells are intentionally
 * ignored.
 */
export default function EntityParser() {}

EntityParser.ForEntityName = 'ACAD_TABLE';

EntityParser.prototype.parseEntity = function(scanner, curr) {
    var entity = {
        type: curr.value,
        rowHeights: [],
        columnWidths: [],
        cellTexts: []
    };
    curr = scanner.next();
    while(curr !== 'EOF') {
        if(curr.code === 0) break;

        switch(curr.code) {
        case 2: // block name
            entity.name = curr.value;
            break;
        case 10: // insertion point
            entity.position = helpers.parsePoint(scanner);
            break;
        case 11: // horizontal direction vector
            entity.horizontalDirection = helpers.parsePoint(scanner);
            break;
        case 91: // number of rows
            entity.rowCount = curr.value;
            break;
        case 92: // number of columns
            entity.columnCount = curr.value;
            break;
        case 140: // row height (repeats)
            entity.rowHeights.push(curr.value);
            break;
        case 141: // column width (repeats)
            entity.columnWidths.push(curr.value);
            break;
        case 1: // cell text string (repeats)
        case 304: // cell MText content (repeats)
            if (typeof curr.value === 'string' && curr.value.length > 0) {
                entity.cellTexts.push(curr.value);
            }
            break;
        case 210:
            entity.extrusionDirection = helpers.parsePoint(scanner);
            break;
        case 100:
            break;
        default:
            helpers.checkCommonEntityProperties(entity, curr, scanner);
            break;
        }
        curr = scanner.next();
    }
    /* For the block-reference render path, mimic an INSERT entity: no scale/rotation, unit
     * transform. AutoCAD authors the `*T` block already at world scale. */
    if (entity.name !== undefined) {
        entity.xScale = 1;
        entity.yScale = 1;
        entity.zScale = 1;
        entity.rotation = 0;
    }
    return entity;
};

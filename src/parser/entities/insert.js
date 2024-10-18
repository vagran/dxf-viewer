
import * as helpers from "../ParseHelpers.js"

export default function EntityParser() {}

EntityParser.ForEntityName = 'INSERT';

EntityParser.prototype.parseEntity = function(scanner, curr) {
    var entity;
    entity = { type: curr.value };
    curr = scanner.next();
    while(curr !== 'EOF') {
        if(curr.code === 0) break;

        switch(curr.code) {
        case 2:
            entity.name = curr.value;
            break;
        case 41:
            entity.xScale = curr.value;
            break;
        case 42:
            entity.yScale = curr.value;
            break;
        case 43:
            entity.zScale = curr.value;
            break;
        case 10:
            entity.position = helpers.parsePoint(scanner);
            break;
        case 50:
            entity.rotation = curr.value;
            break;
        case 70:
            entity.columnCount = curr.value;
            break;
        case 71:
            entity.rowCount = curr.value;
            break;
        case 44:
            entity.columnSpacing = curr.value;
            break;
        case 45:
            entity.rowSpacing = curr.value;
            break;
        case 210:
            entity.extrusionDirection = helpers.parsePoint(scanner);
            break;
        default: // check common entity attributes
            helpers.checkCommonEntityProperties(entity, curr, scanner);
            break;
        }
        curr = scanner.next();
    }

    return entity;
};

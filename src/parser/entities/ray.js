
import * as helpers from "../ParseHelpers.js"

export default function EntityParser() {}

EntityParser.ForEntityName = 'RAY';

EntityParser.prototype.parseEntity = function(scanner, curr) {
    var entity = { type: curr.value };
    curr = scanner.next();
    while(curr !== 'EOF') {
        if(curr.code === 0) break;

        switch(curr.code) {
        case 10: // start point
            entity.basePoint = helpers.parsePoint(scanner);
            break;
        case 11: // unit direction vector
            entity.direction = helpers.parsePoint(scanner);
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
    return entity;
};

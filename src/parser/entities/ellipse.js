
import * as helpers from "../ParseHelpers.js"

export default function EntityParser() {}

EntityParser.ForEntityName = 'ELLIPSE';

EntityParser.prototype.parseEntity = function(scanner, curr) {
    var entity;
    entity = { type: curr.value };
    curr = scanner.next();
    while(curr !== 'EOF') {
        if(curr.code === 0) break;

        switch(curr.code) {
        case 10:
            entity.center = helpers.parsePoint(scanner);
            break;
        case 11:
            entity.majorAxisEndPoint = helpers.parsePoint(scanner);
            break;
        case 40:
            entity.axisRatio = curr.value;
            break;
        case 41:
            /* Already in radians. */
            entity.startAngle = curr.value;
            break;
        case 42:
            /* Already in radians. */
            entity.endAngle = curr.value;
            break;
        case 2:
            entity.name = curr.value;
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


import * as helpers from '../ParseHelpers'

export default function EntityParser() {}

EntityParser.ForEntityName = 'SPLINE';

EntityParser.prototype.parseEntity = function(scanner, curr) {
    var entity;
    entity = { type: curr.value };
    curr = scanner.next();
    while(curr !== 'EOF')
    {
        if(curr.code === 0) break;

        switch(curr.code) {
        case 10:
            if (!entity.controlPoints) entity.controlPoints = [];
            entity.controlPoints.push(helpers.parsePoint(scanner));
            break;
        case 11:
            if (!entity.fitPoints) entity.fitPoints = [];
            entity.fitPoints.push(helpers.parsePoint(scanner));
            break;
        case 12:
            entity.startTangent = helpers.parsePoint(scanner);
            break;
        case 13:
            entity.endTangent = helpers.parsePoint(scanner);
            break;
        case 40:
            if (!entity.knotValues) entity.knotValues = [];
            entity.knotValues.push(curr.value);
            break;
        case 70:
            if ((curr.value & 1) != 0) entity.closed = true;
            if ((curr.value & 2) != 0) entity.periodic = true;
            if ((curr.value & 4) != 0) entity.rational = true;
            if ((curr.value & 8) != 0) entity.planar = true;
            if ((curr.value & 16) != 0)
            {
                entity.planar = true;
                entity.linear = true;
            }
            break;

        case 71:
            entity.degreeOfSplineCurve = curr.value;
            break;
        case 72:
            entity.numberOfKnots = curr.value;
            break;
        case 73:
            entity.numberOfControlPoints = curr.value;
            break;
        case 74:
            entity.numberOfFitPoints = curr.value;
            break;
        case 210:
            entity.extrusionDirection = helpers.parsePoint(scanner);
            break;
        default:
            helpers.checkCommonEntityProperties(entity, curr);
            break;
        }
        curr = scanner.next();
    }

    return entity;
};
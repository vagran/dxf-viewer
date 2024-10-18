
import * as helpers from "../ParseHelpers.js"

export default function EntityParser() {}

EntityParser.ForEntityName = 'DIMENSION';

EntityParser.prototype.parseEntity = function(scanner, curr) {
    var entity;
    entity = { type: curr.value };
    curr = scanner.next();
    while(curr !== 'EOF') {
        if(curr.code === 0) break;

        switch(curr.code) {
        case 2: // Referenced block name
            entity.block = curr.value;
            break;
        case 3: // Dimension style name
            entity.styleName = curr.value;
            break;
        case 10: // X coordinate of 'first alignment point'
            entity.anchorPoint = helpers.parsePoint(scanner);
            break;
        case 11:
            entity.middleOfText = helpers.parsePoint(scanner);
            break;
        case 12: // Insertion point for clones of a dimension
            entity.insertionPoint = helpers.parsePoint(scanner);
            break;
        case 13: // Definition point for linear and angular dimensions
            entity.linearOrAngularPoint1 = helpers.parsePoint(scanner);
            break;
        case 14: // Definition point for linear and angular dimensions
            entity.linearOrAngularPoint2 = helpers.parsePoint(scanner);
            break;
        case 15: // Definition point for diameter, radius, and angular dimensions
            entity.diameterOrRadiusPoint = helpers.parsePoint(scanner);
            break;
        case 16: // Point defining dimension arc for angular dimensions
            entity.arcPoint = helpers.parsePoint(scanner);
            break;
        case 70: // Dimension type
            entity.dimensionType = curr.value;
            break;
        case 71: // 5 = Middle center
            entity.attachmentPoint = curr.value;
            break;
        case 42: // Actual measurement
            entity.actualMeasurement = curr.value;
            break;
        case 1: // Text entered by user explicitly
            entity.text = curr.value;
            break;
        case 50: // Angle of rotated, horizontal, or vertical dimensions
            entity.angle = curr.value;
            break;
        case 53: // Rotation angle of the dimension text away from its default orientation (the
            //direction of the dimension line)
            entity.textRotation = curr.value;
            break;

        default: // check common entity attributes
            helpers.checkCommonEntityProperties(entity, curr, scanner);
            break;
        }
        curr = scanner.next();
    }

    return entity;
};

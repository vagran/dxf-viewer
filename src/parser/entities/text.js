
import * as helpers from "../ParseHelpers.js"

export default function EntityParser() {}

EntityParser.ForEntityName = 'TEXT';

EntityParser.prototype.parseEntity = function(scanner, curr) {
    var entity;
        entity = { type: curr.value };
    curr = scanner.next();
    while(curr !== 'EOF') {
        if(curr.code === 0) break;
        switch(curr.code) {
        case 10: // X coordinate of 'first alignment point'
            entity.startPoint = helpers.parsePoint(scanner);
            break;
        case 11: // X coordinate of 'second alignment point'
            entity.endPoint = helpers.parsePoint(scanner);
            break;
        case 40: // Text height
            entity.textHeight = curr.value;
            break;
        case 41:
            entity.xScale = curr.value;
            break;
        case 50: // Rotation in degrees
            entity.rotation = curr.value;
            break;
        case 7: // Text style name
            entity.styleName = curr.value;
            break;
        case 1: // Text
            entity.text = curr.value;
            break;
        // NOTE: 72 and 73 are meaningless without 11 (second alignment point)
        case 72: // Horizontal alignment
            entity.halign = curr.value;
            break;
        case 73: // Vertical alignment
            entity.valign = curr.value;
            break;
        default: // check common entity attributes
            helpers.checkCommonEntityProperties(entity, curr, scanner);
            break;
        }
        curr = scanner.next();
    }
    return entity;
};

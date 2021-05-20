
import * as helpers from '../ParseHelpers'

export default function EntityParser() {}

EntityParser.ForEntityName = 'ATTDEF';

EntityParser.prototype.parseEntity = function(scanner, curr) {
    var entity = {
        type: curr.value,
        scale: 1,
        textStyle: 'STANDARD'
     };
    curr = scanner.next();
    while (curr !== 'EOF') {
        if (curr.code === 0) {
            break;
        }
        switch(curr.code) {
        case 1:
            entity.text = curr.value;
            break;
        case 2:
            entity.tag = curr.value;
            break;
        case 3:
            entity.prompt = curr.value;
            break;
        case 7:
            entity.textStyle = curr.value;
            break;
        case 10: // X coordinate of 'first alignment point'
            entity.startPoint = helpers.parsePoint(scanner);
            break;
        case 11: // X coordinate of 'second alignment point'
            entity.endPoint = helpers.parsePoint(scanner);
            break;
        case 39:
            entity.thickness = curr.value;
            break;
        case 40:
            entity.textHeight = curr.value;
            break;
        case 41:
            entity.scale = curr.value;
            break;
        case 50:
            entity.rotation = curr.value;
            break;
        case 51:
            entity.obliqueAngle = curr.value;
            break;
        case 70:
            entity.invisible = !!(curr.value & 0x01);
            entity.constant = !!(curr.value & 0x02);
            entity.verificationRequired = !!(curr.value & 0x04);
            entity.preset = !!(curr.value & 0x08);
            break;
        case 71:
            entity.backwards = !!(curr.value & 0x02);
            entity.mirrored = !!(curr.value & 0x04);
            break;
        case 72:
            // TODO: enum values?
            entity.horizontalJustification = curr.value;
            break;
        case 73:
            entity.fieldLength = curr.value;
            break;
        case 74:
            // TODO: enum values?
            entity.verticalJustification = curr.value;
            break;
        case 100:
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
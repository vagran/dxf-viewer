import * as helpers from "../ParseHelpers.js";

export default function EntityParser() {}

EntityParser.ForEntityName = 'ATTRIB';

EntityParser.prototype.parseEntity = function (scanner, curr) {
    var entity = {
        type: curr.value,
        scale: 1,
        textStyle: 'STANDARD',
    };
    curr = scanner.next();
    while (curr !== 'EOF') {
        if (curr.code === 0) {
            break;
        }
        switch (curr.code) {
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
            case 44:
                entity.lineSpacingFactor = curr.value;
                break;
            case 45:
                entity.fillBoxScale = curr.value;
                break;
            case 46:
                entity.annotationHeight = curr.value;
                break;
            case 50:
                entity.rotation = curr.value;
                break;
            case 51:
                entity.obliqueAngle = curr.value;
                break;
            case 63:
                entity.backgroundFillColor = curr.value;
                break;
            case 70:
                entity.hidden = !!(curr.value & 0x01);
                entity.constant = !!(curr.value & 0x02);
                entity.verificationRequired = !!(curr.value & 0x04);
                entity.preset = !!(curr.value & 0x08);
                break;
            case 71:
                entity.attachmentPoint = curr.value;
                break;
            case 72:
                entity.horizontalJustification = curr.value;
                break;
            case 73:
                entity.lineSpacing = curr.value;
                break;
            case 74:
                entity.verticalJustification = curr.value;
                break;
            case 90:
                // TODO:: enum
                // 0 = Background fill off
                // 1 = Use background fill color
                // 2 = Use drawing window color as background fill color
                // and 420 ~ 439 background color check
                entity.backgroundFillSetting = curr.value;
                break;
            case 100:
                break;
            case 210:
                entity.extrusionDirection = helpers.parsePoint(scanner);
                break;
            case 280:
                entity.lockPositionFlag = curr.value;
                break;
            case 340:
                entity.hardPointerId = curr.value;
                break;
            default:
                helpers.checkCommonEntityProperties(entity, curr, scanner);
                break;
        }
        curr = scanner.next();
    }

    return entity;
};

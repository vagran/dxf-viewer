
import * as helpers from "../ParseHelpers.js"

export default function EntityParser() {}

EntityParser.ForEntityName = 'MTEXT';

EntityParser.prototype.parseEntity = function (scanner, curr) {
    var entity = {type: curr.value, embeddedObject: false};
    curr = scanner.next();
    while (curr !== 'EOF') {
        if (curr.code === 0) break;

        switch (curr.code) {
            case 3:
            case 1:
                entity.text ? entity.text += curr.value : entity.text = curr.value;
                break;
            case 10:
                if(!entity.embeddedObject){
                    entity.position = helpers.parsePoint(scanner);
                }
                break;
            case 11:
                if(!entity.embeddedObject){
                    entity.direction = helpers.parsePoint(scanner);
                }
                break;
            case 40:
                //Note: this is the text height
                if(!entity.embeddedObject){
                    entity.height = curr.value;
                }
                break;
            case 41:
                if(!entity.embeddedObject){
                    entity.width = curr.value;
                }
                break;
            case 44:
                if(!entity.embeddedObject){
                    entity.lineSpacing = curr.value;
                }else{
                    // this is the width of each column
                    entity.embeddedObjectWidth = curr.value;
                }
                break;
            case 45:
                if(entity.embeddedObject){
                    entity.embeddedObjectGutterWidth = curr.value;
                }
                break;
            case 46:
                if(!entity.embeddedObject){
                    entity.boxHeight = curr.value;
                }
                break;
            case 50:
                entity.rotation = curr.value;
                break;
            case 71:
                if(!entity.embeddedObject){
                    entity.attachmentPoint = curr.value;
                }
                break;
            case 72:
                if(!entity.embeddedObject){
                    entity.drawingDirection = curr.value;
                }else{
                    // this is numbers of columns
                    entity.embeddedObjectColumn = curr.value;
                }
                break;
            case 101:
                entity.embeddedObject = true;
                // helpers.skipEmbeddedObject(scanner);
                break;
            default:
                helpers.checkCommonEntityProperties(entity, curr, scanner);
                break;
        }
        curr = scanner.next();
    }
    return entity;
};


import * as helpers from "../ParseHelpers.js"

export default function EntityParser() {}

EntityParser.ForEntityName = 'MTEXT';

EntityParser.prototype.parseEntity = function(scanner, curr) {
    var entity = { type: curr.value };
    curr = scanner.next();
    while(curr !== 'EOF') {
        if(curr.code === 0) break;

        switch(curr.code) {
        case 3:
        case 1:
            entity.text ? entity.text += curr.value : entity.text = curr.value;
            break;
        case 10:
            entity.position = helpers.parsePoint(scanner);
            break;
        case 11:
            entity.direction = helpers.parsePoint(scanner);
            break;
        case 40:
            //Note: this is the text height
            entity.height = curr.value;
            break;
        case 41:
            entity.width = curr.value;
            break;
        case 44:
            entity.lineSpacing = curr.value;
            break;
        case 50:
            entity.rotation = curr.value;
            break;
        case 71:
            entity.attachmentPoint = curr.value;
            break;
        case 72:
            entity.drawingDirection = curr.value;
            break;
        case 101:
            entity.columns = parseMTextColumns(scanner, curr, entity);
            break;
        default:
            helpers.checkCommonEntityProperties(entity, curr, scanner);
            break;
        }
        curr = scanner.next();
    }
    return entity;
};

const ColumnType = Object.freeze({
    None: 0,
    Dynamic: 1,
    Static: 2,
});

// Based on https://github.com/mozman/ezdxf/blob/9241936736e6045be4b89dc24a9c871a80469148/src/ezdxf/entities/mtext.py#L439
function parseMTextColumns(scanner, curr, parent) {
    const columnEntity = { type: curr.value, heights: [] };
    do {
        curr = scanner.next();

        switch (curr.code) {
            case 10:
                if (!parent.direction) {
                    parent.direction = helpers.parsePoint(scanner);
                    delete parent.rotation;
                }
                break;
            case 11:
                if (!parent.position) {
                    parent.position = helpers.parsePoint(scanner);
                }
                break;
            case 40:
                parent.width = curr.value;
                break;
            case 41:
                columnEntity.defined_height = curr.value;
                break;
            case 42:
                columnEntity.total_width = curr.value;
                break;
            case 43:
                columnEntity.total_height = curr.value;
                break;
            case 44:
                columnEntity.column_width = curr.value;
                break;
            case 45:
                columnEntity.gutter_width = curr.value;
                break;
            case 71:
                columnEntity.column_type = curr.value;
                break;
            case 72:
                columnEntity.count = curr.value;
                break;
            case 73:
                columnEntity.auto_height = curr.value;
                break;
            case 74:
                columnEntity.reversed_column_flow = curr.value;
                break;
            case 46:
                columnEntity.heights.push(curr.value);
        }
    } while (curr.code !== 0);
    scanner.rewind();

    if (columnEntity.count === 0) {
        if (columnEntity.heights.length > 0) {
            columnEntity.count = columnEntity.heights.length;
        } else if (columnEntity.total_width > 0) {
            const gw = columnEntity.gutter_width || 0;
            columnEntity.count = (columnEntity.total_width + gw) / (columnEntity.column_width + gw);
        }
    }
    return columnEntity;
}

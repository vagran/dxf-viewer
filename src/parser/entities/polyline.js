
import * as helpers from '../ParseHelpers'
import VertexParser from './vertex';

export default function EntityParser() {}

EntityParser.ForEntityName = 'POLYLINE';

EntityParser.prototype.parseEntity = function(scanner, curr) {
    var entity = { type: curr.value, vertices: [] };
    curr = scanner.next();
    while(curr !== 'EOF') {
        if(curr.code === 0) break;

        switch(curr.code) {
        case 10: // always 0
            break;
        case 20: // always 0
            break;
        case 30: // elevation
            break;
        case 39: // thickness
            entity.thickness = curr.value;
            break;
        case 40: // start width
            break;
        case 41: // end width
            break;
        case 70:
            entity.shape = (curr.value & 1) !== 0;
            entity.includesCurveFitVertices = (curr.value & 2) !== 0;
            entity.includesSplineFitVertices = (curr.value & 4) !== 0;
            entity.is3dPolyline = (curr.value & 8) !== 0;
            entity.is3dPolygonMesh = (curr.value & 16) !== 0;
            entity.is3dPolygonMeshClosed = (curr.value & 32) !== 0; // 32 = The polygon mesh is closed in the N direction
            entity.isPolyfaceMesh = (curr.value & 64) !== 0;
            entity.hasContinuousLinetypePattern = (curr.value & 128) !== 0;
            break;
        case 71: // Polygon mesh M vertex count
            break;
        case 72: // Polygon mesh N vertex count
            break;
        case 73: // Smooth surface M density
            break;
        case 74: // Smooth surface N density
            break;
        case 75: // Curves and smooth surface type
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

    entity.vertices = parsePolylineVertices(scanner, curr);

    return entity;
};

function parsePolylineVertices(scanner, curr) {
    var vertexParser = new VertexParser();

    var vertices = [];
    while (!scanner.isEOF()) {
        if (curr.code === 0) {
            if (curr.value === 'VERTEX') {
                vertices.push(vertexParser.parseEntity(scanner, curr));
                curr = scanner.lastReadGroup;
            } else if (curr.value === 'SEQEND') {
                parseSeqEnd(scanner, curr);
                break;
            }
        }
    }
    return vertices;
};

function parseSeqEnd(scanner, curr) {
    var entity = { type: curr.value };
    curr = scanner.next();
    while(curr != 'EOF') {
        if (curr.code == 0) break;
        helpers.checkCommonEntityProperties(entity, curr);
        curr = scanner.next();
    }

    return entity;
};

import * as helpers from '../ParseHelpers'

export default function EntityParser() {}

EntityParser.ForEntityName = 'HATCH';

EntityParser.prototype.parseEntity = function(scanner, curr) {
    var entity;
    entity = { type: curr.value };

    let numBoundaryLoops = 0;
    let numDefinitionLines = 0;
    let numSeedPoints = 0;

    curr = scanner.next();
    while(curr !== 'EOF') {
        if (curr.code === 0) break;

        while (numBoundaryLoops > 0) {
            const loop = ParseBoundaryLoop(curr, scanner)
            if (loop) {
                entity.boundaryLoops.push(loop);
                numBoundaryLoops--;
                curr = scanner.next();
            } else {
                numBoundaryLoops = 0
            }
        }

        while (numDefinitionLines > 0) {
            const line = ParseDefinitionLine(curr, scanner)
            if (line) {
                entity.definitionLines.push(line);
                numDefinitionLines--;
                curr = scanner.next();
            } else {
                numDefinitionLines = 0
            }
        }

        while (numSeedPoints > 0) {
            const pt = ParseSeedPoint(curr, scanner);
            if (pt) {
                entity.seedPoints.push(pt);
                numSeedPoints--;
                curr = scanner.next();
            } else {
                numSeedPoints = 0
            }
        }

        if (curr.code === 0) break;

        switch(curr.code) {

        case 2: // Hatch pattern name
            entity.patternName = curr.value;
            break;

        case 70: //Solid fill flag (solid fill = 1; pattern fill = 0)
            entity.isSolid = curr.value != 0;
            break;

        case 91: // Number of boundary paths (loops)
            numBoundaryLoops = curr.value;
            if (numBoundaryLoops > 0) {
                entity.boundaryLoops = []
            }
            break;

        // Hatch style:
        // 0 = Hatch “odd parity” area (Normal style)
        // 1 = Hatch outermost area only (Outer style)
        // 2 = Hatch through entire area (Ignore style)
        case 75:
            entity.hatchStyle = curr.value;
            break;

        //Hatch pattern type:
        // 0 = User-defined; 1 = Predefined; 2 = Custom
        case 76:
            entity.patternType = curr.value;
            break;

        case 52: // Hatch pattern angle (pattern fill only)
            entity.patternAngle = curr.value;
            break;

        case 41: // Hatch pattern scale or spacing (pattern fill only)
            entity.patternScale = curr.value;
            break;

        case 78: // Number of pattern definition lines
            numDefinitionLines = curr.value;
            if (numDefinitionLines > 0) {
                entity.definitionLines = []
            }
            break;

        case 98: // Number of seed points
            numSeedPoints = curr.value;
            if (numSeedPoints > 0) {
                entity.seedPoints = []
            }
            break;

        default: // check common entity attributes
            helpers.checkCommonEntityProperties(entity, curr, scanner);
            break;
        }
        curr = scanner.next();
    }

    return entity;
};

function ParseBoundaryLoop(curr, scanner) {
    let entity = null

    const ParsePolyline = () => {
        const pl = {vertices: [], isClosed: false};
        let hasBulge = false;
        let numVertices = 0;
        while (true) {
            if (numVertices > 0) {
                for (let i = 0; i < numVertices; i++) {
                    if (curr.code != 10) {
                        break
                    }
                    const p = helpers.parsePoint(scanner)
                    curr = scanner.next();
                    if (curr.code == 42) {
                        p.bulge = curr.value
                        curr = scanner.next();
                    }
                    pl.vertices.push(p)
                }
                return pl
            }

            switch (curr.code) {
            case 72:
                hasBulge = curr.value;
                break;
            case 73:
                pl.isClosed = curr.value;
                break;
            case 93:
                numVertices = curr.value;
                break;
            default:
                return pl;
            }
            curr = scanner.next();
        }
    }

    const ParseEdge = () => {
        if (curr.code != 72) {
            return null
        }
        const e = {type: curr.value}
        curr = scanner.next();

        while (true) {
            switch (curr.code) {
            case 10:
                e.start = helpers.parsePoint(scanner);
                break;
            case 11:
                e.end = helpers.parsePoint(scanner);
                break;
            case 40:
                e.radius = curr.value;
                break;
            case 50:
                e.startAngle = curr.value;
                break;
            case 51:
                e.endAngle = curr.value;
                break;
            case 73:
                e.isCcw = curr.value;
                break;
            //XXX ignore some groups for now, mostly spline
            case 94:
            case 73:
            case 74:
            case 95:
            case 96:
            case 40:
            case 42:
            case 97:
                break;
            default:
                return e
            }
            curr = scanner.next();
        }
    }

    let polylineParsed = false;
    let numEdges = 0;
    let numSourceRefs = 0;

    while (true) {

        if (!entity) {
            if (curr.code != 92) {
                return null;
            }
            entity = {type: curr.value};
            curr = scanner.next();
        }

        if ((entity.type & 2) && !polylineParsed) {
            entity.polyline = ParsePolyline()
        }

        while (numEdges) {
            const edge = ParseEdge();
            if (edge) {
                entity.edges.push(edge);
                numEdges--;
            } else {
                numEdges = 0;
            }
        }

        while (numSourceRefs) {
            if (curr.code == 330) {
                entity.sourceRefs.push(curr.value);
                numSourceRefs--;
                curr = scanner.next();
            } else {
                numSourceRefs = 0
            }
        }

        switch (curr.code) {
        case 93:
            numEdges = curr.value;
            if (numEdges > 0) {
                entity.edges = []
            }
            break;
        case 97:
            numSourceRefs = curr.value;
            if (numSourceRefs > 0) {
                entity.sourceRefs = []
            }
            break;
        default:
            scanner.rewind();
            return entity;
        }
        curr = scanner.next();
    }
}

function ParseDefinitionLine(curr, scanner) {
    /* Assuming always starts from group 53. */
    if (curr.code != 53) {
        return null
    }
    const entity = {angle: curr.value, base: {x: 0, y: 0}, offset: {x: 0, y: 0}};
    curr = scanner.next();

    let numDashes = 0;
    while (true) {
        switch (curr.code) {
        case 43:
            entity.base.x = curr.value;
            break;
        case 44:
            entity.base.y = curr.value;
            break;
        case 45:
            entity.offset.x = curr.value;
            break;
        case 46:
            entity.offset.y = curr.value;
            break;
        case 49:
            if (numDashes > 0) {
                entity.dashes.push(curr.value);
                numDashes--;
            }
            break;
        case 79:
            numDashes = curr.value;
            if (curr.value) {
                entity.dashes = []
            }
        default:
            scanner.rewind();
            return entity;
        }
        curr = scanner.next();
    }
}

function ParseSeedPoint(curr, scanner) {
    if (curr.code != 10) {
        return null
    }
    return helpers.parsePoint(scanner);
}
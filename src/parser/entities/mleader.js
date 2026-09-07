
import * as helpers from "../ParseHelpers.js"

/* MLEADER (a.k.a. MULTILEADER) is a rich, deeply nested entity. This parser extracts only the
 * subset needed for a "functional but not pretty" render: leader-line vertices grouped by
 * LEADER_LINE sub-objects, MText content, text insertion point, arrow size, and content type.
 * Rich MTEXT formatting, dogleg geometry, block content, landing lines, and tolerance content
 * are intentionally not parsed.
 */
export default function EntityParser() {}

EntityParser.ForEntityName = 'MULTILEADER';

EntityParser.prototype.parseEntity = function(scanner, curr) {
    var entity = { type: curr.value, leaderLines: [], vertices: [] };
    /* Sub-object marker state: LEADER_LINE, CONTEXT_DATA, etc. Set by group codes 302 / 303. */
    var section = null;
    curr = scanner.next();
    while(curr !== 'EOF') {
        if(curr.code === 0) break;

        switch(curr.code) {
        case 302: // sub-object boundary sentinel (string value)
        case 303: // sub-object boundary sentinel (string value)
            section = curr.value;
            if (section === 'LEADER_LINE{' || section === 'LEADER_LINE') {
                entity.leaderLines.push([]);
            }
            break;
        case 10: // vertex
            if (section === 'LEADER_LINE{' || section === 'LEADER_LINE') {
                entity.leaderLines[entity.leaderLines.length - 1]
                    .push(helpers.parsePoint(scanner));
            } else {
                entity.vertices.push(helpers.parsePoint(scanner));
            }
            break;
        case 12: // text insertion point (in CONTEXT_DATA)
            entity.textInsertionPoint = helpers.parsePoint(scanner);
            break;
        case 13: // text direction / normal
            entity.textDirection = helpers.parsePoint(scanner);
            break;
        case 304: // MText content string, or arrow head block name
            if (!entity.text) {
                entity.text = curr.value;
            }
            break;
        case 40: // MText char height OR arrow size (depends on context; capture first)
            if (entity.charHeight === undefined) {
                entity.charHeight = curr.value;
            }
            break;
        case 41: // dogleg length or text width
            entity.width = curr.value;
            break;
        case 42: // arrow size
            entity.arrowSize = curr.value;
            break;
        case 43: // text landing gap
            entity.landingGap = curr.value;
            break;
        case 172: // content type (1=MTEXT, 2=block, 3=tolerance)
            entity.contentType = curr.value;
            break;
        case 171: // text attachment (top/middle/bottom)
            entity.textAttachment = curr.value;
            break;
        case 173: // text left attachment
            entity.textLeftAttachment = curr.value;
            break;
        case 210:
            entity.extrusionDirection = helpers.parsePoint(scanner);
            break;
        case 100:
            break;
        default:
            helpers.checkCommonEntityProperties(entity, curr, scanner);
            break;
        }

        curr = scanner.next();
    }
    return entity;
};

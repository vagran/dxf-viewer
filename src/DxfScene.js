import {DynamicBuffer, NativeType} from "./DynamicBuffer.js"
import {BatchingKey} from "./BatchingKey.js"
import {Matrix3, Vector2, Vector3} from "three"
import {MatrixRotateCW, MatrixScale, MatrixTranslate} from "./math/utils.js"
import {OcsBasis, OcsToWcsMatrix, WcsToOcs} from "./math/Ocs.js"
import {TextRenderer, ParseSpecialChars, HAlign, VAlign} from "./TextRenderer.js"
import {DefaultTextOptions} from "./TextRendererOptions.js"
import {RBTree} from "./RBTree.js"
import {MTextFormatParser} from "./MTextFormatParser.js"
import dimStyleCodes from "./parser/DimStyleCodes.js"
import {LinearDimension} from "./LinearDimension.js"
import colorTable from "./parser/AutoCadColorIndex.js"
import {HatchCalculator, HatchStyle} from "./HatchCalculator.js"
import {LookupPattern, Pattern} from "./Pattern.js"
import "./patterns/index.js"
import earcut from "earcut"


/** Use 16-bit indices for indexed geometry. */
const INDEXED_CHUNK_SIZE = 0x10000
/** Arc angle for tessellating point circle shape. */
const POINT_CIRCLE_TESSELLATION_ANGLE = 15 * Math.PI / 180
const POINT_SHAPE_BLOCK_NAME = "__point_shape"
/** Flatten a block if its total vertices count in all instances is less than this value. */
const BLOCK_FLATTENING_VERTICES_THRESHOLD = 1024
/** Number of subdivisions per spline point. */
const SPLINE_SUBDIVISION = 4
/** Limit hatch lines number to some reasonable value to mitigate hanging and out-of-memory issues
 * on bad files.
 */
const MAX_HATCH_LINES = 20000
/** Limit hatch segments number per line to some reasonable value to mitigate hanging and
 * out-of-memory issues on bad files.
 */
const MAX_HATCH_SEGMENTS = 20000


/** Default values for system variables. Entry may be either value or function to call for obtaining
 * a value, the function `this` argument is DxfScene.
 */
const DEFAULT_VARS = {
    /* https://knowledge.autodesk.com/support/autocad/learn-explore/caas/CloudHelp/cloudhelp/2016/ENU/AutoCAD-Core/files/GUID-A17A69D7-25EF-4F57-B4EB-D53A56AB909C-htm.html */
    DIMTXT: function() {
        //XXX should select value for imperial or metric units
        return 2.5 //XXX 0.18 for imperial
    },
    DIMASZ: 2.5, //XXX 0.18 for imperial
    DIMCLRD: 0,
    DIMCLRE: 0,
    DIMCLRT: 0,
    DIMDEC: 2, //XXX 4 for imperial,
    DIMDLE: 0,
    DIMDSEP: ".".charCodeAt(0), //XXX "," for imperial,
    DIMEXE: 1.25, //XXX 0.18 for imperial
    DIMEXO: 0.625, // XXX 0.0625 for imperial
    DIMFXL: 1,
    DIMFXLON: false,
    DIMGAP: 0.625, //XXX for imperial
    DIMLFAC: 1,
    DIMRND: 0,
    DIMSAH: 0,
    DIMSCALE: 1,
    DIMSD1: 0,
    DIMSD2: 0,
    DIMSE1: 0,
    DIMSE2: 0,
    DIMSOXD: false,
    DIMTSZ: 0,
    DIMZIN: 8 //XXX 0 for imperial,
}

/** @param {?{x: number, y: number}} v
 * @param {string} what Names the point in the error message.
 * @throws {Error} When the point is missing or has a non-finite coordinate, as one does when a
 *  file lacks the group code, or spells it "nan".
 */
function CheckFinitePoint(v, what) {
    if (!Number.isFinite(v?.x) || !Number.isFinite(v?.y)) {
        throw new Error(`Non-finite ${what} (${v?.x}, ${v?.y})`)
    }
}

/** @param {Array<{x: number, y: number}>} vertices
 * @param {Matrix3} transform
 * @returns {Vector2[]} New vertices, the source ones are left untouched.
 */
function TransformVertices(vertices, transform) {
    return vertices.map(v => new Vector2(v.x, v.y).applyMatrix3(transform))
}

/** This class prepares an internal representation of a DXF file, optimized fo WebGL rendering. It
 * is decoupled in such a way so that it should be possible to build it in a web-worker, effectively
 * transfer it to the main thread, and easily apply it to a Three.js scene there.
 */
export class DxfScene {

    constructor(options) {
        this.options = Object.create(DxfScene.DefaultOptions)
        if (options) {
            Object.assign(this.options, options.sceneOptions)
        }

        /* Scene origin. All input coordinates are made local to this point to minimize precision
        * loss.
        */
        this.origin = null
        /* RBTree<BatchingKey, RenderBatch> */
        this.batches = new RBTree((b1, b2) => b1.key.Compare(b2.key))
        /* Indexed by layer name, value is layer object from parsed DXF. */
        this.layers = new Map()
        /* Indexed by block name, value is Block. */
        this.blocks = new Map()
        /** Indexed by dimension style name, value is DIMSTYLE object from parsed DXF. */
        this.dimStyles = new Map()
        /** Indexed by variable name (without leading '$'). */
        this.vars = new Map()
        this.fontStyles = new Map()
        /* Indexed by entity handle. */
        this.inserts = new Map()
        this.bounds = null
        this.pointShapeBlock = null
        this.numBlocksFlattened = 0
        this.numEntitiesFiltered = 0
        /* Entities dropped because they are malformed, see _ProcessDxfEntity(). */
        this.numEntitiesSkipped = 0
    }

    /** Build the scene from the provided parsed DXF.
     * @param {{}} dxf Parsed DXF file.
     * @param {?Function[]} fontFetchers List of font fetchers. Fetcher should return promise with
     *  loaded font object (opentype.js). They are invoked only when necessary. Each glyph is being
     *  searched sequentially in each provided font.
     */
    async Build(dxf, fontFetchers) {
        const header = dxf.header || {}

        for (const [name, value] of Object.entries(header)) {
            if (name.startsWith("$")) {
                this.vars.set(name.slice(1), value)
            }
        }

        /* Zero angle direction, 0 is +X. */
        this.angBase = this.vars.get("ANGBASE") ?? 0
        /* 0 - CCW, 1 - CW */
        this.angDir = this.vars.get("ANGDIR") ?? 0
        this.pdMode = this.vars.get("PDMODE") ?? 0
        this.pdSize = this.vars.get("PDSIZE") ?? 0
        this.isMetric = (this.vars.get("MEASUREMENT") ?? 1) == 1

        if (dxf.tables && dxf.tables.layer) {
            for (const [, layer] of Object.entries(dxf.tables.layer.layers)) {
                layer.displayName = ParseSpecialChars(layer.name)
                this.layers.set(layer.name, layer)
            }
        }

        if (dxf.tables && dxf.tables.dimstyle) {
            for (const [, style] of Object.entries(dxf.tables.dimstyle.dimStyles)) {
                this.dimStyles.set(style.name, style)
            }
        }

        if (dxf.tables && dxf.tables.style) {
            for (const [, style] of Object.entries(dxf.tables.style.styles)) {
                this.fontStyles.set(style.styleName, style)
            }
        }

        if (dxf.blocks) {
            for (const [, block] of Object.entries(dxf.blocks)) {
                this.blocks.set(block.name, new Block(block))
            }
        }

        this.textRenderer = new TextRenderer(fontFetchers, this.options.textOptions)
        this.hasMissingChars = false
        await this._FetchFonts(dxf)

        /* Scan all entities to analyze block usage statistics. */
        for (const entity of dxf.entities) {
            if (!this._FilterEntity(entity)) {
                continue
            }
            if (entity.type === "INSERT") {
                this.inserts.set(entity.handle, entity)
                const block = this.blocks.get(entity.name)
                block?.RegisterInsert(entity)

            } else if (entity.type == "DIMENSION") {
                if ((entity.block ?? null) !== null) {
                    const block = this.blocks.get(entity.block)
                    block?.RegisterInsert(entity)
                }
            }
        }

        for (const block of this.blocks.values()) {
            if (block.data.hasOwnProperty("entities")) {
                const blockCtx = block.DefinitionContext()
                for (const entity of block.data.entities) {
                    if (!this._FilterEntity(entity)) {
                        continue
                    }
                    this._ProcessDxfEntity(entity, blockCtx)
                }
            }
            if (block.SetFlatten()) {
                this.numBlocksFlattened++
            }
        }
        console.log(`${this.numBlocksFlattened} blocks flattened`)

        for (const entity of dxf.entities) {
            if (!this._FilterEntity(entity)) {
                this.numEntitiesFiltered++
                continue
            }
            this._ProcessDxfEntity(entity)
        }
        console.log(`${this.numEntitiesFiltered} entities filtered`)
        if (this.numEntitiesSkipped > 0) {
            console.warn(`${this.numEntitiesSkipped} malformed entities skipped`)
        }

        this.scene = this._BuildScene()

        delete this.batches
        delete this.layers
        delete this.blocks
        delete this.textRenderer
    }

    /** @returns {boolean} False to suppress the specified entity, true to permit rendering. */
    _FilterEntity(entity) {
        if (entity.hidden) {
            return false
        }
        const layerName = this._GetEntityLayer(entity)
        if (layerName != "0") {
            const layer = this.layers.get(layerName)
            if (layer?.frozen) {
                return false
            }
        }
        return !this.options.suppressPaperSpace || !entity.inPaperSpace
    }

    async _FetchFonts(dxf) {

        function IsTextEntity(entity) {
            return entity.type === "TEXT" || entity.type === "MTEXT" ||
                   entity.type === "DIMENSION" || entity.type === "ATTDEF" ||
                   entity.type === "ATTRIB"
        }

        /** @returns {string[]} The strings a text entity renders. */
        const GetTexts = (entity) => {
            if (entity.type === "TEXT" || entity.type === "ATTRIB" || entity.type === "ATTDEF") {
                return [ParseSpecialChars(entity.text)]
            }
            if (entity.type === "MTEXT") {
                const parser = new MTextFormatParser()
                parser.Parse(entity.text)
                //XXX formatted MTEXT may specify some fonts explicitly, this is not yet supported
                return Array.from(parser.GetText(), text => ParseSpecialChars(text))
            }
            /* DIMENSION. No block context: this pre-scan only wants the texts, and resolved colors
             * are discarded with the rest of the dimension. Whether the geometry is renderable is
             * reported when it is rendered, not here.
             */
            return this._CreateLinearDimension(entity, null, false)?.GetTexts() ?? []
        }

        /* Should return false if unable to resolve some characters, true otherwise. */
        const ProcessEntity = async (entity) => {
            if (!this._FilterEntity(entity)) {
                return true
            }
            let texts
            try {
                texts = GetTexts(entity)
            } catch {
                /* Malformed, e.g. no text at all. Decomposition fails on it the same way, and that
                 * is where it is reported and skipped.
                 */
                return true
            }
            for (const text of texts) {
                if (!await this.textRenderer.FetchFonts(text)) {
                    this.hasMissingChars = true
                    return false
                }
            }
            return true
        }

        for (const entity of dxf.entities) {
            if (IsTextEntity(entity)) {
                if (!await ProcessEntity(entity)) {
                    /* Failing to resolve some character means that all fonts have been loaded and
                     * checked. No mean to check the rest strings. However until it is encountered,
                     * all strings should be checked, even if all fonts already loaded. This needed
                     * to properly set `hasMissingChars` which allows displaying some warning in a
                     * viewer.
                     */
                    return
                }
            }
        }
        for (const block of this.blocks.values()) {
            if (block.data.hasOwnProperty("entities")) {
                for (const entity of block.data.entities) {
                    if (IsTextEntity(entity)) {
                        if (!await ProcessEntity(entity)) {
                            return
                        }
                    }
                }
            }
        }
    }

    /** Render one DXF entity into the batches.
     *
     * A malformed entity is skipped rather than failing the whole drawing. Everything that can
     * fail on bad input happens in _DecomposeDxfEntity(), before anything is written to a batch,
     * so a skipped entity never leaves part of itself behind. A throw from the writes themselves
     * is a bug here, not in the file, and is deliberately left to fail the build.
     *
     * @param {object} entity Raw DXF entity.
     * @param {?BlockContext} blockCtx
     */
    _ProcessDxfEntity(entity, blockCtx = null) {
        let renderEntities
        try {
            renderEntities = this._DecomposeDxfEntity(entity, blockCtx)
        } catch (error) {
            this.numEntitiesSkipped++
            const handle = entity.handle !== undefined ? ` ${entity.handle}` : ""
            const block = blockCtx ? ` in block ${blockCtx.name}` : ""
            console.warn(`Skipped malformed ${entity.type} entity${handle}${block}:`, error)
            return
        }
        for (const renderEntity of renderEntities) {
            this._ProcessEntity(renderEntity, blockCtx)
        }
    }

    /**
     * @param {object} entity Raw DXF entity.
     * @param {?BlockContext} blockCtx
     * @returns {Entity[]} Validated render entities, still to be written to the batches.
     * @throws {Error} When the entity is malformed.
     */
    _DecomposeDxfEntity(entity, blockCtx) {
        let renderEntities
        switch (entity.type) {
        case "LINE":
            renderEntities = this._DecomposeLine(entity, blockCtx)
            break
        case "POLYLINE":
        case "LWPOLYLINE":
            renderEntities = this._DecomposePolyline(entity, blockCtx)
            break
        case "ARC":
            renderEntities = this._DecomposeArc(entity, blockCtx)
            break
        case "CIRCLE":
            renderEntities = this._DecomposeCircle(entity, blockCtx)
            break
        case "ELLIPSE":
            renderEntities = this._DecomposeEllipse(entity, blockCtx)
            break
        case "POINT":
            renderEntities = this._DecomposePoint(entity, blockCtx)
            break
        case "SPLINE":
            renderEntities = this._DecomposeSpline(entity, blockCtx)
            break
        case "INSERT":
            /* Works with rendering batches without intermediate entities. */
            this._ProcessInsert(entity, blockCtx)
            return []
        case "TEXT":
            renderEntities = this._DecomposeText(entity, blockCtx)
            break
        case "MTEXT":
            renderEntities = this._DecomposeMText(entity, blockCtx)
            break
        case "3DFACE":
            renderEntities = this._Decompose3DFace(entity, blockCtx)
            break
        case "SOLID":
            renderEntities = this._DecomposeSolid(entity, blockCtx)
            break
        case "DIMENSION":
            renderEntities = this._DecomposeDimension(entity, blockCtx)
            break
        case "ATTRIB":
            renderEntities = this._DecomposeAttribute(entity, blockCtx)
            break
        case "HATCH":
            renderEntities = this._DecomposeHatch(entity, blockCtx)
            break
        default:
            console.log("Unhandled entity type: " + entity.type)
            return []
        }
        /* Materialized so that a throw part way through leaves nothing written. */
        renderEntities = Array.from(renderEntities)
        /* Decomposers work in the entity's OCS; this is the one place it is mapped to WCS. Fresh
         * vertices are made rather than transforming in place, because render entities may hold
         * the parsed vertex objects themselves, and a block definition is decomposed again for
         * every nested insert of it.
         */
        const ocsTransform = this._GetEntityOcsTransform(entity)
        for (const renderEntity of renderEntities) {
            if (ocsTransform) {
                renderEntity.vertices = TransformVertices(renderEntity.vertices, ocsTransform)
            }
            renderEntity.Validate()
        }
        return renderEntities
    }
    /**
     * @param {Entity} entity
     * @param {?BlockContext} blockCtx
     */
    _ProcessEntity(entity, blockCtx = null) {
        switch (entity.type) {
        case Entity.Type.POINTS:
            this._ProcessPoints(entity, blockCtx)
            break
        case Entity.Type.LINE_SEGMENTS:
            this._ProcessLineSegments(entity, blockCtx)
            break
        case Entity.Type.POLYLINE:
            this._ProcessPolyline(entity, blockCtx)
            break
        case Entity.Type.TRIANGLES:
            this._ProcessTriangles(entity, blockCtx)
            break
        default:
            throw new Error("Unhandled entity type: " + entity.type)
        }
    }

    /**
     * @param {object} entity Raw DXF entity.
     * @param {?object} vertex Polyline vertex the line type is queried for, if any.
     * @param {?BlockContext} blockCtx
     * @returns {number}
     */
    _GetLineType(entity, vertex = null, blockCtx = null) {
        //XXX lookup
        return 0
    }

    /** Check if start/end with are not specified. */
    _IsPlainLine(entity) {
        //XXX until shaped polylines rendering implemented
        return true
        // return !Boolean(entity.startWidth || entity.endWidth)
    }

    *_DecomposeLine(entity, blockCtx) {
        /* start/end width, bulge - seems cannot be present, at least with current parser */
        if (entity.vertices.length !== 2) {
            return
        }
        const layer = this._GetEntityLayer(entity, blockCtx)
        const color = this._GetEntityColor(entity, blockCtx)
        yield new Entity({
            type: Entity.Type.LINE_SEGMENTS,
            vertices: entity.vertices,
            layer, color,
            lineType: this._GetLineType(entity, entity.vertices[0], blockCtx)
        })
    }

    /** Generate vertices for bulged line segment.
     *
     * @param {Vector2[]} vertices Generated vertices pushed here.
     * @param {{x: number, y: number}} startVtx Starting vertex. Assuming it is already present in
     *  the vertices array.
     * @param {{x: number, y: number}} endVtx Ending vertex.
     * @param {number} bulge Bulge value (see DXF specification).
     */
    _GenerateBulgeVertices(vertices, startVtx, endVtx, bulge) {
        const a = 4 * Math.atan(bulge)
        const aAbs = Math.abs(a)
        if (aAbs < this.options.arcTessellationAngle) {
            vertices.push(new Vector2(endVtx.x, endVtx.y))
            return
        }
        const ha = a / 2
        const sha = Math.sin(ha)
        const cha = Math.cos(ha)
        const d = {x: endVtx.x - startVtx.x, y: endVtx.y - startVtx.y}
        const dSq = d.x * d.x + d.y * d.y
        if (dSq < Number.MIN_VALUE * 2) {
            /* No vertex is pushed since end vertex is duplicate of start vertex. */
            return
        }
        const D = Math.sqrt(dSq)
        let R = D / 2 / sha
        d.x /= D
        d.y /= D
        const center = {
            x: (d.x * sha - d.y * cha) * R + startVtx.x,
            y: (d.x * cha + d.y * sha) * R + startVtx.y
        }

        let numSegments = Math.floor(aAbs / this.options.arcTessellationAngle)
        if (numSegments < this.options.minArcTessellationSubdivisions) {
            numSegments = this.options.minArcTessellationSubdivisions
        }
        if (numSegments > 1) {
            const startAngle = Math.atan2(startVtx.y - center.y, startVtx.x - center.x)
            const step = a / numSegments
            if (a < 0) {
                R = -R
            }
            for (let i = 1; i < numSegments; i++) {
                const a = startAngle + i * step
                const v = new Vector2(
                    center.x + R * Math.cos(a),
                    center.y + R * Math.sin(a)
                )
                vertices.push(v)
            }
        }
        vertices.push(new Vector2(endVtx.x, endVtx.y))
    }

    /** Generate vertices for arc segment.
     *
     * @param {object} params
     * @param {Vector2[]} params.vertices Generated vertices pushed here.
     * @param {{x: number, y: number}} params.center Center vector.
     * @param {number} params.radius
     * @param {?number} params.startAngle Start angle in radians. Zero if not specified. Arc is
     *  drawn in CCW direction from start angle towards end angle.
     * @param {?number} params.endAngle Optional end angle in radians. Full circle is drawn if not
     *  specified.
     * @param {?number} params.tessellationAngle Arc tessellation angle in radians, default value
     *  is taken from scene options.
     * @param {?number} params.yRadius Specify to get ellipse arc. `radius` parameter used as X
     *  radius.
     * @param {?Matrix3} params.transform Optional transform matrix for the arc. Applied as last
     *  operation.
     * @param {?number} params.rotation Optional rotation angle for generated arc. Mostly for
     *  ellipses.
     * @param {?boolean} params.ccwAngleDir True (the default) counts angles counter-clockwise from
     *  the positive X direction, false counts them clockwise.
     * @returns {Vector2[]} List of generated vertices.
     */
    _GenerateArcVertices({vertices, center, radius, startAngle = null, endAngle = null,
                          tessellationAngle = null, yRadius = null, transform = null,
                          rotation = null, ccwAngleDir = true}) {
        if (!center || !radius) {
            return
        }
        if (!tessellationAngle) {
            tessellationAngle = this.options.arcTessellationAngle
        }
        if (yRadius === null) {
            yRadius = radius
        }
        /* Normalize angles - make them starting from +X in CCW direction. End angle should be
         * greater than start angle.
         */
        if (startAngle === undefined || startAngle === null) {
            startAngle = 0
        } else {
            startAngle += this.angBase
        }
        let isClosed = false
        if (endAngle === undefined || endAngle === null) {
            endAngle = startAngle + 2 * Math.PI
            isClosed = true
        } else {
            endAngle += this.angBase
        }

        //XXX this.angDir - not clear, seem in practice it does not alter arcs rendering.
        if (!ccwAngleDir) {
            const tmp = startAngle
            startAngle = -endAngle
            endAngle = -tmp
        }

        while (endAngle <= startAngle) {
            endAngle += Math.PI * 2
        }

        const arcAngle = endAngle - startAngle

        let numSegments = Math.floor(arcAngle / tessellationAngle)
        if (numSegments === 0) {
            numSegments = 1
        }
        const step = arcAngle / numSegments

        let rotationTransform = null
        if (rotation) {
            rotationTransform = new Matrix3().makeRotation(rotation)
        }

        for (let i = 0; i <= numSegments; i++) {
            if (i === numSegments && isClosed) {
                break
            }
            let a
            if (ccwAngleDir) {
                a = startAngle + i * step
            } else {
                a = startAngle + (numSegments - i) * step
            }
            const v = new Vector2(radius * Math.cos(a), yRadius * Math.sin(a))

            if (rotationTransform) {
                v.applyMatrix3(rotationTransform)
            }
            v.add(center)
            if (transform) {
                v.applyMatrix3(transform)
            }
            vertices.push(v)
        }
    }

    *_DecomposeArc(entity, blockCtx) {
        const color = this._GetEntityColor(entity, blockCtx)
        const layer = this._GetEntityLayer(entity, blockCtx)
        const lineType = this._GetLineType(entity, null, blockCtx)
        const vertices = []
        this._GenerateArcVertices({vertices, center: entity.center, radius: entity.radius,
                                   startAngle: entity.startAngle, endAngle: entity.endAngle})
        yield new Entity({
            type: Entity.Type.POLYLINE,
            vertices, layer, color, lineType,
            shape: entity.endAngle === undefined
        })
    }

    *_DecomposeCircle(entity, blockCtx) {
        const color = this._GetEntityColor(entity, blockCtx)
        const layer = this._GetEntityLayer(entity, blockCtx)
        const lineType = this._GetLineType(entity, null, blockCtx)
        const vertices = []
        this._GenerateArcVertices({vertices, center: entity.center, radius: entity.radius})
        yield new Entity({
            type: Entity.Type.POLYLINE,
            vertices, layer, color, lineType,
            shape: true
        })
    }

    *_DecomposeEllipse(entity, blockCtx) {
        const color = this._GetEntityColor(entity, blockCtx)
        const layer = this._GetEntityLayer(entity, blockCtx)
        const lineType = this._GetLineType(entity, null, blockCtx)
        const vertices = []
        /* Center and major axis are in WCS, but the ellipse lies in the plane its extrusion
         * direction is normal to. It is generated in its own frame - X along the major axis, Y
         * along the minor one - and that frame is projected onto WCS XY.
         */
        const center = entity.center
        if (!center) {
            return
        }
        const major = new Vector3(entity.majorAxisEndPoint.x, entity.majorAxisEndPoint.y,
                                  entity.majorAxisEndPoint.z ?? 0)
        const xR = major.length()
        const yR = xR * entity.axisRatio
        const xAxis = major.divideScalar(xR)
        const normal = OcsBasis(entity.extrusionDirection)?.az ?? new Vector3(0, 0, 1)
        const yAxis = new Vector3().crossVectors(normal, xAxis)
        const transform = new Matrix3().set(xAxis.x, yAxis.x, center.x,
                                            xAxis.y, yAxis.y, center.y,
                                            0, 0, 1)

        const startAngle = entity.startAngle ?? 0
        let endAngle = entity.endAngle ?? startAngle + 2 * Math.PI
        while (endAngle <= startAngle) {
            endAngle += Math.PI * 2
        }
        const isClosed = (entity.endAngle ?? null) === null ||
            Math.abs(endAngle - startAngle - 2 * Math.PI) < 1e-6

        this._GenerateArcVertices({vertices, center: {x: 0, y: 0}, radius: xR,
                                   startAngle: entity.startAngle,
                                   endAngle: isClosed ? null : entity.endAngle,
                                   yRadius: yR,
                                   transform})

        yield new Entity({
            type: Entity.Type.POLYLINE,
            vertices, layer, color, lineType,
            shape: isClosed
        })
    }

    *_DecomposePoint(entity, blockCtx) {
        if (this.pdMode === PdMode.NONE) {
            /* Points not displayed. */
            return
        }
        if (this.pdMode !== PdMode.DOT && this.pdSize <= 0) {
            /* Currently not supported. */
            return
        }
        /* Checked up front: the instanced path below writes the position without a render entity
         * to validate, and _CreatePointMarker() would draw a missing one at zero.
         */
        CheckFinitePoint(entity.position, "position")
        const color = this._GetEntityColor(entity, blockCtx)
        const layer = this._GetEntityLayer(entity, blockCtx)
        const markType = this.pdMode & PdMode.MARK_MASK
        const isShaped = (this.pdMode & PdMode.SHAPE_MASK) !== 0

        if (isShaped) {
            if (blockCtx) {
                /* Instancing only ever happens at top level: a nested INSERT is flattened into its
                 * enclosing block definition rather than instanced, and the point shape is no
                 * different. Emitting it inline also keeps the deferred colour out of the batch
                 * key -- an instance batch resolves BYLAYER/BYBLOCK, it cannot carry one.
                 */
                yield* this._GeneratePointShapeEntities(entity.position, layer, color, null, true)
                return
            }
            /* Shaped mark should be instanced. */
            const key = new BatchingKey(layer, POINT_SHAPE_BLOCK_NAME,
                                        BatchingKey.GeometryType.POINT_INSTANCE, color, 0)
            const batch = this._GetBatch(key)
            batch.PushVertex(this._TransformVertex(entity.position, blockCtx))
            this._CreatePointShapeBlock()
            return
        }

        if (markType === PdMode.DOT) {
            yield new Entity({
                type: Entity.Type.POINTS,
                vertices: [entity.position],
                layer, color,
                lineType: null
            })
            return
        }

        const vertices = []
        this._CreatePointMarker(vertices, markType, entity.position)
        yield new Entity({
            type: Entity.Type.LINE_SEGMENTS,
            vertices, layer, color,
            lineType: null
        })
    }

    *_DecomposeAttribute(entity, blockCtx) {
        if (!this.textRenderer.canRender) {
            return
        }

        const insertEntity = this.inserts.get(entity.ownerHandle)
        const layer = this._GetEntityLayer(insertEntity ?? entity, blockCtx)
        const color = this._GetEntityColor(insertEntity ?? entity, blockCtx)

        //XXX lookup font style attributes

        yield* this.textRenderer.Render({
            text: ParseSpecialChars(entity.text),
            fontSize: entity.textHeight * entity.scale,
            startPos: entity.startPoint,
            endPos: entity.endPoint,
            rotation: entity.rotation,
            hAlign: entity.horizontalJustification,
            vAlign: entity.verticalJustification,
            color,
            layer
        })
    }


    /** Create line segments for point marker.
     * @param {Vector2[]} vertices Generated vertices pushed here.
     * @param {number} markType One of PdMode values.
     * @param {?{x: number, y: number}} position point center position, default is zero.
     */
    _CreatePointMarker(vertices, markType, position = null) {
        const _this = this
        function PushVertex(offsetX, offsetY) {
            vertices.push({
                x: (position?.x ?? 0) + offsetX * _this.pdSize * 0.5,
                y: (position?.y ?? 0) + offsetY * _this.pdSize * 0.5
            })
        }

        switch (markType) {
        case PdMode.PLUS:
            PushVertex(0, 1.5)
            PushVertex(0, -1.5)
            PushVertex(-1.5, 0)
            PushVertex(1.5, 0)
            break
        case PdMode.CROSS:
            PushVertex(-1, 1)
            PushVertex(1, -1)
            PushVertex(1, 1)
            PushVertex(-1, -1)
            break
        case PdMode.TICK:
            PushVertex(0, 1)
            PushVertex(0, 0)
            break
        default:
            console.warn("Unsupported point display type: " + markType)
        }
    }

    /** Create point shape block if not yet done. */
    _CreatePointShapeBlock() {
        if (this.pointShapeBlock) {
            return
        }
        /* This mimics DXF block entity. */
        this.pointShapeBlock = new Block({
            name: POINT_SHAPE_BLOCK_NAME,
            position: {x: 0, y: 0}
        })
        /* Fix block origin at zero. */
        this.pointShapeBlock.offset = new Vector2(0, 0)
        const blockCtx = this.pointShapeBlock.DefinitionContext()

        /* The block is the shape itself, centred on zero; the dot is excluded because the
         * instanced path draws it from the instance translations instead.
         */
        for (const entity of this._GeneratePointShapeEntities({x: 0, y: 0}, null,
                                                              ColorCode.BY_BLOCK, 0, false)) {
            this._ProcessEntity(entity, blockCtx)
        }
    }

    /** Geometry of one point display marker, as configured by $PDMODE and $PDSIZE.
     *
     * Shared by the two ways a marker is drawn: once at the origin for the instanced shape block,
     * and inline at the point's own position when the point is inside a block definition.
     *
     * @param {{x: number, y: number}} position Centre of the marker.
     * @param {?string} layer
     * @param {number} color
     * @param {?number} lineType
     * @param {Boolean} includeDot False for the shape block, whose dot comes from the instance
     *  translations instead -- that is what `scene.pointShapeHasDot` tells the renderer.
     * @returns {Generator<Entity>}
     */
    *_GeneratePointShapeEntities(position, layer, color, lineType, includeDot) {
        const markType = this.pdMode & PdMode.MARK_MASK
        if (markType === PdMode.DOT) {
            if (includeDot) {
                yield new Entity({
                    type: Entity.Type.POINTS,
                    vertices: [position],
                    layer, color, lineType
                })
            }
        } else if (markType !== PdMode.NONE) {
            const vertices = []
            this._CreatePointMarker(vertices, markType, position)
            yield new Entity({
                type: Entity.Type.LINE_SEGMENTS,
                vertices, layer, color, lineType
            })
        }

        if (this.pdMode & PdMode.SQUARE) {
            const r = this.pdSize * 0.5
            yield new Entity({
                type: Entity.Type.POLYLINE,
                vertices: [
                    {x: position.x - r, y: position.y + r},
                    {x: position.x + r, y: position.y + r},
                    {x: position.x + r, y: position.y - r},
                    {x: position.x - r, y: position.y - r}
                ],
                layer, color, lineType,
                shape: true
            })
        }
        if (this.pdMode & PdMode.CIRCLE) {
            const vertices = []
            this._GenerateArcVertices({vertices, center: position,
                                       radius: this.pdSize * 0.5,
                                       tessellationAngle: POINT_CIRCLE_TESSELLATION_ANGLE})
            yield new Entity({
                type: Entity.Type.POLYLINE, vertices,
                layer, color, lineType,
                shape: true
            })
        }
    }

    *_Decompose3DFace(entity, blockCtx) {
        yield *this._DecomposeFace(entity, entity.vertices, blockCtx, this.options.wireframeMesh)
    }

    *_DecomposeSolid(entity, blockCtx) {
        /* SOLID corners go in "Z" order: the third and the fourth are swapped against the outline,
         * which is the order 3DFACE uses.
         */
        const p = entity.points
        const vertices = p.length > 3 ? [p[0], p[1], p[3], p[2]] : p
        yield *this._DecomposeFace(entity, vertices, blockCtx, false)
    }

    /**
     * @param {object} entity
     * @param {Array<{x: number, y: number}>} vertices Three or four corners, in outline order. The
     *  fourth one may repeat one of the others, which makes the face a triangle.
     * @param {?BlockContext} blockCtx
     * @param {boolean} wireframe Yield the outline instead of the triangles.
     * @returns {Generator<Entity>}
     */
    *_DecomposeFace(entity, vertices, blockCtx, wireframe) {
        const layer = this._GetEntityLayer(entity, blockCtx)
        const color = this._GetEntityColor(entity, blockCtx)

        const corners = vertices.slice(0, 4).map(v => new Vector2(v.x, v.y))

        /* Twice the signed area. */
        function Area(i1, i2, i3) {
            const e1 = new Vector2().subVectors(corners[i2], corners[i1])
            const e2 = new Vector2().subVectors(corners[i3], corners[i1])
            return e1.cross(e2)
        }

        let triangles
        if (corners.length < 4) {
            triangles = [[0, 1, 2]]
        } else if (Area(0, 1, 2) * Area(0, 2, 3) >= 0) {
            triangles = [[0, 1, 2], [0, 2, 3]]
        } else {
            /* Corners 1 and 3 are on the same side of the 0-2 diagonal, so the quad is concave at
             * one of them, and only the 1-3 diagonal is inside it.
             */
            triangles = [[0, 1, 3], [1, 2, 3]]
        }
        /* A repeated corner leaves a triangle with no area. */
        triangles = triangles.filter(t => Math.abs(Area(...t)) > Number.EPSILON)
        if (triangles.length == 0) {
            return
        }

        /* A single triangle leaves a corner unused, which is not worth storing: a TIN is often
         * made of nothing but three-corner faces.
         */
        if (triangles.length == 1) {
            const triangle = triangles[0].map(i => corners[i])
            if (wireframe) {
                yield new Entity({
                    type: Entity.Type.POLYLINE, vertices: triangle, layer, color, shape: true
                })
            } else {
                yield new Entity({
                    type: Entity.Type.TRIANGLES,
                    vertices: triangle, indices: [0, 1, 2], layer, color
                })
            }
        } else if (wireframe) {
            yield new Entity({
                type: Entity.Type.POLYLINE, vertices: corners, layer, color, shape: true
            })
        } else {
            yield new Entity({
                type: Entity.Type.TRIANGLES,
                vertices: corners, indices: triangles.flat(), layer, color
            })
        }
    }

    *_DecomposeText(entity, blockCtx) {
        if (!this.textRenderer.canRender) {
            return
        }
        const layer = this._GetEntityLayer(entity, blockCtx)
        const color = this._GetEntityColor(entity, blockCtx)
        const style = this._GetEntityTextStyle(entity)
        const fixedHeight = style?.fixedTextHeight === 0 ? null : style?.fixedTextHeight
        yield* this.textRenderer.Render({
            text: ParseSpecialChars(entity.text),
            fontSize: entity.textHeight ?? (fixedHeight ?? 1),
            startPos: entity.startPoint,
            endPos: entity.endPoint,
            rotation: entity.rotation,
            hAlign: entity.halign,
            vAlign: entity.valign,
            widthFactor: entity.xScale,
            color, layer
        })
    }

    *_DecomposeMText(entity, blockCtx) {
        if (!this.textRenderer.canRender) {
            return
        }
        const layer = this._GetEntityLayer(entity, blockCtx)
        const color = this._GetEntityColor(entity, blockCtx)
        const style = this._GetEntityTextStyle(entity)
        const fixedHeight = style?.fixedTextHeight === 0 ? null : style?.fixedTextHeight
        const parser = new MTextFormatParser()
        parser.Parse(ParseSpecialChars(entity.text))

        let position = entity.position
        let rotation = entity.rotation
        let direction = entity.direction
        let transform = null
        const basis = OcsBasis(entity.extrusionDirection)
        if (basis) {
            /* The text plane is tilted. The insertion point and direction are in WCS, while a
             * rotation angle is measured from the OCS X axis. The text is laid out unrotated at
             * zero, and that layout frame is projected onto WCS XY.
             */
            let xAxis = null
            if (direction) {
                xAxis = new Vector3(direction.x, direction.y, direction.z ?? 0)
            }
            if (!xAxis || xAxis.lengthSq() === 0) {
                const angle = (rotation ?? 0) * Math.PI / 180
                xAxis = basis.ax.clone().multiplyScalar(Math.cos(angle))
                    .addScaledVector(basis.ay, Math.sin(angle))
            }
            xAxis.normalize()
            const yAxis = new Vector3().crossVectors(basis.az, xAxis)
            transform = new Matrix3().set(xAxis.x, yAxis.x, position.x,
                                          xAxis.y, yAxis.y, position.y,
                                          0, 0, 1)
            position = {x: 0, y: 0}
            rotation = 0
            direction = null
        }

        const renderEntities = this.textRenderer.RenderMText({
            formattedText: parser.GetContent(),
            // May still be overwritten by inline formatting codes
            fontSize: entity.height ?? fixedHeight,
            position, rotation, direction,
            attachment: entity.attachmentPoint,
            lineSpacing: entity.lineSpacing,
            width: entity.width,
            color, layer
        })
        if (!transform) {
            yield* renderEntities
            return
        }
        for (const renderEntity of renderEntities) {
            renderEntity.vertices = TransformVertices(renderEntity.vertices, transform)
            yield renderEntity
        }
    }

    /**
     * @param {object} entity Raw DXF DIMENSION entity.
     * @param {?BlockContext} blockCtx
     * @param {Boolean} reportInvalid Warn about geometry which cannot be laid out. Only the call
     *  which renders the dimension does, so that a dimension the font pre-scan also builds is not
     *  reported twice.
     * @returns {?LinearDimension} Dimension handler instance, null if not possible to create from
     * the provided entity.
     */
    _CreateLinearDimension(entity, blockCtx = null, reportInvalid = true) {
        const type = (entity.dimensionType || 0) & 0xf
        /* For now support linear dimensions only. */
        if ((type != 0 && type != 1) || !entity.linearOrAngularPoint1 ||
            !entity.linearOrAngularPoint2 || !entity.anchorPoint) {

            return null
        }

        let style = null
        if (entity.hasOwnProperty("styleName")) {
            style = this.dimStyles.get(entity.styleName)
        }

        /* The definition points are in WCS while the layout is made in the dimension's OCS, like
         * the text midpoint, and taken to WCS along with everything else the entity produces.
         */
        const basis = OcsBasis(entity.extrusionDirection)
        const ToOcs = p => new Vector2().copy(basis ? WcsToOcs(basis, p) : p)

        const dim = new LinearDimension({
            p1: ToOcs(entity.linearOrAngularPoint1),
            p2: ToOcs(entity.linearOrAngularPoint2),
            anchor: ToOcs(entity.anchorPoint),
            isAligned: type == 1,
            angle: entity.angle,
            text: entity.text,
            textAnchor: entity.middleOfText ? new Vector2().copy(entity.middleOfText) : null,
            textRotation: entity.textRotation

        /* styleResolver */
        }, valueName => {
            const value = this._GetDimStyleValue(valueName, entity, style)
            if (DIM_COLOR_VARS.has(valueName)) {
                return this._ResolveDimStyleColor(value, entity, blockCtx)
            }
            return value

        /* textWidthCalculator */
        }, (text, fontSize) => {
            return this.textRenderer.GetLineWidth(text, fontSize)
        })

        if (!dim.IsValid()) {
            if (reportInvalid) {
                console.warn("Invalid dimension geometry detected for " + entity.handle)
            }
            return null
        }

        return dim
    }

    /** Resolve a DIMSTYLE color variable to an RGB value.
     *
     * DIMCLRD, DIMCLRE and DIMCLRT hold DXF *color numbers*, not colors: 0 is BYBLOCK, 256 is
     * BYLAYER and 1..255 index the ACI table. They default to 0. Using one directly as an RGB
     * value - which is what happened until 2026-09-16 - paints every synthesized dimension
     * 0x000000, and would turn a DIMCLRD of 1 ("red") into 0x000001.
     *
     * A dimension's geometry lives in a block, so BYBLOCK means the DIMENSION entity's own color.
     *
     * @param {?number} value Raw variable value.
     * @param {{}} entity The DIMENSION entity.
     * @param {?BlockContext} blockCtx
     * @returns {number} RGB value, or a ColorCode sentinel when inside a block definition, exactly
     *  as _GetEntityColor would return.
     */
    _ResolveDimStyleColor(value, entity, blockCtx) {
        if (value === null || value === undefined || value === 0) {
            /* BYBLOCK: the dimension's geometry takes the entity's color. */
            return this._GetEntityColor(entity, blockCtx)
        }
        if (value === 256) {
            const layerName = this._GetEntityLayer(entity, blockCtx)
            const layer = layerName !== null ? this.layers.get(layerName) : null
            if (layer) {
                return layer.color
            }
            return blockCtx ? ColorCode.BY_LAYER : 0
        }
        const color = colorTable[value]
        if (color === undefined) {
            console.warn(`Unrecognized dimension style color index: ${value}`)
            return this._GetEntityColor(entity, blockCtx)
        }
        return color
    }

    *_DecomposeDimension(entity, blockCtx) {
        if ((entity.block ?? null) !== null && this.blocks.has(entity.block)) {
            /* Dimension may have pre-rendered block attached. Then just render this block instead
             * of synthesizing dimension geometry from parameters.
             *
             * Create dummy INSERT entity. The block content is in the dimension's OCS, at the
             * elevation of its text midpoint.
             */
            const insert = {
                name: entity.block,
                position: {
                    x: 0, y: 0,
                    z: this._GetDimensionElevation(entity, OcsBasis(entity.extrusionDirection))
                },
                extrusionDirection: entity.extrusionDirection,
                layer: entity.layer,
                color: entity.color,
                colorIndex: entity.colorIndex
            }
            this._ProcessInsert(insert, blockCtx)
            return
        }

        /* https://ezdxf.readthedocs.io/en/stable/tutorials/linear_dimension.html
         * https://ezdxf.readthedocs.io/en/stable/tables/dimstyle_table_entry.html
         */

        const dim = this._CreateLinearDimension(entity, blockCtx)
        if (!dim) {
            return
        }

        const layer = this._GetEntityLayer(entity, blockCtx)
        const color = this._GetEntityColor(entity, blockCtx)

        const layout = dim.GenerateLayout()

        for (const line of layout.lines) {
            const vertices = [line.start, line.end]

            yield new Entity({
                type: Entity.Type.LINE_SEGMENTS,
                vertices,
                layer,
                color: line.color ?? color
            })
        }

        for (const triangle of layout.triangles) {
            yield new Entity({
                type: Entity.Type.TRIANGLES,
                vertices: triangle.vertices,
                indices: triangle.indices,
                layer,
                color: triangle.color ?? color
            })
        }

        if (this.textRenderer.canRender) {
            for (const text of layout.texts) {
                yield* this.textRenderer.Render({
                    text: text.text,
                    fontSize: text.size,
                    startPos: text.position,
                    rotation: text.angle,
                    hAlign: HAlign.CENTER,
                    vAlign: VAlign.MIDDLE,
                    color: text.color ?? color,
                    layer
                })
            }
        }
    }


    /**
     * @param {Vector2[]} loop Loop vertices.
     * @param {number[] | null} result Resulting coordinates appended to this array.
     * @returns {number[]} Each pair of numbers form vertex coordinate. This format is required for
     *  `earcut` library.
     */
    _GetBoundaryLoopCoords(loop, result) {
        if (!result) {
            result = []
        }
        for (const v of loop) {
            result.push(v.x)
            result.push(v.y)
        }
        return result
    }

    *_DecomposeHatch(entity, blockCtx) {
        const boundaryLoops = this._GetHatchBoundaryLoops(entity)
        if (boundaryLoops.length == 0) {
            console.warn("HATCH entity with empty boundary loops array " +
                "(perhaps some loop types are not implemented yet)")
            return
        }

        const style = entity.hatchStyle ?? 0
        const layer = this._GetEntityLayer(entity, blockCtx)
        const color = this._GetEntityColor(entity, blockCtx)

        let filteredBoundaryLoops = null

        /* Make external loop first, outermost the second, all the rest in arbitrary order. Now is
         * required only for solid infill.
         */
        boundaryLoops.sort((a, b) => {
            if (a.isExternal != b.isExternal) {
                return a.isExternal ? -1 : 1
            }
            if (a.isOutermost != b.isOutermost) {
                return a.isOutermost ? -1 : 1
            }
            return 0
        })

        if (style == HatchStyle.THROUGH_ENTIRE_AREA) {
            /* Leave external loops only. A hatch can have several of them - the inner structure is
             * what this style ignores, not the other outlines.
             */
            filteredBoundaryLoops = []
            for (const loop of boundaryLoops) {
                if (loop.isExternal) {
                    filteredBoundaryLoops.push(loop.vertices)
                }
            }
            if (filteredBoundaryLoops.length == 0) {
                filteredBoundaryLoops = null
            }

        } else if (style == HatchStyle.OUTERMOST) {
            /* Leave external and outermost loop. */
            filteredBoundaryLoops = []
            for (const loop of boundaryLoops) {
                if (loop.isExternal || loop.isOutermost) {
                    filteredBoundaryLoops.push(loop.vertices)
                }
            }
            if (filteredBoundaryLoops.length == 0) {
                filteredBoundaryLoops = null
            }
        }

        if (!filteredBoundaryLoops) {
            /* Fall-back to full list. */
            filteredBoundaryLoops = boundaryLoops.map(loop => loop.vertices)
        }

        const calc = new HatchCalculator(filteredBoundaryLoops, style)

        if (entity.isSolid) {
            /* Each region is triangulated on its own: the loops of one hatch may well be disjoint
             * areas rather than a single contour with its islands.
             */
            for (const {contour, holes} of calc.GetSolidRegions()) {
                const coords = this._GetBoundaryLoopCoords(contour)
                const vertices = [...contour]
                const holeIndices = []
                for (const hole of holes) {
                    holeIndices.push(coords.length / 2)
                    this._GetBoundaryLoopCoords(hole, coords)
                    vertices.push(...hole)
                }
                const indices = earcut(coords, holeIndices)
                if (indices.length == 0) {
                    continue
                }
                yield new Entity({
                    type: Entity.Type.TRIANGLES,
                    vertices, indices, layer, color
                })
            }
            return
        }

        let pattern = null
        if (entity.definitionLines) {
            pattern = new Pattern(entity.definitionLines, entity.patternName, false)
        }
        /* QCAD embeds a single 45 degree solid line into every hatch it exports, whatever the
         * pattern is named, so a definition of that shape may be a placeholder for the named
         * pattern - but it may equally be the truth, because ANSI31 is that line. Only the named
         * pattern can tell the two apart, and where it agrees the embedded copy is the one to
         * keep: it records the spacing the hatch was actually drawn at, while the registry's has
         * still to be scaled, and `$MEASUREMENT` says by how much and is wrong by a factor of 25.4
         * in six of the drawings in test-data/.
         */
        if ((pattern == null || pattern.isQcadDefault) && entity.patternName) {
            const _pattern = LookupPattern(entity.patternName, this.isMetric)
            if (!_pattern) {
                console.log(`Hatch pattern with name ${entity.patternName} not found ` +
                            `(metric: ${this.isMetric})`)
            } else if (pattern == null || pattern.ContradictsNamedPattern(_pattern)) {
                pattern = _pattern
            }
        }
        if (pattern == null) {
            pattern = LookupPattern("ANSI31")
        }

        if (!pattern) {
            return
        }

        const seedPoints = entity.seedPoints ? entity.seedPoints : [{x: 0, y: 0}]

        for (const seedPoint of seedPoints) {

            /* Seems pattern transform is not applied at all if using lines definition embedded into
             * HATCH entity (according to observation of AutoDesk viewer behavior).
             */
            const patTransform = pattern.offsetInLineSpace ? calc.GetPatternTransform({
                seedPoint,
                angle: entity.patternAngle,
                scale: entity.patternScale
            }) : new Matrix3()

            for (const line of pattern.lines) {
                yield* this._DecomposeHatchPatternLine(line, calc, patTransform,
                                                       pattern.offsetInLineSpace,
                                                       {layer, color})
            }
        }
    }

    /**
     * Generate segments for one line of a hatch pattern. The pattern line defines a whole family
     * of parallel lines, each one `offset` further than the previous one; this covers the part of
     * the family which intersects the hatch bounding box.
     * @param {Object} line Pattern line definition.
     * @param {HatchCalculator} calc
     * @param {Matrix3} patTransform Pattern transform, identity matrix when the pattern is taken
     *  from the lines definition embedded into the HATCH entity.
     * @param {Boolean} offsetInLineSpace Pattern offsets are already rotated by the line angle.
     * @param {Object} renderParams `layer` and `color` for produced entities.
     */
    *_DecomposeHatchPatternLine(line, calc, patTransform, offsetInLineSpace, renderParams) {
        let offsetX
        let offsetY
        if (offsetInLineSpace) {
            offsetX = line.offset.x
            offsetY = line.offset.y
        } else {
            const sin = Math.sin(-(line.angle ?? 0))
            const cos = Math.cos(-(line.angle ?? 0))
            offsetX = line.offset.x * cos - line.offset.y * sin
            offsetY = line.offset.x * sin + line.offset.y * cos
        }

        /* Normalize offset so that Y is always non-negative. Inverting offset vector direction
         * does not change lines positions.
         */
        if (offsetY < 0) {
            offsetY = -offsetY
            offsetX = -offsetX
        }

        const lineTransform = calc.GetLineTransform({
            patTransform,
            basePoint: line.base,
            angle: line.angle ?? 0
        })

        const bbox = calc.GetBoundingBox(lineTransform)
        const margin = (bbox.max.x - bbox.min.x) * 0.05

        /* First determine range of line indices. Line with index 0 goes through base point
         * (which is [0; 0] in line coordinates system). Line with index `n`` starts in `n`
         * offset vectors added to the base point.
         */
        let minLineIdx, maxLineIdx
        if (offsetY == 0) {
            /* Degenerated to single line. */
            minLineIdx = 0
            maxLineIdx = 0
        } else {
            minLineIdx = Math.ceil(bbox.min.y / offsetY)
            maxLineIdx = Math.floor(bbox.max.y / offsetY)
        }

        if (maxLineIdx - minLineIdx > MAX_HATCH_LINES) {
            console.warn("Too many lines produced by hatching pattern")
            return
        }

        let dashPatLength
        if (line.dashes && line.dashes.length > 1) {
            dashPatLength = 0
            for (const dash of line.dashes) {
                if (dash < 0) {
                    dashPatLength -= dash
                } else {
                    dashPatLength += dash
                }
            }
        } else {
            dashPatLength = null
        }

        const ocsTransform = lineTransform.clone().invert()

        for (let lineIdx = minLineIdx; lineIdx <= maxLineIdx; lineIdx++) {
            yield* this._DecomposeHatchLine(line.dashes, calc, {
                y: lineIdx * offsetY,
                xBase: lineIdx * offsetX,
                xStart: bbox.min.x - margin,
                xEnd: bbox.max.x + margin,
                ocsTransform,
                dashPatLength
            }, renderParams)
        }
    }

    /**
     * Generate segments for a single line of a hatch pattern line family, clipping it against the
     * boundary loops and applying the dash pattern if there is one.
     * @param {?number[]} dashes Dash pattern of the pattern line, negative values are spaces.
     * @param {HatchCalculator} calc
     * @param {Object} lineParams Position of the line in line space (`y`, `xBase`, `xStart`,
     *  `xEnd`), `ocsTransform` back into OCS, and `dashPatLength` (null for a solid line).
     * @param {Object} renderParams `layer` and `color` for produced entities.
     */
    *_DecomposeHatchLine(dashes, calc, {y, xBase, xStart, xEnd, ocsTransform, dashPatLength},
                         {layer, color}) {

        const lineLength = xEnd - xStart
        const start = new Vector2(xStart, y).applyMatrix3(ocsTransform)
        const end = new Vector2(xEnd, y).applyMatrix3(ocsTransform)
        const lineVec = end.clone().sub(start)
        const clippedSegments = calc.ClipLine([start, end])

        function GetParam(x) {
            return (x - xStart) / lineLength
        }

        function RenderSegment(seg) {
            const p1 = lineVec.clone().multiplyScalar(seg[0]).add(start)
            const p2 = lineVec.clone().multiplyScalar(seg[1]).add(start)
            if (seg[1] - seg[0] <= Number.EPSILON) {
                return new Entity({
                    type: Entity.Type.POINTS,
                    vertices: [p1],
                    layer, color
                })
            }
            return new Entity({
                type: Entity.Type.LINE_SEGMENTS,
                vertices: [p1, p2],
                layer, color
            })
        }

        /** Clip segment against `clippedSegments`. */
        function *ClipSegment(segStart, segEnd) {
            for (const seg of clippedSegments) {
                if (seg[0] >= segEnd) {
                    return
                }
                if (seg[1] <= segStart) {
                    continue
                }
                const _start = Math.max(segStart, seg[0])
                const _end = Math.min(segEnd, seg[1])
                yield [_start, _end]
                segStart = _end
            }
        }

        if (dashPatLength === null) {
            /* Single solid line. */
            for (const seg of clippedSegments) {
                yield RenderSegment(seg)
            }
            return
        }

        /* Determine range for segment indices. One segment is one full sequence of dashes. */
        const minSegIdx = Math.floor((xStart - xBase) / dashPatLength)
        const maxSegIdx = Math.floor((xEnd - xBase) / dashPatLength)
        if (maxSegIdx - minSegIdx >= MAX_HATCH_SEGMENTS) {
            console.warn("Too many segments produced by hatching pattern line")
            return
        }

        for (let segIdx = minSegIdx; segIdx <= maxSegIdx; segIdx++) {
            let segStartParam = GetParam(xBase + segIdx * dashPatLength)

            for (let dashLength of dashes) {
                const isSpace = dashLength < 0
                if (isSpace) {
                    dashLength = -dashLength
                }
                const dashLengthParam = dashLength / lineLength
                if (!isSpace) {
                    for (const seg of ClipSegment(segStartParam,
                                                  segStartParam + dashLengthParam)) {
                        yield RenderSegment(seg)
                    }
                }
                segStartParam += dashLengthParam
            }
        }
    }

    /**
     * @typedef {Object} HatchBoundaryLoop
     * @property {Vector2[]} vertices List of points in OCS coordinates.
     * @property {Boolean} isExternal
     * @property {Boolean} isOutermost
     */

    /** @returns {HatchBoundaryLoop[]} Each loop is a list of points in OCS coordinates. */
    _GetHatchBoundaryLoops(entity) {
        if (!entity.boundaryLoops) {
            return []
        }

        const result = []

        const AddPoints = (vertices, points) => {
            const n = points.length
            if (n == 0) {
                return
            }
            if (vertices.length == 0) {
                vertices.push(points[0])
            } else {
                const lastPt = vertices[vertices.length - 1]
                if (lastPt.x != points[0].x || lastPt.y != points[0].y) {
                    vertices.push(points[0])
                }
            }
            for (let i = 1; i < n; i++) {
                vertices.push(points[i])
            }
        }

        for (const loop of entity.boundaryLoops) {
            /* A textbox path (group 92 bit 8) is the bounding box of a text entity the
             * associative hatch was created from, not a piece of its outline: AutoCAD writes one
             * per label in the boundary set, and hatching them paints a rectangle wherever that
             * label happens to sit. They are marked external like a real outline, so the style
             * filters below keep them. ezdxf ignores them when building hatch paths
             * (`filter_text_boxes`) and the Autodesk viewer shows no such rectangles; that they
             * may be the box of text *inside* the hatch, where island detection would want them
             * as holes, does not change what they are - a text box is never a fill area.
             */
            if (loop.isTextbox) {
                continue
            }

            const vertices = []

            if (loop.type & 2) {
                /* Polyline. */
                for (let vtxIdx = 0; vtxIdx < loop.polyline.vertices.length; vtxIdx++) {
                    const vtx = loop.polyline.vertices[vtxIdx]
                    if ((vtx.bulge ?? 0) == 0) {
                        vertices.push(new Vector2(vtx.x, vtx.y))
                    } else {
                        const prevVtx = loop.polyline.vertices[vtxIdx == 0 ?
                            loop.polyline.vertices.length - 1 : vtxIdx - 1]
                        if ((prevVtx.bulge ?? 0) == 0) {
                            /* Start vertex is not produced by _GenerateBulgeVertices(). */
                            vertices.push(new Vector2(vtx.x, vtx.y))
                        }
                        const nextVtx = loop.polyline.vertices[
                            vtxIdx == loop.polyline.vertices.length - 1 ? 0 : vtxIdx + 1]
                        this._GenerateBulgeVertices(vertices, vtx, nextVtx, vtx.bulge)
                    }
                }

            } else if (loop.edges && loop.edges.length > 0) {
                for (const edge of loop.edges) {
                    switch (edge.type) {
                    case 1:
                        /* Line segment. */
                        AddPoints(vertices, [new Vector2(edge.start.x, edge.start.y),
                                             new Vector2(edge.end.x, edge.end.y)])
                        break
                    case 2: {
                        /* Circular arc. */
                        const arcVertices = []
                        this._GenerateArcVertices({
                            vertices: arcVertices,
                            center: edge.start,
                            radius: edge.radius,
                            startAngle: edge.startAngle,
                            endAngle: edge.endAngle,
                            ccwAngleDir: edge.isCcw
                        })
                        AddPoints(vertices, arcVertices)
                        break
                    }
                    case 3: {
                        /* Elliptic arc. */
                        const center = edge.start
                        const majorAxisEndPoint = edge.end
                        const xR = Math.sqrt(majorAxisEndPoint.x * majorAxisEndPoint.x +
                                             majorAxisEndPoint.y * majorAxisEndPoint.y)
                        const axisRatio = edge.radius
                        const yR = xR * axisRatio
                        const rotation = Math.atan2(majorAxisEndPoint.y, majorAxisEndPoint.x)
                        const arcVertices = []
                        this._GenerateArcVertices({
                            vertices: arcVertices,
                            center,
                            radius: xR,
                            startAngle: edge.startAngle,
                            endAngle: edge.endAngle,
                            yRadius: yR,
                            ccwAngleDir: edge.isCcw
                        })
                        if (rotation !== 0) {
                            //XXX should account angDir?
                            const cos = Math.cos(rotation)
                            const sin = Math.sin(rotation)
                            for (const v of arcVertices) {
                                const tx = v.x - center.x
                                const ty = v.y - center.y
                                /* Rotate the vertex around the ellipse center point. */
                                v.x = tx * cos - ty * sin + center.x
                                v.y = tx * sin + ty * cos + center.y
                            }
                        }
                        AddPoints(vertices, arcVertices)
                        break
                    }
                    case 4:
                        /* Spline. */
                        if (!edge.controlPoints) {
                            //XXX a spline given by fit points has no control points to interpolate,
                            //and converting one form to the other is the same unsolved gap as for
                            //SPLINE entities. Skipping the edge leaves the loop open, which is what
                            //dropping the whole path used to do.
                            console.warn("Hatch boundary spline edge without control points")
                            break
                        }
                        const controlPoints = edge.controlPoints.map(p => [p.x, p.y])
                        const subdivisions = controlPoints.length * SPLINE_SUBDIVISION
                        const step = 1 / subdivisions
                        for (let i = 0; i <= subdivisions; i++) {
                            const pt = this._InterpolateSpline(i * step, edge.degreeOfSplineCurve,
                                                               controlPoints,
                                                               edge.knotValues)
                            vertices.push(new Vector2(pt[0], pt[1]))
                        }
                        break
                    default:
                        console.warn("Unhandled hatch boundary loop edge type: " + edge.type)
                    }
                }
            }

            if (vertices.length > 2) {
                const first = vertices[0]
                const last = vertices[vertices.length - 1]
                if (last.x == first.x && last.y == first.y) {
                    vertices.length = vertices.length - 1
                }
            }
            if (vertices.length > 2) {
                result.push({
                    vertices,
                    isExternal: loop.isExternal,
                    isOutermost: loop.isOutermost
                })
            }
        }

        return result
    }

    _GetDimStyleValue(valueName, entity, style) {
        const entries = entity?.xdata?.ACAD?.DSTYLE?.values
        if (entries) {
            let isVarCode = true
            let found = false
            for (const e of entries) {
                if (isVarCode) {
                    if (e.code != 1070) {
                        /* Unexpected group code. */
                        break
                    }
                    if (dimStyleCodes.get(e.value) == valueName) {
                        found = true
                    }
                } else if (found) {
                    return e.value
                }
                isVarCode = !isVarCode
            }
        }
        if (style && style.hasOwnProperty(valueName)) {
            return style[valueName]
        }
        if (this.vars.has(valueName)) {
            return this.vars.get(valueName)
        }
        if (DEFAULT_VARS.hasOwnProperty(valueName)) {
            const value = DEFAULT_VARS[valueName]
            if (value instanceof Function) {
                return value.call(this)
            }
            return value
        }
        return null
    }

    /**
     * Updates batches directly.
     * @param {object} entity Raw DXF INSERT entity.
     * @param {?BlockContext} blockCtx Nested block insert when non-null.
     */
    _ProcessInsert(entity, blockCtx = null) {
        if (blockCtx) {
            if (blockCtx.IsRecursiveReference(entity.name)) {
                console.warn("Recursive block reference: " +
                             blockCtx.DescribeBlockPath(entity.name))
                return
            }
            /* Flatten nested blocks definition. */
            const block = this.blocks.get(entity.name)
            if (!block) {
                console.warn("Unresolved nested block reference: " + entity.name)
                return
            }
            const nestedCtx = blockCtx.NestedBlockContext(block, entity)
            if (block.data.entities) {
                for (const entity of block.data.entities) {
                    this._ProcessDxfEntity(entity, nestedCtx)
                }
            }
            return
        }

        const block = this.blocks.get(entity.name)
        if (!block) {
            console.warn("Unresolved block reference in INSERT: " + entity.name)
            return
        }
        if (!block.HasGeometry()) {
            return
        }

        const layer = this._GetEntityLayer(entity, null)
        const color = this._GetEntityColor(entity, null)
        const lineType = this._GetLineType(entity, null, null)
        const transform = block.InstantiationContext().GetInsertionTransform(entity)

        /* Update bounding box and origin with transformed block bounds corner points. */
        const bounds = block.bounds
        this._UpdateBounds(new Vector2(bounds.minX, bounds.minY).applyMatrix3(transform))
        this._UpdateBounds(new Vector2(bounds.maxX, bounds.maxY).applyMatrix3(transform))
        this._UpdateBounds(new Vector2(bounds.minX, bounds.maxY).applyMatrix3(transform))
        this._UpdateBounds(new Vector2(bounds.maxX, bounds.minY).applyMatrix3(transform))

        MatrixTranslate(transform, -this.origin.x, -this.origin.y)
        //XXX grid instancing not supported yet
        if (block.flatten) {
            for (const batch of block.batches) {
                this._FlattenBatch(batch, layer, color, lineType, transform)
            }
        } else {
            const key = new BatchingKey(layer, entity.name, BatchingKey.GeometryType.BLOCK_INSTANCE,
                                        color, lineType)
            const batch = this._GetBatch(key)
            batch.PushInstanceTransform(transform)
        }
    }

    /** Flatten block definition batch. It is merged into suitable instant rendering batch. */
    _FlattenBatch(blockBatch, layerName, blockColor, blockLineType, transform) {
        /* INSERT layer (if specified) takes precedence over layer specified in block definition.
         * Use layer from block definition only if no layer in INSERT.
         */
        layerName ??= blockBatch.key.layerName
        const layer = layerName ? this.layers.get(layerName) : null
        let color, lineType = 0
        if (blockBatch.key.color === ColorCode.BY_BLOCK) {
            color = blockColor
        } else if (blockBatch.key.color === ColorCode.BY_LAYER) {
            color = layer?.color ?? 0
        } else {
            color = blockBatch.key.color
        }
        //XXX line type
        const key = new BatchingKey(layerName, null, blockBatch.key.geometryType, color, lineType)
        const batch = this._GetBatch(key)
        batch.Merge(blockBatch, transform)
    }

    /**
     * Generate entities for shaped polyline (e.g. line resulting in mesh). All segments are shaped
     * (have start/end width). Segments may be bulge.
     * @param {Array<{x: number, y: number}>} vertices
     * @param {?string} layer
     * @param {number} color
     * @param {?number} lineType
     * @param {Boolean} shape True if closed polyline.
     * @returns {Generator<Entity>}
     */
    *_GenerateShapedPolyline(vertices, layer, color, lineType, shape) {
        //XXX
        yield new Entity({
                             type: Entity.Type.POLYLINE,
                             vertices,
                             layer,
                             color,
                             lineType,
                             shape
        })
    }

    *_DecomposePolyline(entity, blockCtx = null) {

        if (entity.isPolyfaceMesh) {
            yield *this._DecomposePolyfaceMesh(entity, blockCtx)
            return
        }

        let entityVertices, verticesCount
        if (entity.includesCurveFitVertices || entity.includesSplineFitVertices) {
            entityVertices = entity.vertices.filter(v => v.splineVertex || v.curveFittingVertex)
            verticesCount = entityVertices.length
        } else {
            entityVertices = entity.vertices
            verticesCount = entity.vertices.length
        }
        if (entity.shape && verticesCount > 1) {
            const first = entityVertices[0]
            const last = entityVertices[verticesCount - 1]
            if (last.x === first.x && last.y === first.y) {
                /* Closed explicitly as well as by the flag. A closed shape returns to its first
                 * vertex by itself, and the segment from the repeated one is zero-length, so its
                 * bulge and widths do not matter either.
                 */
                entityVertices = entityVertices.slice(0, -1)
                verticesCount--
            }
        }
        if (verticesCount < 2) {
            return
        }
        const color = this._GetEntityColor(entity, blockCtx)
        const layer = this._GetEntityLayer(entity, blockCtx)
        const _this = this
        let startIdx = 0
        let curPlainLine = this._IsPlainLine(entityVertices[0])
        let curLineType = this._GetLineType(entity, entityVertices[0], blockCtx)
        let curVertices = null

        function *CommitSegment(endIdx) {
            if (endIdx === startIdx) {
                return
            }
            let isClosed = false
            let vertices = curVertices
            if (endIdx === verticesCount && startIdx === 0) {
                isClosed = true
                if (vertices === null) {
                    vertices = entityVertices
                } else {
                    /* Generated vertices include the closing segment, so they end back at the
                     * first vertex - which a closed shape returns to by itself.
                     */
                    const first = vertices[0]
                    const last = vertices[vertices.length - 1]
                    if (last.x === first.x && last.y === first.y) {
                        vertices.pop()
                    }
                }
            } else if (endIdx === verticesCount - 1 && startIdx === 0) {
                if (vertices === null) {
                    vertices = entityVertices
                }
            } else if (endIdx === verticesCount) {
                if (vertices === null) {
                    vertices = entityVertices.slice(startIdx, endIdx)
                    vertices.push(entityVertices[0])
                }
            } else {
                if (vertices === null) {
                    vertices = entityVertices.slice(startIdx, endIdx + 1)
                }
            }

            if (curPlainLine) {
                yield new Entity({
                                     type: Entity.Type.POLYLINE,
                                     vertices, layer, color,
                                     lineType: curLineType,
                                     shape: isClosed
                })
            } else {
                yield* _this._GenerateShapedPolyline(vertices, layer, color, curLineType, isClosed)
            }

            startIdx = endIdx
            if (endIdx !== verticesCount) {
                curPlainLine = _this._IsPlainLine(entityVertices[endIdx])
                curLineType = _this._GetLineType(entity, entityVertices[endIdx], blockCtx)
            }
            curVertices = null
        }

        for (let vIdx = 1; vIdx <= verticesCount; vIdx++) {
            const prevVtx = entityVertices[vIdx - 1]
            let vtx
            if (vIdx === verticesCount) {
                if (!entity.shape) {
                    yield* CommitSegment(vIdx - 1)
                    break
                }
                vtx = entityVertices[0]
            } else {
                vtx = entityVertices[vIdx]
            }

            if (Boolean(prevVtx.bulge) && curPlainLine) {
                if (curVertices === null) {
                    curVertices = entityVertices.slice(startIdx, vIdx)
                }
                this._GenerateBulgeVertices(curVertices, prevVtx, vtx, prevVtx.bulge)
            } else if (curVertices !== null) {
                curVertices.push(vtx)
            }

            if (vIdx === verticesCount) {
                yield* CommitSegment(vIdx)
                break
            }

            const isPlainLine = this._IsPlainLine(vtx)
            const lineType = this._GetLineType(entity, vtx, blockCtx)
            if (isPlainLine !== curPlainLine ||
                /* Line type is accounted for plain lines only. */
                (curPlainLine && lineType !== curLineType)) {

                yield* CommitSegment(vIdx)
            }
        }
    }

    *_DecomposePolyfaceMesh(entity, blockCtx = null) {
        const layer = this._GetEntityLayer(entity, blockCtx)
        const color = this._GetEntityColor(entity, blockCtx)

        const vertices = []
        const faces = []

        for (const v of entity.vertices) {
            if (v.faces) {
                const face = {
                    indices: [],
                    hiddenEdges: []
                }
                for (let vIdx of v.faces) {
                    if (vIdx == 0) {
                        break
                    }
                    if (vIdx > vertices.length) {
                        /* It was observed that some software may produce negative values as 16-bits
                         * complements. Seen this in files produced by `dwg2dxf`.
                         */
                        if (0x10000 - vIdx > vertices.length) {
                            /* Index out of range, give up. */
                            continue
                        }
                        vIdx = vIdx - 0x10000
                    }
                    face.indices.push(vIdx < 0 ? -vIdx - 1 : vIdx - 1)
                    face.hiddenEdges.push(vIdx < 0)
                }
                if (face.indices.length == 3 || face.indices.length == 4) {
                    faces.push(face)
                }
            } else {
                vertices.push(new Vector2(v.x, v.y))
            }
        }

        if (!this.options.wireframeMesh) {
            yield* this._GeneratePolyfaceTriangles(vertices, faces, layer, color)
            return
        }

        /* Runs of mesh vertex indices. A face edge extends the previous run when it starts where
         * that one ends, so a face with every edge visible comes out as one run with its first
         * vertex repeated at the end. That repeat is what closes it; flagging the run as a closed
         * shape as well would add a zero-length closing segment.
         */
        const runs = []
        for (const face of faces) {
            for (let i = 0; i < face.indices.length; i++) {
                if (face.hiddenEdges[i]) {
                    continue
                }
                const startIdx = face.indices[i]
                const endIdx = face.indices[i < face.indices.length - 1 ? i + 1 : 0]
                const prev = runs.at(-1)
                if (prev?.at(-1) === startIdx) {
                    prev.push(endIdx)
                } else {
                    runs.push([startIdx, endIdx])
                }
            }
        }

        /* A two-vertex run needs no special case: _ProcessPolyline() already writes short
         * polylines un-indexed.
         */
        for (const run of runs) {
            yield new Entity({
                type: Entity.Type.POLYLINE,
                vertices: run.map(vIdx => vertices[vIdx]),
                layer, color
            })
        }
    }

    /** Triangles for the faces of a polyface mesh, as few entities as the chunk size allows.
     *
     * Faces share the mesh vertices, so they go into one entity holding each referenced vertex
     * once. Emitting one entity per face would have to hand each of them the whole vertex array,
     * which is then written in full per face -- vertices times faces.
     *
     * @param {Vector2[]} vertices All vertices of the mesh.
     * @param {Array<{indices: number[]}>} faces Faces of three or four zero-based indices into
     *  `vertices`.
     * @param {?string} layer
     * @param {number} color
     * @returns {Generator<Entity>}
     */
    *_GeneratePolyfaceTriangles(vertices, faces, layer, color) {
        const meshVertices = []
        const indices = []
        /* Mesh vertex index -> index in meshVertices. Unreferenced vertices are left out, so they
         * do not extend the bounds either.
         */
        const remap = new Map()

        for (const face of faces) {
            const idx = face.indices.map(meshIdx => {
                let i = remap.get(meshIdx)
                if (i === undefined) {
                    i = meshVertices.length
                    remap.set(meshIdx, i)
                    meshVertices.push(vertices[meshIdx])
                }
                return i
            })
            if (idx.length == 3) {
                indices.push(idx[0], idx[1], idx[2])
            } else {
                indices.push(idx[0], idx[1], idx[2], idx[0], idx[2], idx[3])
            }
        }
        if (indices.length > 0) {
            yield new Entity({
                type: Entity.Type.TRIANGLES,
                vertices: meshVertices, indices, layer, color
            })
        }
    }

    *_DecomposeSpline(entity, blockCtx = null) {
        const color = this._GetEntityColor(entity, blockCtx)
        const layer = this._GetEntityLayer(entity, blockCtx)
        const lineType = this._GetLineType(entity, null, blockCtx)
        if (!entity.controlPoints) {
            //XXX knots or fit points not supported yet
            return
        }
        const controlPoints = entity.controlPoints.map(p => [p.x, p.y])
        const vertices = []
        const subdivisions = controlPoints.length * SPLINE_SUBDIVISION
        const step = 1 / subdivisions
        for (let i = 0; i <= subdivisions; i++) {
            const pt = this._InterpolateSpline(i * step, entity.degreeOfSplineCurve, controlPoints,
                                               entity.knotValues)
            vertices.push({x: pt[0], y: pt[1]})
        }
        yield new Entity({type: Entity.Type.POLYLINE, vertices, layer, color, lineType})
    }

    /** Get a point on a B-spline.
     * https://github.com/thibauts/b-spline
     * @param {number} t Point position on spline, [0..1].
     * @param {number} degree B-spline degree.
     * @param {number[][]} points Control points. Each point should have the same dimension which
     *  defines dimension of the result.
     * @param {?number[]} knots Knot vector. Should have size `points.length + degree + 1`. Default
     *  is uniform spline.
     * @param {?number} weights Optional weights vector.
     * @returns {number[]} Resulting point on the specified position.
     */
    _InterpolateSpline(t, degree, points, knots = null, weights = null) {
        let i, j, s, l             // function-scoped iteration variables
        const n = points.length    // points count
        const d = points[0].length // point dimensionality

        if (degree < 1) {
            throw new Error("Degree must be at least 1 (linear)")
        }
        if (degree > (n - 1)) {
            throw new Error("Degree must be less than or equal to point count - 1")
        }

        if (!weights) {
            // build weight vector of length [n]
            weights = []
            for (i = 0; i < n; i++) {
                weights[i] = 1
            }
        }

        if (!knots) {
            // build knot vector of length [n + degree + 1]
            knots = []
            for (i = 0; i < n + degree + 1; i++) {
                knots[i] = i
            }
        } else {
            if (knots.length !== n + degree + 1) {
                throw new Error("Bad knot vector length")
            }
        }

        const domain = [
            degree,
            knots.length - 1 - degree
        ]

        // remap t to the domain where the spline is defined
        const low  = knots[domain[0]]
        const high = knots[domain[1]]
        t = t * (high - low) + low

        if (t < low) {
            t = low
        } else if (t > high) {
            t = high
        }

        // find s (the spline segment) for the [t] value provided
        for (s = domain[0]; s < domain[1]; s++) {
            if (t >= knots[s] && t <= knots[s + 1]) {
                break
            }
        }

        // convert points to homogeneous coordinates
        const v = []
        for (i = 0; i < n; i++) {
            v[i] = []
            for (j = 0; j < d; j++) {
                v[i][j] = points[i][j] * weights[i]
            }
            v[i][d] = weights[i]
        }

        // l (level) goes from 1 to the curve degree + 1
        let alpha
        for (l = 1; l <= degree + 1; l++) {
            // build level l of the pyramid
            for (i = s; i > s - degree - 1 + l; i--) {
                alpha = (t - knots[i]) / (knots[i + degree + 1 - l] - knots[i])
                // interpolate each component
                for (j = 0; j < d + 1; j++) {
                    v[i][j] = (1 - alpha) * v[i - 1][j] + alpha * v[i][j]
                }
            }
        }

        // convert back to cartesian and return
        const result = []
        for (i = 0; i < d; i++) {
            result[i] = v[s][i] / v[s][d]
        }
        return result
    }

    /**
     * @param {Entity} entity
     * @param {?BlockContext} blockCtx
     */
    _ProcessPoints(entity, blockCtx = null) {
        const key = new BatchingKey(entity.layer, blockCtx?.name,
                                    BatchingKey.GeometryType.POINTS, entity.color, 0)
        const batch = this._GetBatch(key)
        for (const v of entity.vertices) {
            batch.PushVertex(this._TransformVertex(v, blockCtx))
        }
    }

    /**
     * @param {Entity} entity
     * @param {?BlockContext} blockCtx
     */
    _ProcessLineSegments(entity, blockCtx = null) {
        if (entity.vertices.length % 2 !== 0) {
            throw Error("Even number of vertices expected")
        }
        const key = new BatchingKey(entity.layer, blockCtx?.name,
                                    BatchingKey.GeometryType.LINES, entity.color, entity.lineType)
        const batch = this._GetBatch(key)
        for (const v of entity.vertices) {
            batch.PushVertex(this._TransformVertex(v, blockCtx))
        }
    }

    /**
     * @param {Entity} entity
     * @param {?BlockContext} blockCtx
     */
    _ProcessPolyline(entity, blockCtx = null) {
        if (entity.vertices.length < 2) {
            return
        }
        /* It is more optimal to render short polylines un-indexed. Also DXF often contains
         * polylines with just two points.
         */
        const verticesCount = entity.vertices.length
        if (verticesCount <= 3) {
            const key = new BatchingKey(entity.layer, blockCtx?.name,
                                        BatchingKey.GeometryType.LINES, entity.color,
                                        entity.lineType)
            const batch = this._GetBatch(key)
            let prev = null
            for (const v of entity.vertices) {
                if (prev !== null) {
                    batch.PushVertex(this._TransformVertex(prev, blockCtx))
                    batch.PushVertex(this._TransformVertex(v, blockCtx))
                }
                prev = v
            }
            if (entity.shape && verticesCount > 2) {
                batch.PushVertex(this._TransformVertex(entity.vertices[verticesCount - 1],
                                                       blockCtx))
                batch.PushVertex(this._TransformVertex(entity.vertices[0], blockCtx))
            }
            return
        }

        const key = new BatchingKey(entity.layer, blockCtx?.name,
                                    BatchingKey.GeometryType.INDEXED_LINES,
                                    entity.color, entity.lineType)
        const batch = this._GetBatch(key)
        /* Line may be split if exceeds chunk limit. */
        for (const lineChunk of entity._IterateLineChunks()) {
            const chunk = batch.PushChunk(lineChunk.verticesCount)
            for (const v of lineChunk.vertices) {
                chunk.PushVertex(this._TransformVertex(v, blockCtx))
            }
            for (const idx of lineChunk.indices) {
                chunk.PushIndex(idx)
            }
            chunk.Finish()
        }
    }

    /**
     * @param {Entity} entity
     * @param {?BlockContext} blockCtx
     */
    _ProcessTriangles(entity, blockCtx = null) {
        if (entity.vertices.length < 3) {
            return
        }
        if (entity.indices.length % 3 !== 0) {
            console.error("Unexpected size of indices array: " + entity.indices.length)
            return
        }
        const key = new BatchingKey(entity.layer, blockCtx?.name,
                                    BatchingKey.GeometryType.INDEXED_TRIANGLES,
                                    entity.color, 0)
        const batch = this._GetBatch(key)
        /* A large solid hatch may exceed the chunk limit. */
        for (const triChunk of entity._IterateTriangleChunks()) {
            const chunk = batch.PushChunk(triChunk.verticesCount)
            for (const v of triChunk.vertices) {
                chunk.PushVertex(this._TransformVertex(v, blockCtx))
            }
            for (const idx of triChunk.indices) {
                chunk.PushIndex(idx)
            }
            chunk.Finish()
        }
    }

    /** Resolve entity color.
     *
     * @param {object} entity Raw DXF entity.
     * @param {?BlockContext} blockCtx
     * @returns {number} RGB color value. For block entity it also may be one of ColorCode values
     *  which are resolved on block instantiation.
     */
    _GetEntityColor(entity, blockCtx = null) {
        let color = ColorCode.BY_LAYER
        if (entity.colorIndex === 0) {
            color = ColorCode.BY_BLOCK
        } else if (entity.colorIndex === 256) {
            /* Resolve color instantly if the entity has layer assigned, otherwise the layer is
             * is taken from `INSERT` layer when rendering.
             */
            if (entity.hasOwnProperty("layer")) {
                const layer = this.layers.get(entity.layer)
                if (layer) {
                    return layer.color
                }
            }
            color = ColorCode.BY_LAYER
        } else if (entity.hasOwnProperty("color") && entity.color != null) {
            /* Index is converted to color value by parser now. */
            color = entity.color
        }

        if (blockCtx) {
            return color
        }
        if (color === ColorCode.BY_BLOCK) {
            /* BY_BLOCK is not useful when not in block. As reported by users, AutoCAD uses white
             * color in such case.
             */
            return 0xffffff
        }
        if (color === ColorCode.BY_LAYER) {
            if (entity.hasOwnProperty("layer")) {
                const layer = this.layers.get(entity.layer)
                if (layer && layer.color != null) {
                    return layer.color
                }
            }
        } else {
            return color
        }
        /* Fallback to black. */
        return 0
    }

    /** @returns {?string} Layer name, null for block entity. */
    _GetEntityLayer(entity, blockCtx = null) {
        if (entity.hasOwnProperty("layer") && entity.layer != null) {
            return entity.layer
        }
        /* For block definition missing layer means taking layer from corresponding `INSERT` entity,
         * for instant entities use layer "0" as fallback to match reference software behavior.
         */
        return blockCtx ? null : "0"
    }

    /** @returns {?object} Text style record from the STYLE table, null if the entity names
     *  none or it is not found.
     */
    _GetEntityTextStyle(entity) {
        if (entity.hasOwnProperty("styleName")) {
            return this.fontStyles.get(entity.styleName) ?? null
        }
        return null
    }

    /** The OCS Z of the plane a DIMENSION lies in. The text midpoint is in OCS and carries it,
     * which is where AutoCAD and ezdxf take it from; a dimension written without one still has
     * its definition point, which is in WCS but in the same plane.
     *
     * @param {object} entity Raw DXF DIMENSION entity.
     * @param {?Object} basis The entity's OCS axes from OcsBasis(), null for the default OCS.
     * @returns {number}
     */
    _GetDimensionElevation(entity, basis) {
        if (entity.middleOfText) {
            return entity.middleOfText.z ?? 0
        }
        if (basis && entity.anchorPoint) {
            return WcsToOcs(basis, entity.anchorPoint).z
        }
        return entity.anchorPoint?.z ?? 0
    }

    /** Transform from the entity's OCS to WCS XY, applied to everything its decomposer produces.
     *
     * Only the entity types whose coordinates are in OCS have one. LINE, POINT, 3DFACE, SPLINE and
     * 3D polylines and meshes are in WCS already; ELLIPSE and MTEXT are in WCS too, but lie in a
     * plane their extrusion direction tilts, so their decomposers account for it themselves. Each
     * type keeps its elevation - the OCS Z of its plane - somewhere different.
     *
     * @param {object} entity Raw DXF entity.
     * @returns {?Matrix3} Null if no transform is required.
     */
    _GetEntityOcsTransform(entity) {
        const basis = OcsBasis(entity.extrusionDirection)
        if (!basis) {
            return null
        }
        let elevation
        switch (entity.type) {
        case "ARC":
        case "CIRCLE":
            elevation = entity.center?.z
            break
        case "LWPOLYLINE":
        case "HATCH":
            elevation = entity.elevation
            break
        case "POLYLINE":
            if (entity.is3dPolyline || entity.is3dPolygonMesh || entity.isPolyfaceMesh) {
                return null
            }
            elevation = entity.elevation
            break
        case "SOLID":
            elevation = entity.points?.[0]?.z
            break
        case "TEXT":
        case "ATTRIB":
            elevation = entity.startPoint?.z
            break
        case "DIMENSION":
            elevation = this._GetDimensionElevation(entity, basis)
            break
        default:
            return null
        }
        return OcsToWcsMatrix(basis, elevation ?? 0)
    }

    /** @returns {RenderBatch} */
    _GetBatch(key) {
        let batch = this.batches.find({key})
        if (batch !== null) {
            return batch
        }
        batch = new RenderBatch(key)
        this.batches.insert(batch)
        if (key.blockName !== null && !key.IsInstanced()) {
            /* Block definition batch. */
            const block = this.blocks.get(key.blockName)
            if (block) {
                block.batches.push(batch)
            }
        }
        return batch
    }

    /**
     * Apply all necessary final transforms to a vertex before just before storing it in a rendering
     * batch.
     * @param {{x: number, y: number}} v
     * @param {BlockContext} blockCtx
     * @returns {{x: number, y: number}}
     */
    _TransformVertex(v, blockCtx = null) {
        if (blockCtx) {
            /* Block definition in block coordinates. So it should not touch bounds and origin. */
            return blockCtx.TransformVertex(v)
        }
        this._UpdateBounds(v)
        return {x: v.x - this.origin.x, y: v.y - this.origin.y}
    }

    /** @param {{x: number, y: number}} v Vertex to extend bounding box with and set origin. */
    _UpdateBounds(v) {
        if (this.bounds === null) {
            this.bounds = {minX: v.x, maxX: v.x, minY: v.y, maxY: v.y}
        } else {
            if (v.x < this.bounds.minX) {
                this.bounds.minX = v.x
            } else if (v.x > this.bounds.maxX) {
                this.bounds.maxX = v.x
            }
            if (v.y < this.bounds.minY) {
                this.bounds.minY = v.y
            } else if (v.y > this.bounds.maxY) {
                this.bounds.maxY = v.y
            }
        }
        if (this.origin === null) {
            this.origin = {x: v.x, y: v.y}
        }
    }

    _BuildScene() {
        let verticesSize = 0
        let indicesSize = 0
        let transformsSize = 0
        this.batches.each(b => {
            verticesSize += b.GetVerticesBufferSize()
            indicesSize += b.GetIndicesBufferSize()
            transformsSize += b.GetTransformsSize()
        })

        const scene = {
            vertices: new ArrayBuffer(verticesSize),
            indices: new ArrayBuffer(indicesSize),
            transforms: new ArrayBuffer(transformsSize),
            batches: [],
            layers: [],
            origin: this.origin,
            bounds: this.bounds,
            hasMissingChars: this.hasMissingChars,
            numEntitiesSkipped: this.numEntitiesSkipped
        }

        const buffers = {
            vertices: new Float32Array(scene.vertices),
            verticesOffset: 0,
            indices: new Uint16Array(scene.indices),
            indicesOffset: 0,
            transforms: new Float32Array(scene.transforms),
            transformsOffset: 0
        }

        this.batches.each(b => {
            scene.batches.push(b.Serialize(buffers))
        })

        for (const layer of this.layers.values()) {
            if (layer.frozen) {
                continue
            }
            scene.layers.push({
                name: layer.name,
                displayName: layer.displayName,
                color: layer.color,
                /* A layer switched off keeps its geometry - unlike a frozen one it is a view
                 * setting the user may turn back on, so the viewer hides the objects rather than
                 * the scene dropping them. Absent group 62 means the layer is on.
                 */
                visible: layer.visible ?? true
            })
        }

        scene.pointShapeHasDot = (this.pdMode & PdMode.MARK_MASK) === PdMode.DOT

        return scene
    }
}

class RenderBatch {
    constructor(key) {
        this.key = key
        if (key.IsIndexed()) {
            this.chunks = []
        } else if (key.geometryType === BatchingKey.GeometryType.BLOCK_INSTANCE) {
            this.transforms = new DynamicBuffer(NativeType.FLOAT32)
        } else {
            this.vertices = new DynamicBuffer(NativeType.FLOAT32)
        }
    }

    PushVertex(v) {
        const idx = this.vertices.Push(v.x)
        this.vertices.Push(v.y)
        return idx
    }

    /**
     * @param {Matrix3} matrix 3x3 Transform matrix. Assuming 2D affine transform so only top 3x2
     *  sub-matrix is taken.
     */
    PushInstanceTransform(matrix) {
        /* Storing in row-major order as expected by renderer. */
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 3; col++) {
                this.transforms.Push(matrix.elements[col * 3 + row])
            }
        }
    }

    /** This method actually reserves space for the specified number of indexed vertices in some
     * chunk. The returned object should be used to push exactly the same amount vertices and any
     * number of their referring indices.
     * @param {number} verticesCount Number of vertices in the chunk.
     * @returns {IndexedChunkWriter}
     */
    PushChunk(verticesCount) {
        if (verticesCount > INDEXED_CHUNK_SIZE) {
            throw new Error("Vertices count exceeds chunk limit: " + verticesCount)
        }
        /* Find suitable chunk with minimal remaining space to fill them as fully as possible. */
        let curChunk = null
        let curSpace = 0
        for (const chunk of this.chunks) {
            const space = INDEXED_CHUNK_SIZE - chunk.vertices.GetSize() / 2
            if (space < verticesCount) {
                continue
            }
            if (curChunk === null || space < curSpace) {
                curChunk = chunk
                curSpace = space
            }
        }
        if (curChunk === null) {
            curChunk = this._NewChunk(verticesCount)
        }
        return new IndexedChunkWriter(curChunk, verticesCount)
    }

    /** Merge other batch into this one. They should have the same geometry type. Instanced batches
     * are disallowed.
     *
     * @param {RenderBatch} batch
     * @param {?Matrix3} transform Optional transform to apply for merged vertices.
     */
    Merge(batch, transform = null) {
        if (this.key.geometryType !== batch.key.geometryType) {
            throw new Error("Rendering batch merging geometry type mismatch: " +
                            `${this.key.geometryType} !== ${batch.key.geometryType}`)
        }
        if (this.key.IsInstanced()) {
            throw new Error("Attempted to merge instanced batch")
        }
        if (this.key.IsIndexed()) {
            /* Merge chunks. */
            for (const chunk of batch.chunks) {
                const verticesSize = chunk.vertices.size
                const chunkWriter = this.PushChunk(verticesSize / 2)
                for (let i = 0; i < verticesSize; i += 2) {
                    const v = new Vector2(chunk.vertices.Get(i), chunk.vertices.Get(i + 1))
                    if (transform) {
                        v.applyMatrix3(transform)
                    }
                    chunkWriter.PushVertex(v)
                }
                const numIndices = chunk.indices.size
                for (let i = 0; i < numIndices; i++) {
                    chunkWriter.PushIndex(chunk.indices.Get(i))
                }
                chunkWriter.Finish()
            }
        } else {
            const n = batch.vertices.size
            for (let i = 0; i < n; i += 2) {
                const v = new Vector2(batch.vertices.Get(i), batch.vertices.Get(i + 1))
                if (transform) {
                    v.applyMatrix3(transform)
                }
                this.PushVertex(v)
            }
        }
    }

    /** @returns {number} Vertices buffer required size in bytes. */
    GetVerticesBufferSize() {
        if (this.key.IsIndexed()) {
            let size = 0
            for (const chunk of this.chunks) {
                size += chunk.vertices.GetSize()
            }
            return size * Float32Array.BYTES_PER_ELEMENT
        } else if (this.key.geometryType === BatchingKey.GeometryType.BLOCK_INSTANCE) {
            return 0
        } else {
            return this.vertices.GetSize() * Float32Array.BYTES_PER_ELEMENT
        }
    }

    /** @returns {number} Indices buffer required size in bytes. */
    GetIndicesBufferSize() {
        if (this.key.IsIndexed()) {
            let size = 0
            for (const chunk of this.chunks) {
                size += chunk.indices.GetSize()
            }
            return size * Uint16Array.BYTES_PER_ELEMENT
        } else {
            return 0
        }
    }

    /** @returns {number} Instances transforms buffer required size in bytes. */
    GetTransformsSize() {
        if (this.key.geometryType === BatchingKey.GeometryType.BLOCK_INSTANCE) {
            return this.transforms.GetSize() * Float32Array.BYTES_PER_ELEMENT
        } else {
            return 0
        }
    }

    Serialize(buffers) {
        if (this.key.IsIndexed()) {
            const batch = {
                key: this.key,
                chunks: []
            }
            for (const chunk of this.chunks) {
                batch.chunks.push(chunk.Serialize(buffers))
            }
            return batch

        } else if (this.key.geometryType === BatchingKey.GeometryType.BLOCK_INSTANCE) {
            const size = this.transforms.GetSize()
            const batch = {
                key: this.key,
                transformsOffset: buffers.transformsOffset,
                transformsSize: size
            }
            this.transforms.CopyTo(buffers.transforms, buffers.transformsOffset)
            buffers.transformsOffset += size
            return batch

        } else {
            const size = this.vertices.GetSize()
            const batch = {
                key: this.key,
                verticesOffset: buffers.verticesOffset,
                verticesSize: size
            }
            this.vertices.CopyTo(buffers.vertices, buffers.verticesOffset)
            buffers.verticesOffset += size
            return batch
        }
    }

    _NewChunk(initialCapacity) {
        const chunk = new IndexedChunk(initialCapacity)
        this.chunks.push(chunk)
        return chunk
    }
}

class Block {
    /** @param {{}} data Raw DXF entity. */
    constructor(data) {
        this.data = data
        /* Number of times referenced from top-level entities (INSERT). */
        this.useCount = 0
        /* Number of times referenced by other block. */
        this.nestedUseCount = 0
        /* Total number of vertices in this block. Used for flattening decision. */
        this.verticesCount = 0
        /* Offset {x,y} to apply for all vertices. Used to move origin near vertices location to
         * minimize precision loss.
         */
        this.offset = null
        /* Definition batches. Used for root blocks flattening. */
        this.batches = []
        this.flatten = false
        /** Bounds in block coordinates (with offset applied). */
        this.bounds = null
    }

    /** Set block flattening flag based on usage statistics.
     * @returns {Boolean} New flatten flag state.
     */
    SetFlatten() {
        if (!this.HasGeometry()) {
            return false
        }
        /* Flatten if a block is used once (pure optimization if shares its layer with other
         * geometry) or if total instanced vertices number is less than a threshold (trade some
         * space for draw calls number).
         */
        this.flatten = this.useCount === 1 ||
                       this.useCount * this.verticesCount <= BLOCK_FLATTENING_VERTICES_THRESHOLD
        return this.flatten
    }

    /** @returns {Boolean} True if has something to draw. */
    HasGeometry() {
        /* Offset is set on first geometry vertex encountered. */
        return this.offset !== null
    }

    /** @param {{}} entity May be either INSERT or DIMENSION. */
    RegisterInsert(entity) {
        this.useCount++
    }

    RegisterNestedUse(usedByBlock) {
        this.nestedUseCount++
    }

    /** @returns {BlockContext} Context for block definition. */
    DefinitionContext() {
        return new BlockContext(this, BlockContext.Type.DEFINITION)
    }

    InstantiationContext() {
        return new BlockContext(this, BlockContext.Type.INSTANTIATION)
    }

    UpdateBounds(v) {
        if (this.bounds === null) {
            this.bounds = {minX: v.x, maxX: v.x, minY: v.y, maxY: v.y}
        } else {
            if (v.x < this.bounds.minX) {
                this.bounds.minX = v.x
            } else if (v.x > this.bounds.maxX) {
                this.bounds.maxX = v.x
            }
            if (v.y < this.bounds.minY) {
                this.bounds.minY = v.y
            } else if (v.y > this.bounds.maxY) {
                this.bounds.maxY = v.y
            }
        }
    }
}

class BlockContext {
    constructor(block, type) {
        this.block = block
        this.type = type
        this.origin = this.block.data.position
        /* Transform to apply for block definition entities not including block offset. */
        this.transform = new Matrix3()
        /* Names of the blocks being expanded, outermost first. A nested context keeps `block`
         * pointing to the outermost block, so this is the only record of what is on the expansion
         * path, and thus the only way to detect a reference cycle which does not include the
         * outermost block.
         */
        this.blockPath = [this.name]
    }

    /** @returns {string} Block name */
    get name() {
        return this.block.data.name
    }

    /** Check if instantiating the specified block would re-enter a block which is already being
     * expanded, which would recurse indefinitely.
     *
     * @param {string} blockName Name of the block referenced by a nested `INSERT`.
     * @returns {Boolean} True if the reference closes a cycle.
     */
    IsRecursiveReference(blockName) {
        return this.blockPath.includes(blockName)
    }

    /** @returns {string} Block reference chain, for diagnostic messages. */
    DescribeBlockPath(blockName) {
        return this.blockPath.concat(blockName).join(" -> ")
    }

    /**
     * @param {{x: number, y: number}} v
     * @returns {{x: number, y: number}}
     */
    TransformVertex(v) {
        const result = new Vector2(v.x, v.y).applyMatrix3(this.transform)
        if (this.type !== BlockContext.Type.DEFINITION &&
            this.type !== BlockContext.Type.NESTED_DEFINITION) {

            throw new Error("Unexpected transform type")
        }
        this.block.verticesCount++
        if (this.block.offset === null) {
            /* This is the first vertex. Take it as a block origin. So the result is always zero
             * vector for the first vertex.
             */
            this.block.offset = result
            const v = new Vector2()
            this.block.UpdateBounds(v)
            return v
        }
        result.sub(this.block.offset)
        this.block.UpdateBounds(result)
        return result
    }

    /**
     * Get transform for block instance.
     * @param {object} entity Raw DXF INSERT entity.
     * @returns {Matrix3} Transform matrix for block instance to apply to the block definition.
     * @throws {Error} When the transform comes out non-finite.
     */
    GetInsertionTransform(entity) {
        CheckFinitePoint(this.origin, "block base point")
        CheckFinitePoint(entity.position, "insertion point")
        const mInsert = new Matrix3().makeTranslation(-this.origin.x, -this.origin.y)
        const yScale = entity.yScale || 1
        const xScale = entity.xScale || 1
        const rotation = -(entity.rotation || 0) * Math.PI / 180
        let x = entity.position.x
        const y = entity.position.y
        MatrixScale(mInsert, xScale, yScale)
        MatrixRotateCW(mInsert, rotation)
        MatrixTranslate(mInsert, x, y)
        /* XXX Exact only while the block content is flat at z = 0 of the block: a tilted insert
         * also maps block-local Z into WCS X and Y, and that Z is dropped when the block
         * definition is decomposed. Elevated or tilted entities inside a block inserted with a
         * tilted extrusion direction - directly or through a nested INSERT - land off their true
         * position.
         */
        const ocsTransform = OcsToWcsMatrix(OcsBasis(entity.extrusionDirection),
                                            entity.position.z ?? 0)
        if (ocsTransform) {
            mInsert.premultiply(ocsTransform)
        }
        if (this.type === BlockContext.Type.INSTANTIATION) {
            mInsert.multiply(new Matrix3().makeTranslation(this.block.offset.x,
                                                           this.block.offset.y))
        }
        /* An infinite scale gets past the fallbacks above, and an instance written with a
         * non-finite transform poisons the scene bounds the same way a NaN vertex does.
         */
        if (!mInsert.elements.every(Number.isFinite)) {
            throw new Error("Non-finite insertion transform")
        }
        return mInsert
    }

    /**
     * Create context for nested block.
     * @param {Block} block Nested block.
     * @param {object} entity Raw DXF INSERT entity.
     * @returns {BlockContext} Context to use for nested block entities.
     */
    NestedBlockContext(block, entity) {
        block.RegisterNestedUse(this.block)
        const nestedCtx = new BlockContext(block, BlockContext.Type.NESTED_DEFINITION)
        const nestedTransform = nestedCtx.GetInsertionTransform(entity)
        const ctx = new BlockContext(this.block, BlockContext.Type.NESTED_DEFINITION)
        ctx.transform = new Matrix3().multiplyMatrices(this.transform, nestedTransform)
        ctx.blockPath = this.blockPath.concat(block.data.name)
        return ctx
    }
}

BlockContext.Type = Object.freeze({
    DEFINITION: 0,
    NESTED_DEFINITION: 1,
    INSTANTIATION: 2
})

class IndexedChunk {
    constructor(initialCapacity) {
        if (initialCapacity < 16) {
            initialCapacity = 16
        }
        /* Average two indices per vertex. */
        this.indices = new DynamicBuffer(NativeType.UINT16, initialCapacity * 2)
        /* Two components per vertex. */
        this.vertices = new DynamicBuffer(NativeType.FLOAT32, initialCapacity * 2)
    }

    Serialize(buffers) {
        const chunk = {}
        {
            const size = this.vertices.GetSize()
            chunk.verticesOffset = buffers.verticesOffset
            chunk.verticesSize = size
            this.vertices.CopyTo(buffers.vertices, buffers.verticesOffset)
            buffers.verticesOffset += size
        }
        {
            const size = this.indices.GetSize()
            chunk.indicesOffset = buffers.indicesOffset
            chunk.indicesSize = size
            this.indices.CopyTo(buffers.indices, buffers.indicesOffset)
            buffers.indicesOffset += size
        }
        return chunk
    }
}

class IndexedChunkWriter {
    constructor(chunk, verticesCount) {
        this.chunk = chunk
        this.verticesCount = verticesCount
        this.verticesOffset = this.chunk.vertices.GetSize() / 2
        this.numVerticesPushed = 0
    }

    PushVertex(v) {
        if (this.numVerticesPushed === this.verticesCount) {
            throw new Error()
        }
        this.chunk.vertices.Push(v.x)
        this.chunk.vertices.Push(v.y)
        this.numVerticesPushed++
    }

    PushIndex(idx) {
        if (idx < 0 || idx >= this.verticesCount) {
            throw new Error(`Index out of range: ${idx}/${this.verticesCount}`)
        }
        this.chunk.indices.Push(idx + this.verticesOffset)
    }

    Finish() {
        if (this.numVerticesPushed !== this.verticesCount) {
            throw new Error(`Not all vertices pushed: ${this.numVerticesPushed}/${this.verticesCount}`)
        }
    }
}

/** Internal entity representation. DXF features are decomposed into these simpler entities. Whole
 * entity always shares single material.
 */
export class Entity {
    /** @param {object} params
     * @param {number} params.type See Entity.Type
     * @param {Array<{x: number, y: number}>} params.vertices
     * @param {?number[]} params.indices Indices for indexed geometry.
     * @param {?string} params.layer
     * @param {number} params.color
     * @param {?number} params.lineType
     * @param {Boolean} params.shape true if closed shape.
     */
    constructor({type, vertices, indices = null, layer = null, color, lineType = 0,
                 shape = false}) {
        this.type = type
        this.vertices = vertices
        this.indices = indices
        this.layer = layer
        this.color = color
        this.lineType = lineType
        this.shape = shape
    }

    /** Check the entity can be written to a batch. A non-finite vertex would otherwise poison the
     * scene origin and bounds, which blanks the whole drawing, and an index past the vertices
     * draws garbage.
     *
     * @throws {Error} When the entity is not valid.
     */
    Validate() {
        for (const v of this.vertices) {
            CheckFinitePoint(v, "vertex")
        }
        if (this.indices) {
            const n = this.vertices.length
            for (const idx of this.indices) {
                if (!Number.isInteger(idx) || idx < 0 || idx >= n) {
                    throw new Error(`Index ${idx} out of range of ${n} vertices`)
                }
            }
        }
    }

    *_IterateVertices(startIndex, count) {
        for (let idx = startIndex; idx < startIndex + count; idx++) {
            yield this.vertices[idx]
        }
    }

    /** Split line into chunks with at most INDEXED_CHUNK_SIZE vertices in each one. Each chunk is
     * an object with the following properties:
     *  * "verticesCount" - length of "vertices"
     *  * "vertices" - iterator for included vertices.
     *  * "indices" - iterator for indices.
     *  Closed shapes are handled properly.
     *
     * Consecutive chunks **overlap by one vertex**: the last vertex of a chunk is repeated as the
     * first vertex of the next one. Without that overlap the segment spanning a chunk boundary
     * belongs to no chunk at all, and a polyline longer than INDEXED_CHUNK_SIZE draws with a gap
     * at every boundary.
     */
    *_IterateLineChunks() {
        const verticesCount = this.vertices.length
        if (verticesCount < 2) {
            return
        }
        const _this = this
        let chunkOffset = 0
        let isClosingEmitted = false

        while (chunkOffset < verticesCount - 1) {
            const remaining = verticesCount - chunkOffset
            const count = Math.min(INDEXED_CHUNK_SIZE, remaining)
            const isLast = count === remaining

            let vertices, indices, chunkVerticesCount

            if (isLast && this.shape && chunkOffset === 0) {
                /* The whole shape fits in one chunk, so it is closed by an index pointing back at
                 * its own first vertex and that vertex is not stored twice. This is the common
                 * case by far - most closed polylines are small.
                 */
                vertices = this._IterateVertices(chunkOffset, count)
                indices = _IterateLineIndices(count, true)
                chunkVerticesCount = count
                isClosingEmitted = true

            } else if (isLast && this.shape && count < INDEXED_CHUNK_SIZE) {
                /* The shape's first vertex lives in an earlier chunk and cannot be addressed from
                 * here, so it is repeated to carry the closing segment. There is room for it.
                 */
                vertices = (function*() {
                    yield* _this._IterateVertices(chunkOffset, count)
                    yield _this.vertices[0]
                })()
                indices = _IterateLineIndices(count + 1, false)
                chunkVerticesCount = count + 1
                isClosingEmitted = true

            } else {
                vertices = this._IterateVertices(chunkOffset, count)
                indices = _IterateLineIndices(count, false)
                chunkVerticesCount = count
            }

            yield {
                verticesCount: chunkVerticesCount,
                vertices,
                indices
            }

            /* Step back one vertex, so the next chunk starts where this one ended. */
            chunkOffset += count - 1
        }

        if (this.shape && !isClosingEmitted) {
            /* Corner case - the closing vertex did not fit into the last chunk, so the closing
             * segment gets a chunk of its own.
             */
            yield {
                verticesCount: 2,
                vertices: (function*() {
                    yield _this.vertices[verticesCount - 1]
                    yield _this.vertices[0]
                })(),
                indices: _IterateLineIndices(2, false)
            }
        }
    }

    /** Split triangles into chunks with at most INDEXED_CHUNK_SIZE vertices in each one, in the
     * same form as _IterateLineChunks() yields. Triangles are independent, so unlike line chunks
     * these need no overlap; a vertex shared by triangles on both sides of a split is stored in
     * each chunk referring to it.
     *
     * Triangles are taken in the order of their median vertex index rather than as given. Earcut
     * emits a large polygon's triangles in z-order, so a chunk filled in that order references
     * vertices from all along the boundary, each of them stored again by a later chunk - over a
     * third of the vertices for a 500k-vertex hatch. Boundary order keeps each chunk to a
     * contiguous run of the boundary instead. The median rather than the lowest index, because
     * on a boundary with rounding noise in its coordinates earcut leaves fans of tens of thousands
     * of triangles around one vertex: by lowest index the whole fan lands in its hub's chunk and
     * drags its spokes in from all around the boundary, while by median each fan triangle goes
     * with its spokes and only the hub is repeated.
     */
    *_IterateTriangleChunks() {
        if (this.vertices.length <= INDEXED_CHUNK_SIZE) {
            /* Everything but a large solid hatch, so no remapping for the common case. */
            yield {
                verticesCount: this.vertices.length,
                vertices: this.vertices,
                indices: this.indices
            }
            return
        }
        const numTriangles = this.indices.length / 3
        const medianIndices = new Uint32Array(numTriangles)
        const order = new Uint32Array(numTriangles)
        for (let i = 0; i < numTriangles; i++) {
            const a = this.indices[i * 3]
            const b = this.indices[i * 3 + 1]
            const c = this.indices[i * 3 + 2]
            medianIndices[i] = a + b + c - Math.min(a, b, c) - Math.max(a, b, c)
            order[i] = i
        }
        order.sort((a, b) => medianIndices[a] - medianIndices[b])

        let vertices = []
        let indices = []
        /* Entity vertex index -> index in the current chunk. */
        let remap = new Map()
        for (const triangle of order) {
            const base = triangle * 3
            let numNew = 0
            for (let j = base; j < base + 3; j++) {
                if (!remap.has(this.indices[j])) {
                    numNew++
                }
            }
            if (vertices.length + numNew > INDEXED_CHUNK_SIZE) {
                yield {verticesCount: vertices.length, vertices, indices}
                vertices = []
                indices = []
                remap = new Map()
            }
            for (let j = base; j < base + 3; j++) {
                const idx = this.indices[j]
                let chunkIdx = remap.get(idx)
                if (chunkIdx === undefined) {
                    chunkIdx = vertices.length
                    remap.set(idx, chunkIdx)
                    vertices.push(this.vertices[idx])
                }
                indices.push(chunkIdx)
            }
        }
        if (indices.length > 0) {
            yield {verticesCount: vertices.length, vertices, indices}
        }
    }
}

Entity.Type = Object.freeze({
    POINTS: 0,
    /** Each vertices pair defines a segment. */
    LINE_SEGMENTS: 1,
    POLYLINE: 2,
    TRIANGLES: 3
})

function* _IterateLineIndices(verticesCount, close) {
    for (let idx = 0; idx < verticesCount - 1; idx++) {
        yield idx
        yield idx + 1
    }
    if (close && verticesCount > 2) {
        yield verticesCount - 1
        yield 0
    }
}

/** Point display mode, $PDMODE system variable. */
const PdMode = Object.freeze({
    DOT: 0,
    NONE: 1,
    PLUS: 2,
    CROSS: 3,
    TICK: 4,
    MARK_MASK: 0xf,

    CIRCLE: 0x20,
    SQUARE: 0x40,

    SHAPE_MASK: 0xf0
})

/** DIMSTYLE variables holding a DXF color number rather than a plain value. */
const DIM_COLOR_VARS = new Set(["DIMCLRD", "DIMCLRE", "DIMCLRT"])

/** Special color values, used for block entities. Regular entity color is resolved instantly. */
export const ColorCode = Object.freeze({
    BY_LAYER: -1,
    BY_BLOCK: -2
})

/** Default values for `sceneOptions`, the scene generation options a viewer is constructed
 * with. An option left out takes its value from here.
 */
DxfScene.DefaultOptions = {
    /** Target angle for each segment of tessellated arc, in radians.
     * @default 10 degrees
     */
    arcTessellationAngle: 10 / 180 * Math.PI,
    /** Divide arc to at least the specified number of segments.
     * @default
     */
    minArcTessellationSubdivisions: 8,
    /** Render meshes (3DFACE group, POLYLINE polyface mesh) as wireframe instead of solid.
     * @default
     */
    wireframeMesh: false,
    /** Suppress paper-space entities when true (only model-space is rendered).
     * @default
     */
    suppressPaperSpace: false,
    /* Read from the leaf module rather than from TextRenderer.DefaultOptions, which is not yet
     * initialized at this point when the module graph is entered through TextRenderer.js. See
     * TextRendererOptions.js.
     */
    /** Text rendering options. See {@link TextRendererOptions}. */
    textOptions: DefaultTextOptions
}

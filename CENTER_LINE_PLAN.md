# Plan: Render DXF Linetypes (Center Lines & Dashed Patterns)

## Current State

Everything renders as solid, thin lines because:
- `DxfScene._GetLineType()` is a stub (`return 0`)
- No dash geometry expansion exists
- Materials/shaders have no dash support

The parser **already** provides:
- `entity.lineType` (string name, e.g., `"CENTER"`) via group code 6
- `entity.lineTypeScale` (per-entity scale) via group code 48
- `dxf.tables.lineType.lineTypes` — the LINETYPE table with `{name, patternLength, pattern: float[]}` where positive = dash, negative = gap, zero = dot
- `dxf.header.$LTSCALE` — global linetype scale

The parser does **NOT** yet capture the layer's linetype (group code 6 in LAYER records).

## Approach: Geometry-Based Dash Expansion

Expand dashed linetypes into solid line sub-segment pairs during DxfScene geometry generation — no shader changes needed. This gives world-space accuracy at all zoom levels and integrates cleanly with the existing batching pipeline. After expansion, the resulting segment pairs are stored in the same `LINES` batches as solid geometry.

The HatchCalculator already does this for hatch boundary lines; this is the same pattern.

---

## Implementation Steps

### Step 1 — Parser: Capture Layer Linetype
**File:** `src/parser/DxfParser.js`, `parseLayers()` (~line 590)

Add `case 6` to the layer switch to capture `layer.lineType = curr.value`.

```js
case 6:
    layer.lineType = curr.value;
    curr = scanner.next();
    break;
```

### Step 2 — DxfScene: Load Linetype Table
**File:** `src/DxfScene.js`, `Build()` (~line 109)

After layers are loaded, build a lookup of linetype name → `{id, pattern, patternLength}`:

```js
// id 0 = solid/continuous (default). Assign IDs 1+ to patterned types.
this.lineTypePatterns = new Map()  // name (uppercase) -> {id, pattern, patternLength}
this.lineTypeNextId = 1
this.ltScale = this.vars.get("LTSCALE") ?? 1

if (dxf.tables?.lineType?.lineTypes) {
    for (const [, lt] of Object.entries(dxf.tables.lineType.lineTypes)) {
        const name = lt.name?.toUpperCase()
        if (!name || name === "CONTINUOUS" || name === "BYLAYER" || name === "BYBLOCK") continue
        if (!lt.pattern || lt.pattern.length === 0 || !lt.patternLength) continue
        this.lineTypePatterns.set(name, {
            id: this.lineTypeNextId++,
            pattern: lt.pattern,
            patternLength: lt.patternLength
        })
    }
}
```

### Step 3 — Implement `_GetLineType()`
**File:** `src/DxfScene.js`, `_GetLineType()` (~line 384)

Resolve: entity → BYLAYER → layer linetype → name lookup → id.

```js
_GetLineType(entity, vertex = null, blockCtx = null) {
    let ltName = (vertex?.lineType ?? entity.lineType)?.toUpperCase()
    if (!ltName || ltName === "BYLAYER") {
        const layerName = this._GetEntityLayer(entity, blockCtx)
        const layer = this.layers.get(layerName)
        ltName = layer?.lineType?.toUpperCase()
    }
    if (!ltName || ltName === "CONTINUOUS" || ltName === "BYBLOCK") {
        return 0
    }
    return this.lineTypePatterns.get(ltName)?.id ?? 0
}
```

### Step 4 — Add `_GetLineTypeScale(entity)`
**File:** `src/DxfScene.js` (new helper method)

```js
_GetLineTypeScale(entity) {
    return (entity.lineTypeScale ?? 1) * this.ltScale
}
```

### Step 5 — Add `_ExpandDashedSegments(startPt, endPt, ltId, scale)`
**File:** `src/DxfScene.js` (new method)

Returns an array of `{x,y}` pairs (flat, alternating start/end) for all dash sub-segments.

```js
_ExpandDashedSegments(startPt, endPt, ltId, scale) {
    const info = [...this.lineTypePatterns.values()].find(v => v.id === ltId)
    if (!info) return [[startPt, endPt]]

    const dx = endPt.x - startPt.x
    const dy = endPt.y - startPt.y
    const totalLen = Math.sqrt(dx * dx + dy * dy)
    if (totalLen < 1e-10) return []

    const scaledPatLen = info.patternLength * scale
    if (scaledPatLen < 1e-10) return [[startPt, endPt]]

    const ux = dx / totalLen, uy = dy / totalLen
    const results = []
    let t = 0
    let patIdx = 0

    while (t < totalLen - 1e-10) {
        const elem = info.pattern[patIdx]
        const segLen = Math.abs(elem) * scale
        const isDash = elem >= 0   // positive = dash, negative = gap, 0 = dot
        const segEnd = Math.min(t + (segLen > 1e-10 ? segLen : scale * 0.01), totalLen)

        if (isDash) {
            results.push(
                { x: startPt.x + ux * t,      y: startPt.y + uy * t },
                { x: startPt.x + ux * segEnd,  y: startPt.y + uy * segEnd }
            )
        }

        t = segEnd
        patIdx = (patIdx + 1) % info.pattern.length
    }
    return results
}
```

### Step 6 — Modify `_DecomposeLine()`
**File:** `src/DxfScene.js`, `_DecomposeLine()` (~line 396)

```js
*_DecomposeLine(entity, blockCtx) {
    if (entity.vertices.length !== 2) return
    const layer = this._GetEntityLayer(entity, blockCtx)
    const color = this._GetEntityColor(entity, blockCtx)
    const lineType = this._GetLineType(entity, entity.vertices[0])

    let vertices = entity.vertices
    if (lineType !== 0) {
        const scale = this._GetLineTypeScale(entity)
        vertices = this._ExpandDashedSegments(entity.vertices[0], entity.vertices[1], lineType, scale)
        if (vertices.length === 0) return
    }

    yield new Entity({
        type: Entity.Type.LINE_SEGMENTS,
        vertices,
        layer, color,
        lineType: 0  // geometry is already expanded; use solid batching
    })
}
```

### Step 7 — Modify Arc/Circle Dashing
**File:** `src/DxfScene.js`

For `_DecomposeArc()`, `_DecomposeCircle()`, and `_DecomposeEllipse()`:

Add a new method `_ExpandDashedArcVertices({center, radius, startAngle, endAngle, ltId, scale})`:

```
Algorithm:
- Walk the arc angle from startAngle to endAngle
- Compute cumulative arc length at each small step
- Switch between "draw" and "skip" mode based on pattern position
- Emit tessellated points only during "draw" phases
- Yield arrays of vertex pairs (each continuous dash run becomes a polyline segment list)
```

Each dash run in the arc produces a `POLYLINE` entity (multiple connected points tessellating the curve). This approach naturally handles center circles and arcs.

### Step 8 — Modify Polyline Dashing
**File:** `src/DxfScene.js`, `_DecomposePolyline()`

Walk segment by segment. For each edge, call `_ExpandDashedSegments()` and accumulate vertex pairs. Each segment restarts the pattern (DXF default PLINEGEN=0 behavior).

For shaped (bulge) segments, dash along the arc portion similarly to Step 7.

### Step 9 — Spline Dashing
**File:** `src/DxfScene.js`, `_DecomposeSpline()`

The spline is already tessellated into polyline vertices (`_GenerateSplineVertices`). Walk the resulting points exactly as the polyline approach in Step 8.

---

## What Changes Where

| File | Changes |
|------|---------|
| `src/parser/DxfParser.js` | +4 lines: capture `layer.lineType` in `parseLayers()` |
| `src/DxfScene.js` | ~200 lines: load linetype table, implement `_GetLineType()`, add 3 new methods, modify 4 decompose methods |
| `src/DxfViewer.js` | No changes needed |
| `src/BatchingKey.js` | No changes needed |
| `src/MaterialKey.js` | No changes needed |

---

## Technical Drawing Standard for Center Lines

The DXF **CENTER** linetype pattern is: `[12.7, -2.54, 0, -2.54]` (in drawing units, before LTSCALE):
- Long dash (~12.7 units)
- Short gap (2.54 units)
- Dot (0, rendered as tiny dash ≈ 0.1×scale)
- Short gap (2.54 units)

AutoCAD default LTSCALE for metric drawings: 1.0 (ISO units). Pattern total length = 17.78 units.

For ISO standards, center lines should also visually extend slightly beyond the boundary of the feature. This is typically done by DXF authors placing the line manually longer — not something the viewer needs to enforce.

---

## Out of Scope (Future Work)

- **BYBLOCK linetype inheritance at INSERT instantiation time** — requires resolving linetype after block flattening; complex.
- **Shader-based dashing** — would allow truly scale-invariant patterns but requires per-vertex cumulative length attributes and shader changes.
- **Line weight rendering** — separate feature; all lines currently render at 1px screen width.
- **PLINEGEN=1** — continuous pattern across polyline vertices.
- **Complex linetypes** — those with embedded shapes/text (group code 74/75 in LTYPE records); the parser doesn't capture these yet.

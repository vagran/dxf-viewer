#!/usr/bin/env python3
"""Generates the synthetic DXF fixtures in the parent directory.

Run it from anywhere:

    .venv/bin/python test/fixtures/gen/generate.py

The generated files are committed. Running this must be a no-op on an unchanged checkout, which CI
enforces with `git diff --exit-code`, so the output has to be byte-stable: see `_Normalize`.

Why synthetic files at all, when test-data/ holds a hundred real drawings? Those are customer and
user-reported files that cannot be redistributed, so CI cannot see them. These can be committed,
each one is small enough to reason about, and the function that writes it says what it is for --
which a binary .dxf never can.

Conventions that the dump goldens depend on:

  * Coordinates stay within [-100, 100]. Scene vertices are stored as float32, whose absolute
    error at that magnitude is about 8e-6, comfortably below the 1e-4 the dumps round to. Larger
    coordinates would make the goldens sensitive to float32 rounding.
  * Coordinates are exact in binary where possible (integers and halves), so a dump can be checked
    by eye against the call that produced it.
"""

import argparse
import io
import pathlib
import re
import sys

import ezdxf
from ezdxf.enums import TextEntityAlignment
from ezdxf.render.arrows import ARROWS
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

FIXTURES_DIR = pathlib.Path(__file__).resolve().parent.parent

# Written into every file in place of the values ezdxf varies per run.
_FIXED_GUID = "{00000000-0000-0000-0000-000000000000}"
_FIXED_STAMP = "dxf-viewer fixture"

_GUID_RE = re.compile(r"\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}")
_EZDXF_STAMP_RE = re.compile(r"\d+\.\d+\.\d+ @ \d{4}-\d{2}-\d{2}T[\d:.]+\+00:00")
# $TDUPDATE and $TDUUPDATE are rewritten from the clock during doc.write(), so pinning them
# beforehand is not enough. Matched through their group code so no coordinate can be hit.
_WRITE_TIME_RE = re.compile(r"(\$TDU?UPDATE\r?\n\s*40\r?\n)[\d.]+")

# 2000-01-01T00:00:00 as a Julian day number, used for every timestamp header variable.
_FIXED_JULIAN_DATE = 2451544.5

_REGISTRY = []


def Fixture(name, postprocess=None):
    """Registers a fixture builder. The function receives the document and its modelspace.

    `postprocess` rewrites the finished DXF text. ezdxf will not write a malformed file, so a
    fixture that has to be malformed -- one that exists to make a parser guard fire -- edits the
    output afterwards. Use it only for that; anything ezdxf can express belongs in the builder.
    """
    def Register(fn):
        _REGISTRY.append((name, fn, postprocess))
        return fn
    return Register


def _Normalize(text):
    """Strip the parts of ezdxf's output that change between runs.

    Two of them: a pair of random GUIDs in the header ($FINGERPRINTGUID, $VERSIONGUID), and the
    "<version> @ <timestamp>" strings ezdxf stamps into its own metadata. Without this the fixtures
    would differ on every regeneration and the CI check could never pass.

    The clock-based header variables are handled separately, in _Write, because they are set before
    the document is written rather than during writing.
    """
    text = _GUID_RE.sub(_FIXED_GUID, text)
    text = _EZDXF_STAMP_RE.sub(_FIXED_STAMP, text)
    return _WRITE_TIME_RE.sub(rf"\g<1>{_FIXED_JULIAN_DATE}", text)


# Offset applied to the translated/ variants. Far outside the range where float32 holds integers
# exactly, which is the case the scene origin scheme exists to handle -- survey coordinates in the
# millions. These variants are therefore the one place the [-100, 100] rule does not apply; they
# get no exact goldens, only the invariance comparison.
_TRANSLATION = (1_000_000.0, 500_000.0)


def _Write(name, builder, subdir=None, transform=None, postprocess=None):
    doc = ezdxf.new("R2000", setup=False)
    for var in ("$TDCREATE", "$TDUCREATE", "$TDUPDATE", "$TDUUPDATE"):
        doc.header[var] = _FIXED_JULIAN_DATE
    builder(doc, doc.modelspace())
    if transform is not None:
        transform(doc, doc.modelspace())
    buffer = io.StringIO()
    doc.write(buffer)
    directory = FIXTURES_DIR if subdir is None else FIXTURES_DIR / subdir
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{name}.dxf"
    text = _Normalize(buffer.getvalue())
    if postprocess is not None:
        text = postprocess(text)
    path.write_text(text, encoding="utf-8", newline="")
    return path


def _Translate(doc, msp):
    """Shift every entity, so the drawing sits far from the origin."""
    dx, dy = _TRANSLATION
    for entity in list(msp):
        entity.translate(dx, dy, 0)


def _Explode(doc, msp):
    """Replace every INSERT with copies of the block's entities, placed in modelspace.

    This removes blocks from the drawing entirely, which is what makes the result an independent
    check on DxfScene's block handling rather than another route through it.
    """
    for insert in list(msp.query("INSERT")):
        insert.explode()


# Fixtures whose geometry arrives through an INSERT, and can therefore also be produced with no
# blocks at all.
_EXPLODABLE = ("block-flattened", "block-instanced")


# --------------------------------------------------------------------------------------------
# Fixtures. One function per drawing; keep each one minimal and say what it exercises.
# --------------------------------------------------------------------------------------------

@Fixture("lines")
def _Lines(doc, msp):
    """Bare LINE entities with explicit colors. The simplest path: LINES batches, no indexing."""
    msp.add_line((0, 0), (10, 0), dxfattribs={"color": 1})
    msp.add_line((10, 0), (10, 10), dxfattribs={"color": 3})
    msp.add_line((10, 10), (0, 0), dxfattribs={"color": 5})


@Fixture("polyline")
def _Polyline(doc, msp):
    """Open and closed LWPOLYLINE. The closed one exercises the shape-closing vertex."""
    msp.add_lwpolyline([(0, 0), (10, 0), (10, 10), (0, 10)], close=False,
                       dxfattribs={"color": 1})
    msp.add_lwpolyline([(20, 0), (30, 0), (30, 10), (20, 10)], close=True,
                       dxfattribs={"color": 3})


def _DropSeqEnd(text):
    """Deletes every SEQEND entity, leaving the POLYLINE before it unterminated.

    A DXF writer always closes a POLYLINE with SEQEND, so this cannot be built with ezdxf -- but
    real files do omit it. See the fixture below for why that matters.
    """
    lines = text.split("\n")
    out = []
    i = 0
    while i + 1 < len(lines):
        if lines[i].strip() == "0" and lines[i + 1] == "SEQEND":
            i += 2
            while i + 1 < len(lines) and lines[i].strip() != "0":
                i += 2
            continue
        out.append(lines[i])
        out.append(lines[i + 1])
        i += 2
    out.extend(lines[i:])
    return "\n".join(out)


@Fixture("polyline-no-seqend", postprocess=_DropSeqEnd)
def _PolylineNoSeqEnd(doc, msp):
    """An old-style POLYLINE with no VERTEX entities and no SEQEND, between two LINEs.

    test-data/sample-files/sheets (cn).dxf contains five of these, and they used to hang the
    parser outright: parsePolylineVertices looped until it saw VERTEX or SEQEND and advanced the
    scanner in neither case, so a POLYLINE followed straight by the next entity spun forever.
    AutoCAD tolerates the file, so the vertex list simply ends.

    The two LINEs are the actual assertion. The first proves the entity before survives; the
    second proves parsing resumes on the group the polyline stopped at, rather than swallowing it.
    """
    msp.add_line((0, 0), (10, 0), dxfattribs={"color": 1})
    msp.add_polyline2d([], dxfattribs={"color": 3})
    msp.add_line((0, 10), (10, 10), dxfattribs={"color": 5})


@Fixture("circle-arc")
def _CircleArc(doc, msp):
    """CIRCLE and ARC, i.e. tessellation. Radii and angles are chosen to keep the vertex count
    small and the subdivision deterministic."""
    msp.add_circle((0, 0), radius=10, dxfattribs={"color": 1})
    msp.add_arc((30, 0), radius=10, start_angle=0, end_angle=90, dxfattribs={"color": 3})


@Fixture("points")
def _Points(doc, msp):
    """POINT entities, with $PDMODE left at 0 so they stay plain dots rather than shapes."""
    doc.header["$PDMODE"] = 0
    for x in range(5):
        msp.add_point((x * 10, 0), dxfattribs={"color": 1 + x})


@Fixture("solid-hatch")
def _SolidHatch(doc, msp):
    """Solid HATCH with a hole, which goes through earcut triangulation."""
    hatch = msp.add_hatch(color=2)
    hatch.paths.add_polyline_path([(0, 0), (20, 0), (20, 20), (0, 20)], is_closed=True,
                                  flags=ezdxf.const.BOUNDARY_PATH_EXTERNAL)
    hatch.paths.add_polyline_path([(5, 5), (15, 5), (15, 15), (5, 15)], is_closed=True,
                                  flags=ezdxf.const.BOUNDARY_PATH_OUTERMOST)


@Fixture("solid-hatch-disjoint")
def _SolidHatchDisjoint(doc, msp):
    """Solid HATCH whose loops are separate areas rather than one contour with its islands.

    Nesting depth is what tells the two apart, so the loops here cover every depth the grouping has
    to get right: two disjoint squares, one of them with a hole which in turn has an island, and a
    third square sharing a whole edge with the second. Loops touching like that are the reason the
    nesting probe cannot be a vertex.

    Declared in an order that does not match the nesting, and with no external or outermost flag,
    so nothing but the geometry can be used to sort them out.
    """
    hatch = msp.add_hatch(color=4)
    for loop in ((0, 0, 20, 20),      # disjoint from the rest
                 (40, 0, 60, 20),     # contour with a hole and an island in it
                 (45, 5, 55, 15),     # the hole
                 (48, 8, 52, 12),     # the island
                 (60, 0, 70, 20)):    # shares the whole x=60 edge with the second one
        x0, y0, x1, y1 = loop
        hatch.paths.add_polyline_path([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], is_closed=True)


@Fixture("solid-hatch-mirrored")
def _SolidHatchMirrored(doc, msp):
    """Solid HATCH with a negative Z extrusion, which mirrors it about the X axis.

    Group 210 was not read for HATCH at all until 2026-09-17, so a mirrored hatch drew unmirrored
    and the transform `_DecomposeHatch()` threads through both of its paths was dead code. The
    loops are the same shapes as `solid-hatch-disjoint`, so the two dumps should differ only in the
    sign of every x.
    """
    hatch = msp.add_hatch(color=4, dxfattribs={"extrusion": (0, 0, -1)})
    for x0, y0, x1, y1 in ((0, 0, 20, 20), (40, 0, 60, 20), (45, 5, 55, 15), (48, 8, 52, 12)):
        hatch.paths.add_polyline_path([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], is_closed=True)


@Fixture("solid-hatch-ignore-style")
def _SolidHatchIgnoreStyle(doc, msp):
    """Solid HATCH in "ignore" style (75 = 2) over two external loops, one of them with an island.

    The style fills through the inner structure, so the island must not be punched out -- and the
    second external loop must survive, which it did not until 2026-09-17: the filter kept
    `boundaryLoops[0]` alone, on the assumption that a hatch has one external loop.
    """
    hatch = msp.add_hatch(color=6)
    hatch.dxf.hatch_style = ezdxf.const.HATCH_STYLE_IGNORE
    for loop, external in (((0, 0, 20, 20), True),
                           ((5, 5, 15, 15), False),
                           ((30, 0, 50, 20), True)):
        x0, y0, x1, y1 = loop
        hatch.paths.add_polyline_path(
            [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], is_closed=True,
            flags=ezdxf.const.BOUNDARY_PATH_EXTERNAL if external else 0)


@Fixture("solid-hatch-edge-paths")
def _SolidHatchEdgePaths(doc, msp):
    """Solid HATCH whose boundary paths are edge lists rather than polylines.

    The same square and hole as `solid-hatch`, so the two dumps should agree on the geometry, but
    arriving by the other half of the parser: an edge path ends with `97` and the handles of the
    objects it was made from, and the edge parser used to swallow that `97` as one of its own
    spline groups. It is the handles that make it fatal -- the `97` of the hole is read anyway,
    because the path parser picks the next path up from its `92` -- so the outer path is made
    associative to the line it was drawn from, which is how a real drawing writes it. The parser
    was then left staring at a `330`, ended the whole entity, and the hole was lost: the square
    filled in solid. This is the only fixture whose boundaries reach that code; a polyline path
    writes its `97` too, but the edge parser is never called for it.
    """
    hatch = msp.add_hatch(color=2)
    points = [(0, 0), (20, 0), (20, 20), (0, 20)]
    path = hatch.paths.add_edge_path(flags=ezdxf.const.BOUNDARY_PATH_EXTERNAL)
    for i, point in enumerate(points):
        path.add_line(point, points[(i + 1) % len(points)])
    hatch.associate(path, [msp.add_line(points[0], points[1], dxfattribs={"color": 2})])

    hole = hatch.paths.add_edge_path(flags=ezdxf.const.BOUNDARY_PATH_OUTERMOST)
    hole_points = [(5, 5), (15, 5), (15, 15), (5, 15)]
    for i, point in enumerate(hole_points):
        hole.add_line(point, hole_points[(i + 1) % len(hole_points)])


@Fixture("pattern-hatch")
def _PatternHatch(doc, msp):
    """Pattern HATCH, which goes through the hatch line clipping instead."""
    hatch = msp.add_hatch()
    # The color belongs on set_pattern_fill: it takes a `color` argument defaulting to 7, which
    # silently overwrites whatever add_hatch was given.
    hatch.set_pattern_fill("ANSI31", color=3, scale=2.0)
    hatch.paths.add_polyline_path([(0, 0), (20, 0), (20, 20), (0, 20)], is_closed=True,
                                  flags=ezdxf.const.BOUNDARY_PATH_EXTERNAL)


@Fixture("pattern-hatch-embedded-spacing")
def _PatternHatchEmbeddedSpacing(doc, msp):
    """Pattern HATCH whose embedded definition disagrees with $MEASUREMENT.

    A definition embedded in the entity is already scaled, so it records the spacing the drawing
    was made at; the pattern table copy still has to be scaled, and which table that is comes from
    the header. Editors do write the two inconsistently -- six drawings of the corpus do -- and
    believing the header over the numbers in the entity makes the hatch 25.4 times too dense, which
    at any ordinary zoom is solid.

    Metric numbers are embedded here and then the header is switched to imperial, which is the
    direction that costs a factor of 25.4. ANSI31 is 3.175 mm against 0.125 in, so the embedded
    line spacing is 3.175 * 0.5 and the table would give 0.125 * 0.5.
    """
    doc.header["$MEASUREMENT"] = 1
    hatch = msp.add_hatch()
    hatch.set_pattern_fill("ANSI31", color=3, scale=0.5)
    doc.header["$MEASUREMENT"] = 0
    hatch.paths.add_polyline_path([(0, 0), (20, 0), (20, 20), (0, 20)], is_closed=True,
                                  flags=ezdxf.const.BOUNDARY_PATH_EXTERNAL)


@Fixture("pattern-hatch-rotated")
def _PatternHatchRotated(doc, msp):
    """The same pattern as `pattern-hatch-embedded-spacing`, at the orientation a mirrored plan
    hatches it in.

    A definition embedded in a HATCH carries the orientation *that drawing* uses the pattern in, and
    the entity's pattern angle is what turned it there. This one is the table's ANSI31 turned by 90
    as the drawing's own base -- the walls run the other way round, which is what "mirrorring" means
    in the file this comes from -- and then turned by another 90, so the definition line reads 45
    again and the single 45 degrees solid line is once more what both sides see.

    Comparing the two by their absolute angles still called that a different pattern, so the table
    won: one wall of a floor plan came out hatched at 135 degrees with 9.525 between its lines where
    the walls beside it have 0.375 at 45. The header is metric and the numbers in the entity
    imperial, as in the neighbour, so the two answers differ in density too.

    Written out by hand rather than through `set_pattern_fill(..., angle=90)`, which would bake the
    rotation into the definition line and put it at 135 -- and a definition line that is not 45 is
    not what the QCAD placeholder test matches, so the hatch would never reach the code at all.
    """
    doc.header["$MEASUREMENT"] = 1
    hatch = msp.add_hatch()
    hatch.set_pattern_fill("ANSI31", color=3, scale=1.0)
    half = 0.125 / 2 ** 0.5
    hatch.set_pattern_definition([(45.0, (0, 0), (half, -half), [])])
    hatch.dxf.pattern_angle = 90
    hatch.paths.add_polyline_path([(0, 0), (20, 0), (20, 20), (0, 20)], is_closed=True,
                                  flags=ezdxf.const.BOUNDARY_PATH_EXTERNAL)


@Fixture("pattern-hatch-placeholder")
def _PatternHatchPlaceholder(doc, msp):
    """A HATCH named PLAST carrying the single 45 degrees line QCAD writes into every hatch it
    creates, whatever the hatch is named.

    The name is what the drawing means, so the pattern table has to win here -- but the two cannot
    be told apart by that line alone, since ANSI31 is itself a single 45 degrees solid line. What
    separates them is that PLAST is three horizontal lines, so this pins the case where the
    embedded definition really is a placeholder. Its neighbour, `pattern-hatch-embedded-spacing`,
    pins the case where it is not, and the two answers are opposite.

    The definition is the one QCAD writes whatever the hatch is named: ANSI31's own line, scaled by
    the pattern scale, which is 1 here and so the numbers of the pattern table itself.
    """
    hatch = msp.add_hatch()
    hatch.set_pattern_fill("PLAST", color=3, scale=1.0)
    hatch.set_pattern_definition([(45.0, (0, 0), (-2.2450640303, 2.2450640303), [])])
    hatch.paths.add_polyline_path([(0, 0), (20, 0), (20, 20), (0, 20)], is_closed=True,
                                  flags=ezdxf.const.BOUNDARY_PATH_EXTERNAL)


@Fixture("pattern-hatch-concave")
def _PatternHatchConcave(doc, msp):
    """Pattern HATCH over an L-shaped boundary.

    The notch is the point: a clipping bug that emits segments outside the loop shows up here and
    not on a convex boundary, where "between the two extreme crossings" happens to be right.
    """
    hatch = msp.add_hatch()
    hatch.set_pattern_fill("ANSI31", color=5, scale=2.0)
    hatch.paths.add_polyline_path([(0, 0), (20, 0), (20, 8), (8, 8), (8, 20), (0, 20)],
                                  is_closed=True,
                                  flags=ezdxf.const.BOUNDARY_PATH_EXTERNAL)


# How much of the bottom left corner of `pattern-hatch-cut-corner`'s hole is cut off. Small on
# purpose -- see the builder.
_CORNER_CUT = 1 / 128


@Fixture("pattern-hatch-cut-corner")
def _PatternHatchCutCorner(doc, msp):
    """Pattern HATCH whose hole has a corner cut off, at the size that puts a pattern line through
    the cut.

    The clipping has to decide, for every crossing near a loop vertex, whether the line really
    crossed the boundary there or only touched it. That decision used to be taken as a fraction of
    each edge, so the two edges meeting at a vertex disagreed about where the vertex ends -- a
    tessellated fillet chord against the long wall running into it is a ratio of two orders of
    magnitude. ANSI31's line through the origin is the one that grazes the cut here: it crosses the
    cut edge cleanly but comes within the long wall's own margin of the cut corner, and the pair
    was then counted once instead of twice. Everything past the corner came out with its parity
    inverted, which draws the line straight across the hole -- 40 of the 56.5 units of it.

    The cut is 1/128, which puts the graze inside the window the old margin left open. The hole is
    twice as tall as it is wide so that the line leaves through its right edge rather than exactly
    through its top corner.
    """
    hatch = msp.add_hatch()
    hatch.set_pattern_fill("ANSI31", color=5, scale=1.0)
    hatch.paths.add_polyline_path([(-5, -5), (60, -5), (60, 100), (-5, 100)], is_closed=True,
                                  flags=ezdxf.const.BOUNDARY_PATH_EXTERNAL)
    hatch.paths.add_polyline_path([(2, 2 + _CORNER_CUT), (2 + _CORNER_CUT, 2), (42, 2),
                                   (42, 92), (2, 92)], is_closed=True,
                                  flags=ezdxf.const.BOUNDARY_PATH_OUTERMOST)


# One representable step at 8192, the magnitude `pattern-hatch-repeated-vertex` sits at:
# 2**13 * 2**-52. ezdxf writes it as 8200.000000000002, which reads back as the same double.
_ULP = 2 ** -39


@Fixture("pattern-hatch-repeated-vertex")
def _PatternHatchRepeatedVertex(doc, msp):
    """Pattern HATCH whose hole repeats a vertex one representable step away from itself.

    A loop that names the same point twice - which a tessellated arc does where it meets the edge
    after it - leaves an edge of no length between the two. Where the coordinates are large the
    two copies are not bit-identical, because they were arrived at by different arithmetic, and
    the edge is then one unit in the last place long rather than zero: 9e-13 at the 6270 of
    "03.Profili.dxf", against the 2e-16 an exact zero has to beat to be recognised as one. It has
    a direction, computed by normalising the rounding between two equal points, and that direction
    decides which side of the line the boundary leaves on. The answer is noise, and at a vertex it
    is the whole answer: the crossing there was read as a touch and dropped, and the line carried
    on through the hole -- 12.8 units of it in that drawing.

    The hole here has that corner at (8200, 8200), and ANSI31's line through it grazes it: at 8192
    one step is 1.8e-12, comfortably above 2e-16, so the edge passes for real. The outer boundary
    is about 40 units across, which puts the endpoint margin at 6e-5 -- the crossing has to land
    inside that for the corner to be examined at all. It is not square with the hole, so that no
    pattern line enters or leaves through one of its own corners, where which of the two edges is
    crossed is a tie.
    """
    hatch = msp.add_hatch()
    hatch.set_pattern_fill("ANSI31", color=5, scale=1.0)
    hatch.paths.add_polyline_path([(8176, 8180), (8220, 8180), (8220, 8224), (8176, 8224)],
                                  is_closed=True, flags=ezdxf.const.BOUNDARY_PATH_EXTERNAL)
    hatch.paths.add_polyline_path([(8200, 8212), (8200, 8200), (8200 + _ULP, 8200),
                                   (8212, 8204), (8208, 8212)],
                                  is_closed=True, flags=ezdxf.const.BOUNDARY_PATH_OUTERMOST)


@Fixture("pattern-hatch-textbox")
def _PatternHatchTextbox(doc, msp):
    """Pattern HATCH carrying textbox boundary paths (group 92 bit 8).

    An associative hatch made from an area containing text writes one textbox path per text
    entity, the bounding box of that text. AutoCAD marks them external like a real outline, so
    the style filters keep them, and using them as fill boundaries paints a rectangle wherever a
    label happens to sit. "03.Profili.dxf" has one hatch on layer "Srafura unutra" carrying nine
    of them -- six 26.65 by 13 and three smaller, all outside the real outline -- which came out
    as nine red hatched rectangles scattered over the sheet.

    Two boxes pin both halves of "a textbox is never a fill area": one clear of the square, which
    was filled as a separate region, and one inside it, where island detection would instead
    punch a hole. ezdxf ignores text boxes the same way, in both its hatch renderer
    (`hatch_boundary_paths(filter_text_boxes=True)`) and its drawing frontend.
    """
    hatch = msp.add_hatch()
    hatch.set_pattern_fill("ANSI31", color=3, scale=2.0)
    hatch.paths.add_polyline_path([(0, 0), (20, 0), (20, 20), (0, 20)], is_closed=True,
                                  flags=ezdxf.const.BOUNDARY_PATH_EXTERNAL)
    for x0, y0, x1, y1 in ((30, 0, 40, 10), (5, 5, 15, 15)):
        hatch.paths.add_polyline_path(
            [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], is_closed=True,
            flags=ezdxf.const.BOUNDARY_PATH_EXTERNAL | ezdxf.const.BOUNDARY_PATH_TEXTBOX)


@Fixture("block-flattened")
def _BlockFlattened(doc, msp):
    """A block small enough that DxfScene inlines it into ordinary batches.

    Block.SetFlatten() flattens when useCount == 1, or when useCount * verticesCount <= 1024. Four
    vertices used twice is far below that, so both inserts are flattened.
    """
    block = doc.blocks.new(name="SMALL")
    block.add_lwpolyline([(0, 0), (4, 0), (4, 4), (0, 4)], close=True, dxfattribs={"color": 1})
    msp.add_blockref("SMALL", (0, 0))
    msp.add_blockref("SMALL", (10, 0))


@Fixture("block-instanced")
def _BlockInstanced(doc, msp):
    """A block big enough that DxfScene instances it instead of inlining it.

    The threshold is useCount * verticesCount > 1024, so the product is what has to be large --
    and the product is also roughly the number of coordinates in the dump. Few instances of one
    long polyline therefore keeps the golden reviewable, where many instances of a small shape
    would not: 8 runs of 131 points rather than 260 squares.
    """
    points = [(x, x % 2) for x in range(131)]
    block = doc.blocks.new(name="LONG")
    block.add_lwpolyline(points, close=False, dxfattribs={"color": 1})
    for i in range(8):
        msp.add_blockref("LONG", (0, i * 10))


@Fixture("block-recursive")
def _BlockRecursive(doc, msp):
    """Blocks which reference each other in a cycle, which the viewer has to cut rather than follow.

    AutoCAD refuses to create one of these and ezdxf audits it as an error, but the construct does
    reach viewers, and expanding it is unbounded recursion -- a blown stack that loses the whole
    drawing, not just the block.

    Three shapes of cycle, because the obvious check catches only some of them. A nested block is
    expanded with a context that keeps naming the *outermost* block, so comparing against that one
    name sees A -> B -> A and A -> B -> C -> A but not a cycle further down the chain:

      B -> C -> B   reached from A, closing below the block the expansion started from
      D -> D        direct self-reference, reached through a nesting level
      E -> E        direct self-reference of the block whose definition is being processed

    Each block draws one line at its own height, so the golden shows exactly how far the expansion
    got before each cycle was cut.
    """
    blocks = {name: doc.blocks.new(name=name) for name in ("A", "B", "C", "D", "E")}
    for i, (name, color) in enumerate((("A", 1), ("B", 3), ("C", 5), ("D", 2), ("E", 4))):
        blocks[name].add_line((0, i * 2), (10, i * 2), dxfattribs={"color": color})
    blocks["A"].add_blockref("B", (0, 0))
    blocks["A"].add_blockref("D", (0, 0))
    blocks["B"].add_blockref("C", (0, 0))
    blocks["C"].add_blockref("B", (0, 0))
    blocks["D"].add_blockref("D", (0, 0))
    blocks["E"].add_blockref("E", (0, 0))
    msp.add_blockref("A", (0, 0))
    msp.add_blockref("E", (20, 0))


# The generated test font covers A, B, I and space only, so fixture text is spelled from those --
# see test/fixtures/README.md. The glyphs' identity does not matter; their differing advance widths
# (A and B are 1000 units, I is 400, space 500) are what make a layout mistake visible.

@Fixture("text")
def _Text(doc, msp):
    """TEXT at several alignments and heights.

    TEXT is always anchored at the left baseline in the file; the alignment codes re-place it, which
    is why TextBlock has to choose between the insertion point and the alignment point.
    """
    msp.add_text("ABI", height=2, dxfattribs={"color": 1}).set_placement((0, 0))
    msp.add_text("ABI", height=2, dxfattribs={"color": 3}).set_placement(
        (0, 10), align=TextEntityAlignment.MIDDLE_CENTER)
    msp.add_text("ABI", height=2, dxfattribs={"color": 5}).set_placement(
        (0, 20), align=TextEntityAlignment.BOTTOM_RIGHT)
    # Half height, so the glyph geometry scales rather than just moving.
    msp.add_text("IB", height=1, dxfattribs={"color": 2}).set_placement((0, 30))


@Fixture("text-rotated")
def _TextRotated(doc, msp):
    """A rotated TEXT, so the glyph transform is not just a translation."""
    msp.add_text("AI", height=2, rotation=90, dxfattribs={"color": 1}).set_placement((0, 0))


@Fixture("mtext")
def _MText(doc, msp):
    """MTEXT with a paragraph break and inline colour codes.

    Most inline formatting is flattened by TextBox.FeedText. Paragraph breaks are honoured, and so
    is colour -- but only at a paragraph boundary.
    """
    # A colour code at the start of a paragraph is applied; the same code in the middle of one is
    # not, because TextBox tracks colour per paragraph rather than per span. Both are here so the
    # golden shows the boundary rather than just one side of it.
    msp.add_mtext("AB\\P\\C3;IB", dxfattribs={"char_height": 2, "color": 1, "insert": (0, 20)})
    msp.add_mtext("A\\C3;B", dxfattribs={"char_height": 2, "color": 1, "insert": (0, 10)})


@Fixture("mtext-stacked")
def _MTextStacked(doc, msp):
    """MTEXT with the \\S stacking code in each of its forms.

    The whole user data of a \\S code lies between the code and its terminating ";", so a parser
    that skips the code skips the text with it -- which is how a table cell holding nothing but a
    stacked pair came out blank. The divider decides what is drawn between the two pieces: "^"
    nothing, "/" a horizontal line, "#" a slanted one.
    """
    attribs = {"char_height": 2, "color": 1}
    # A tolerance-style stack. The space after "^" is how a producer keeps the caret from being
    # read as a control character, and belongs to the encoding rather than to the text.
    msp.add_mtext("\\SA^ B;", dxfattribs={**attribs, "insert": (0, 40)})
    # The two divider lines.
    msp.add_mtext("\\SA/B;", dxfattribs={**attribs, "insert": (0, 30)})
    msp.add_mtext("\\SA#B;", dxfattribs={**attribs, "insert": (0, 20)})
    # The shape the issue was reported with: a stack inside a height scope, followed by plain text
    # which has to stay on the same line beside it.
    msp.add_mtext("{\\H0.7x;\\SA^ B;}I", dxfattribs={**attribs, "insert": (0, 10)})
    # No divider at all: nothing is stacked and the user data is plain text. The escaping rules
    # around the divider have no geometry to show for them and are covered in
    # test/unit/text-format.test.mjs instead -- none of ^, / and # is in the test font.
    msp.add_mtext("\\SAB;", dxfattribs={**attribs, "insert": (0, 0)})


@Fixture("mtext-wrap")
def _MTextWrap(doc, msp):
    """MTEXT wrapped at the width of its reference rectangle.

    Lines are assembled from chunks, and a space is the only chunk boundary a space-separated
    script offers -- so text written without spaces came out as one unbroken line however narrow
    the box was. A run of such characters has to offer a break between the characters themselves.

    The test font gives U+4E00, U+4E8C and U+3001 an advance of exactly the text height, so the
    reference width of 5 below is two and a half characters.
    """
    # The ideographic comma is what makes the first line three characters wide: a break before it
    # is suppressed, so it stays with the character it follows instead of opening the next line.
    msp.add_mtext("\u4e00\u4e00\u3001\u4e8c\u4e8c",
                  dxfattribs={"char_height": 2, "color": 1, "insert": (0, 20), "width": 5})
    # A break is offered where the two scripts meet, but not inside the latin run -- "II" is 2.2222
    # wide, so the second one would otherwise wrap on its own.
    msp.add_mtext("II\u4e00II",
                  dxfattribs={"char_height": 2, "color": 3, "insert": (0, 0), "width": 5})


@Fixture("mtext-wrap-spacing")
def _MTextWrapSpacing(doc, msp):
    """MTEXT whose wrapped line begins with a chunk that carries leading spaces.

    A chunk holds the spaces that precede it, and a chunk which begins a continuation line is
    drawn without them -- so the width the line was measured with has to drop them too. Measured
    with the spaces, the running width is too large by one space for the rest of that line: the
    next word wraps when it would have fitted, and the line width that centers or right-aligns
    the line is overstated by the same amount.

    At char_height 2 the test font gives "A" and "B" an advance of 1000/720 * 2 = 2.7778, "I"
    400/720 * 2 = 1.1111 and a space 500/720 * 2 = 1.3889.
    """
    attribs = {"char_height": 2, "color": 1}
    # "AA" is 5.5556 and " BB" 6.9444 with its space, so "BB" wraps. " II" is 3.6111; it fits on
    # the second line at 5.5556 + 3.6111 = 9.1667, but not at 6.9444 + 3.6111 = 10.5556. So the
    # space decides whether this is two lines or three.
    msp.add_mtext("AA BB II", dxfattribs={**attribs, "insert": (0, 10), "width": 10})
    # The same overstatement moves a line that does not change its wrapping. "BB" alone occupies
    # the second line either way, but centering it in the box of 6 shifts it by (6 - 5.5556) / 2
    # = 0.2222 rather than by (6 - 6.9444) / 2 = -0.4722.
    msp.add_mtext("\\pxqc;AA BB", dxfattribs={**attribs, "insert": (0, 0), "width": 6})


@Fixture("mtext-caret")
def _MTextCaret(doc, msp):
    """MTEXT caret control codes: "^J" is a line break and "^I" a tabulator.

    Caret notation is an *encoding* rather than a format code -- "^" and a letter stand for the
    control character 64 below it -- so a parser that does not decode it renders the two
    characters literally, which is what these drawings used to show.

    The default tab stops are at 4, 8, 12, ... times the entity's character height, so at 8, 16
    and 24 here. "A" is 1000/720 * 2 = 2.7778 wide, which is what makes the first tab visible:
    it carries the next glyph to 8 rather than to 2.7778.

    "^ " is the way a literal caret is written, and an unrecognised "^X" keeps both characters.
    Neither has any geometry to show for it -- the test font has no caret glyph -- so both live
    in test/unit/text-format.test.mjs instead, as the \\S divider escapes do.
    """
    attribs = {"char_height": 2, "color": 1}
    # A line feed, which behaves exactly as \P does.
    msp.add_mtext("A^JB", dxfattribs={**attribs, "insert": (0, 30)})
    # "^M" is the carriage return of a CRLF pair; the break is the "^J", so this is one break and
    # not two, and no space is left behind on either line.
    msp.add_mtext("A^M^JB", dxfattribs={**attribs, "insert": (0, 20)})
    # One tabulator: "B" starts at the first stop, 8.
    msp.add_mtext("A^IB", dxfattribs={**attribs, "insert": (0, 10)})
    # Consecutive tabulators each advance a whole stop, to 16 -- which is how a drawing that has
    # no table entity builds one out of MTEXT.
    msp.add_mtext("A^I^IB", dxfattribs={**attribs, "insert": (0, 0)})


@Fixture("text-missing-glyph")
def _TextMissingGlyph(doc, msp):
    """Text containing a character no loaded font covers.

    Z is absent from the test font on purpose. The scene should still build, and report
    hasMissingChars, which is what surfaces to the viewer as a `message` event.
    """
    msp.add_text("AZB", height=2, dxfattribs={"color": 1}).set_placement((0, 0))


@Fixture("dimension-linear")
def _DimensionLinear(doc, msp):
    """A horizontal linear DIMENSION with no pre-rendered block.

    Without a geometry block the viewer has to synthesize the lines, arrowheads and text itself
    through LinearDimension, which is the path with no other coverage.
    """
    msp.add_linear_dim(base=(0, 5), p1=(0, 0), p2=(10, 0), dxfattribs={"color": 1})


@Fixture("dimension-aligned")
def _DimensionAligned(doc, msp):
    """An aligned DIMENSION, the other type LinearDimension synthesizes (type 1 rather than 0)."""
    msp.add_aligned_dim(p1=(0, 0), p2=(8, 6), distance=3, dxfattribs={"color": 3})


@Fixture("dimension-colors")
def _DimensionColors(doc, msp):
    """The three ways a DIMSTYLE colour variable resolves.

    DIMCLRD, DIMCLRE and DIMCLRT are DXF colour *numbers*: 0 is BYBLOCK, 256 is BYLAYER and 1..255
    index the ACI table. The overrides also arrive as XDATA, which is the first step of the
    style-resolution precedence chain.
    """
    doc.layers.add("DIMS", color=2)
    # commit() persists the overrides as XDATA without generating a geometry block, so the viewer
    # still synthesizes the dimension. Without it ezdxf keeps them on the returned override object
    # and the file carries no XDATA at all.
    # Explicit ACI indices, a different one for each of the three parts.
    msp.add_linear_dim(base=(0, 5), p1=(0, 0), p2=(10, 0), dxfattribs={"color": 7},
                       override={"dimclrd": 1, "dimclre": 3, "dimclrt": 5}).commit()
    # BYLAYER, on a layer that is yellow.
    msp.add_linear_dim(base=(0, 20), p1=(0, 15), p2=(10, 15),
                       dxfattribs={"color": 7, "layer": "DIMS"},
                       override={"dimclrd": 256, "dimclre": 256, "dimclrt": 256}).commit()


@Fixture("dimension-arrowhead")
def _DimensionArrowhead(doc, msp):
    """Dimensions whose arrowheads are chosen by DIMBLK rather than left at the default arrow.

    The variable names a block, and since R2000 it is written as that block's *handle* (group codes
    342, 343, 344) -- the name forms 5, 6 and 7 are obsolete and absent from anything a modern CAD
    writes, which is what ezdxf produces here too. The parser has to follow the handle back to a
    name once the whole file is read, so this fixture covers the indirection as much as the shapes.

    Four styles, one dimension each, bottom to top:

      * ARCHTICK  -- the reported case (issue #80): an architectural tick instead of an arrow.
      * NONE      -- no arrowhead at all, so the dimension line stands alone.
      * SAH       -- DIMSAH selects DIMBLK1 and DIMBLK2 per end; a tick on the first, the default
                     arrow on the second (an empty DIMBLK2 means the default, not "none").
      * DOT       -- an arrowhead block that is not synthesized, which must fall back to the
                     default arrow rather than draw nothing.

    set_arrows() also writes the arrowhead blocks themselves, "_CLOSEDFILLED" among them although
    nothing names it, which is why the dump has block batches no INSERT ever reaches.
    """
    tick = doc.dimstyles.duplicate_entry("Standard", "TICK")
    tick.set_arrows(blk=ARROWS.architectural_tick)
    none = doc.dimstyles.duplicate_entry("Standard", "NONE")
    none.set_arrows(blk=ARROWS.none)
    sah = doc.dimstyles.duplicate_entry("Standard", "SAH")
    sah.set_arrows(blk1=ARROWS.architectural_tick)
    sah.dxf.dimsah = 1
    dot = doc.dimstyles.duplicate_entry("Standard", "DOT")
    dot.set_arrows(blk=ARROWS.dot)

    for i, style in enumerate(("TICK", "NONE", "SAH", "DOT")):
        y = i * 20
        msp.add_linear_dim(base=(0, y + 5), p1=(0, y), p2=(10, y), dimstyle=style,
                           dxfattribs={"color": 1})


@Fixture("dimension-degenerate")
def _DimensionDegenerate(doc, msp):
    """A DIMENSION whose two measurement points coincide.

    LinearDimension sets isValid false for this. Left unguarded it draws garbage -- two coincident
    extension lines, a zero-length dimension line and a pair of arrowheads pointing opposite ways
    from the same point -- so the guard has to actually fire.

    The second, valid dimension is here so the fixture shows the guard is selective rather than
    just producing an empty scene.
    """
    msp.add_linear_dim(base=(0, 5), p1=(4, 0), p2=(4, 0), dxfattribs={"color": 1})
    msp.add_linear_dim(base=(0, 20), p1=(0, 15), p2=(10, 15), dxfattribs={"color": 3})


@Fixture("attrib")
def _Attrib(doc, msp):
    """An INSERT carrying an ATTRIB, plus the ATTDEF in the block definition.

    ATTRIB text takes its layer and colour from the owning INSERT rather than from itself, which is
    the part worth pinning.
    """
    block = doc.blocks.new(name="TAGGED")
    block.add_lwpolyline([(0, 0), (6, 0), (6, 4), (0, 4)], close=True, dxfattribs={"color": 5})
    block.add_attdef(tag="LABEL", text="AB", height=2, insert=(0, 5))
    insert = msp.add_blockref("TAGGED", (0, 0), dxfattribs={"color": 3})
    insert.add_auto_attribs({"LABEL": "AB"})
    # ezdxf leaves an ATTRIB owned by the layout's block record. AutoCAD points it at the owning
    # INSERT -- all 188 ATTRIBs in sample-files/AEC Plan Elev Sample (dim,hatch,sheets).dxf do --
    # and that handle is how the viewer finds the INSERT to inherit layer and colour from. Without
    # this the fixture would quietly exercise the fallback instead of the inheritance.
    for attrib in insert.attribs:
        attrib.dxf.owner = insert.dxf.handle


@Fixture("point-shape-in-block")
def _PointShapeInBlock(doc, msp):
    """A shaped POINT inside a block definition, alongside one at top level.

    $PDMODE 34 is a plus inside a circle, which makes points render as an instanced shape block
    rather than as plain geometry. Instancing only ever happens at top level -- a nested INSERT is
    flattened into its enclosing block definition -- so a point inside a block has to be emitted
    inline too. The BYLAYER and BYBLOCK points are what make an unresolved colour reach the batch
    key if it is not.
    """
    doc.header["$PDMODE"] = 34
    doc.header["$PDSIZE"] = 2
    doc.layers.add("MARKS", color=3)
    block = doc.blocks.new(name="PT")
    block.add_point((0, 0), dxfattribs={"color": 256})      # BYLAYER
    block.add_point((4, 0), dxfattribs={"color": 0})        # BYBLOCK
    block.add_point((8, 0), dxfattribs={"color": 5})        # explicit
    # Two inserts, away from the origin, so the fixture shows all three symptoms at once: the
    # marker has to appear once per insert (not once in total), at the insert's position (not the
    # block-local one), in a resolved colour.
    msp.add_blockref("PT", (10, 0), dxfattribs={"layer": "MARKS", "color": 1})
    msp.add_blockref("PT", (10, 20), dxfattribs={"layer": "MARKS", "color": 1})
    msp.add_point((30, 0), dxfattribs={"color": 1})


@Fixture("layers-colors")
def _LayersColors(doc, msp):
    """Color resolution: BYLAYER (256), BYBLOCK (0) outside any block, and explicit values."""
    doc.layers.add("RED", color=1)
    doc.layers.add("GREEN", color=3)
    msp.add_line((0, 0), (10, 0), dxfattribs={"layer": "RED", "color": 256})
    msp.add_line((0, 2), (10, 2), dxfattribs={"layer": "GREEN", "color": 256})
    msp.add_line((0, 4), (10, 4), dxfattribs={"layer": "RED", "color": 5})
    msp.add_line((0, 6), (10, 6), dxfattribs={"layer": "GREEN", "color": 0})


@Fixture("layers-frozen")
def _LayersFrozen(doc, msp):
    """LAYER group 70, whose bits do not all mean "hidden".

    Only bit 1 freezes a layer. Bit 2 is "frozen by default in new viewports", which describes
    viewports the drawing does not have yet, and bit 4 is "locked", which prevents editing and
    nothing else -- so three of these five lines have to reach the scene, on three visible layers.
    """
    doc.layers.add("FROZEN", color=1).dxf.flags = 1
    doc.layers.add("VP_FROZEN", color=3).dxf.flags = 2
    doc.layers.add("LOCKED", color=5).dxf.flags = 4
    # Both bits together: the frozen one still wins.
    doc.layers.add("FROZEN_VP", color=2).dxf.flags = 3
    doc.layers.add("PLAIN", color=6).dxf.flags = 0
    for i, layer in enumerate(("FROZEN", "VP_FROZEN", "LOCKED", "FROZEN_VP", "PLAIN")):
        msp.add_line((0, 2 * i), (10, 2 * i), dxfattribs={"layer": layer, "color": 256})


@Fixture("mesh-3dface")
def _Mesh3dFace(doc, msp):
    """3DFACE, which decomposes into triangles rather than lines."""
    msp.add_3dface([(0, 0), (10, 0), (10, 10), (0, 10)], dxfattribs={"color": 2})
    msp.add_3dface([(20, 0), (30, 0), (30, 10), (30, 10)], dxfattribs={"color": 4})


# --------------------------------------------------------------------------------------------
# Test font.
#
# Generated rather than donated. A real TTF would be hundreds of kilobytes, would raise a licensing
# question for a published package, and -- the point -- would have outlines nobody can check by
# hand. This one is under 1 KB, every glyph is a rectangle with known coordinates, and the awkward
# cases (a contour with a hole, a kerning pair, a character with no glyph at all) are there on
# purpose.
# --------------------------------------------------------------------------------------------

FONT_UNITS_PER_EM = 1000
# Font.scale in TextRenderer is 100 / (unitsPerEm * 72), so with 1000 units/em every measurement
# below divides by 720 -- which keeps the expected values in the tests short enough to verify.
FONT_KERN_PAIR = ("A", "B")
FONT_KERN_VALUE = -120


def _Rect(pen, x0, y0, x1, y1, clockwise=True):
    """A rectangular contour.

    TrueType fills by non-zero winding with **clockwise outer contours** and counter-clockwise
    holes, and three.js\'s ShapePath.toShapes relies on exactly that to tell one from the other.
    Getting it backwards does not fail -- it silently swaps them, so a glyph with a hole comes out
    as a small solid box instead of a ring.
    """
    points = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    if clockwise:
        points.reverse()
    pen.moveTo(points[0])
    for point in points[1:]:
        pen.lineTo(point)
    pen.closePath()


def _WriteFont():
    """Writes fonts/test-font.ttf.

    Glyph shapes, all rectangles so the tessellated output can be read by eye:
      A  a plain 800x800 box, advance 1000
      B  the same box with a 400x400 hole in it, which is what exercises hole triangulation
      I  a narrow 200x800 box with a smaller advance, so layout cannot ignore advance widths
      space  no outline, advance 500
    "Z" is deliberately absent, to exercise the missing-glyph path and `hasMissingChars`.

    U+4E00, U+4E8C and U+3001 are there so that line breaking in a script written without spaces
    has something to break.
    """
    glyphs = {}

    pen = TTGlyphPen(None)
    _Rect(pen, 100, 0, 900, 800)
    glyphs["A"] = pen.glyph()

    pen = TTGlyphPen(None)
    _Rect(pen, 100, 0, 900, 800)
    _Rect(pen, 300, 200, 700, 600, clockwise=False)
    glyphs["B"] = pen.glyph()

    pen = TTGlyphPen(None)
    _Rect(pen, 100, 0, 300, 800)
    glyphs["I"] = pen.glyph()

    glyphs["space"] = TTGlyphPen(None).glyph()
    glyphs[".notdef"] = TTGlyphPen(None).glyph()

    # Digits, a decimal point and a minus, so DIMENSION fixtures can render their own measurement
    # text. All identical boxes: what matters for layout is the advance, not legibility.
    digit_names = {str(d): f"digit{d}" for d in range(10)}
    for name in digit_names.values():
        pen = TTGlyphPen(None)
        _Rect(pen, 100, 0, 500, 800)
        glyphs[name] = pen.glyph()
    pen = TTGlyphPen(None)
    _Rect(pen, 100, 0, 200, 100)
    glyphs["period"] = pen.glyph()
    pen = TTGlyphPen(None)
    _Rect(pen, 100, 300, 500, 400)
    glyphs["hyphen"] = pen.glyph()

    # Three characters from a script written without spaces between words, for the MTEXT wrapping
    # fixture. Their advance is 720 units -- the scale is font units / 720 -- so each one advances
    # exactly the text height and a reference rectangle width can be read as a character count.
    pen = TTGlyphPen(None)
    _Rect(pen, 90, 0, 630, 720)
    glyphs["cjkOne"] = pen.glyph()
    pen = TTGlyphPen(None)
    _Rect(pen, 90, 0, 630, 360)
    glyphs["cjkTwo"] = pen.glyph()
    pen = TTGlyphPen(None)
    _Rect(pen, 90, 0, 270, 180)
    glyphs["cjkComma"] = pen.glyph()

    order = ([".notdef", "space", "A", "B", "I"] +
             [digit_names[str(d)] for d in range(10)] +
             ["period", "hyphen", "cjkOne", "cjkTwo", "cjkComma"])
    advances = {".notdef": 500, "space": 500, "A": 1000, "B": 1000, "I": 400,
                "period": 300, "hyphen": 600,
                "cjkOne": 720, "cjkTwo": 720, "cjkComma": 720}
    for name in digit_names.values():
        advances[name] = 600

    fb = FontBuilder(FONT_UNITS_PER_EM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({0x20: "space", 0x41: "A", 0x42: "B", 0x49: "I",
                          0x2E: "period", 0x2D: "hyphen",
                          0x4E00: "cjkOne", 0x4E8C: "cjkTwo", 0x3001: "cjkComma",
                          **{0x30 + d: digit_names[str(d)] for d in range(10)}})
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({name: (advances[name], 100) for name in order})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": "DxfViewerTest", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost()

    from fontTools.ttLib.tables._k_e_r_n import KernTable_format_0, table__k_e_r_n
    subtable = KernTable_format_0()
    subtable.version = 0
    subtable.coverage = 1
    subtable.format = 0
    subtable.kernTable = {FONT_KERN_PAIR: FONT_KERN_VALUE}
    kern = table__k_e_r_n()
    kern.version = 0
    kern.kernTables = [subtable]
    fb.font["kern"] = kern

    # head.created and head.modified default to the wall clock, so they have to be pinned for the
    # same reason the DXF timestamps are: CI regenerates and diffs.
    head = fb.font["head"]
    head.created = head.modified = 0

    directory = FIXTURES_DIR / "fonts"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "test-font.ttf"
    fb.save(path)
    return path


def Main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("names", nargs="*", help="Fixtures to write; default is all of them.")
    args = parser.parse_args()

    selected = [e for e in _REGISTRY if not args.names or e[0] in args.names]
    unknown = set(args.names) - {n for n, _, _ in _REGISTRY}
    if unknown:
        sys.exit(f"Unknown fixture(s): {', '.join(sorted(unknown))}")

    for name, builder, postprocess in selected:
        paths = [_Write(name, builder, postprocess=postprocess),
                 _Write(name, builder, subdir="translated", transform=_Translate,
                        postprocess=postprocess)]
        if name in _EXPLODABLE:
            paths.append(_Write(name, builder, subdir="exploded", transform=_Explode,
                                postprocess=postprocess))
        for path in paths:
            print(f"{path.relative_to(FIXTURES_DIR.parent.parent)}  {path.stat().st_size:>7} B")

    if not args.names:
        path = _WriteFont()
        print(f"{path.relative_to(FIXTURES_DIR.parent.parent)}  {path.stat().st_size:>7} B")


if __name__ == "__main__":
    Main()

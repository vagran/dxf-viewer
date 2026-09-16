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


def Fixture(name):
    """Registers a fixture builder. The function receives the document and its modelspace."""
    def Register(fn):
        _REGISTRY.append((name, fn))
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


def _Write(name, builder, subdir=None, transform=None):
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
    path.write_text(_Normalize(buffer.getvalue()), encoding="utf-8", newline="")
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


@Fixture("pattern-hatch")
def _PatternHatch(doc, msp):
    """Pattern HATCH, which goes through the hatch line clipping instead."""
    hatch = msp.add_hatch()
    # The color belongs on set_pattern_fill: it takes a `color` argument defaulting to 7, which
    # silently overwrites whatever add_hatch was given.
    hatch.set_pattern_fill("ANSI31", color=3, scale=2.0)
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


@Fixture("text-missing-glyph")
def _TextMissingGlyph(doc, msp):
    """Text containing a character no loaded font covers.

    Z is absent from the test font on purpose. The scene should still build, and report
    hasMissingChars, which is what surfaces to the viewer as a `message` event.
    """
    msp.add_text("AZB", height=2, dxfattribs={"color": 1}).set_placement((0, 0))


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

    order = [".notdef", "space", "A", "B", "I"]
    advances = {".notdef": 500, "space": 500, "A": 1000, "B": 1000, "I": 400}

    fb = FontBuilder(FONT_UNITS_PER_EM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({0x20: "space", 0x41: "A", 0x42: "B", 0x49: "I"})
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

    selected = [(n, f) for n, f in _REGISTRY if not args.names or n in args.names]
    unknown = set(args.names) - {n for n, _ in _REGISTRY}
    if unknown:
        sys.exit(f"Unknown fixture(s): {', '.join(sorted(unknown))}")

    for name, builder in selected:
        paths = [_Write(name, builder),
                 _Write(name, builder, subdir="translated", transform=_Translate)]
        if name in _EXPLODABLE:
            paths.append(_Write(name, builder, subdir="exploded", transform=_Explode))
        for path in paths:
            print(f"{path.relative_to(FIXTURES_DIR.parent.parent)}  {path.stat().st_size:>7} B")

    if not args.names:
        path = _WriteFont()
        print(f"{path.relative_to(FIXTURES_DIR.parent.parent)}  {path.stat().st_size:>7} B")


if __name__ == "__main__":
    Main()

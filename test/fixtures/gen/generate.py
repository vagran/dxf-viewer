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


def _Write(name, builder):
    doc = ezdxf.new("R2000", setup=False)
    for var in ("$TDCREATE", "$TDUCREATE", "$TDUPDATE", "$TDUUPDATE"):
        doc.header[var] = _FIXED_JULIAN_DATE
    builder(doc, doc.modelspace())
    buffer = io.StringIO()
    doc.write(buffer)
    path = FIXTURES_DIR / f"{name}.dxf"
    path.write_text(_Normalize(buffer.getvalue()), encoding="utf-8", newline="")
    return path


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


def Main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("names", nargs="*", help="Fixtures to write; default is all of them.")
    args = parser.parse_args()

    selected = [(n, f) for n, f in _REGISTRY if not args.names or n in args.names]
    unknown = set(args.names) - {n for n, _ in _REGISTRY}
    if unknown:
        sys.exit(f"Unknown fixture(s): {', '.join(sorted(unknown))}")

    for name, builder in selected:
        path = _Write(name, builder)
        print(f"{path.relative_to(FIXTURES_DIR.parent.parent)}  {path.stat().st_size:>7} B")


if __name__ == "__main__":
    Main()

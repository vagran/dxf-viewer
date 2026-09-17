#!/usr/bin/env python3
"""Query DXF files in bulk: "which of these has X".

    python3 test/tools/dxfq.py [options] <expression>
    npm run query -- [options] <expression>

The expression is Python, evaluated once per file, and whatever it returns is printed next to the
file name. Falsy results are skipped, so a predicate reads as a filter and a count reads as a
ranking. That is the whole interface: "find me a sample drawing with X" is open-ended, so there is
no fixed list of queries to outgrow.

**Why this exists rather than grep.** A DXF file is a stream of (group code, value) *pairs* on
alternating lines, in nested sections, with either line ending. Grep sees none of that. In
particular `awk '/^ *420$/'` matches nothing in a CRLF file, so a scan like that reports a
confident answer drawn from only some of the input -- a wrong result with no error, which is the
failure mode worth engineering away. This pairs the codes properly and normalizes line endings.

Two modes, because the questions genuinely differ:

  default   ezdxf parses the file. Ask about entities, blocks, layers, header variables -- what
            the drawing *means*. Needs ezdxf: `pip install -r test/fixtures/requirements.txt`.
            Note ezdxf is stricter than this project's own parser, so a file dxf-viewer reads may
            fail here; those are reported per file, never skipped silently.
  --raw     the file is tokenized into (code, value) pairs and nothing is interpreted. Ask what is
            *literally in the file*: which group codes appear, what a value looks like before
            anyone normalizes it, whether something occurs in the wild at all. Needs nothing but
            Python.

By default it scans test/fixtures/ plus test-data/ if you have a corpus there; missing directories
are simply skipped, so it works in a fresh clone. Use --dir or --file to point it elsewhere.

Examples, all of them questions that came up while building the test suite:

    # Drawings whose dimensions are not pre-rendered, so the viewer has to synthesize them.
    npm run query -- 'count(e for e in msp if e.dxftype() == "DIMENSION" and not e.dxf.get("geometry"))'

    # Which point display mode each drawing asks for.
    npm run query -- 'header("$PDMODE") or None'

    # ATTRIBs whose owner handle really is an INSERT, which is what AutoCAD writes.
    npm run query -- 'count(e for e in msp if e.dxftype() == "ATTRIB")'

    # Every distinct true-color method byte in the corpus -- the query grep got wrong.
    npm run query -- --raw 'sorted({hex(int(v) >> 24 & 0xFF) for c, v in pairs if c == 420})'

    # Entity types no fixture covers yet.
    npm run query -- 'sorted(types() - {"LINE", "LWPOLYLINE", "CIRCLE", "ARC", "POINT", "HATCH"})'

    # Anything using a code page other than the default.
    npm run query -- --raw 'next((v for c, v in pairs if c == 3 and "ANSI" in v), None)'

    # Biggest drawings by entity count, to find a stress case.
    npm run query -- 'len(entities)'
"""

import argparse
import collections
import pathlib
import re
import sys
import time

# test/tools/dxfq.py -> the repository root.
REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

# test-data/selected-samples/ is deliberately absent: it is symlinks into sample-files/, which is
# scanned whole, so listing both would report the same drawing twice under two names.
DEFAULT_DIRS = [
    "test-data/sample-files",
    "test/fixtures",
]

BINARY_SENTINEL = b"AutoCAD Binary DXF"


def _CollectFiles(directories, recursive):
    files = []
    for directory in directories:
        base = REPO_ROOT / directory
        if not base.exists():
            continue
        pattern = "**/*.dxf" if recursive else "*.dxf"
        files.extend(sorted(p for p in base.glob(pattern) if p.is_file()))
    # A directory may be listed twice, or nested inside another.
    seen, unique = set(), []
    for path in files:
        if path not in seen:
            seen.add(path)
            unique.append(path)
    return unique


def _ReadPairs(path):
    """Tokenize a DXF into (int code, str value) pairs.

    Decoded as latin-1 so no byte sequence can fail; these questions are about structure, not
    text. Line endings are normalized, which is the part a grep gets wrong.
    """
    raw = path.read_bytes()
    if raw[:len(BINARY_SENTINEL)] == BINARY_SENTINEL:
        raise ValueError("binary DXF, not tokenizable as text")
    lines = raw.decode("latin-1").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    pairs = []
    for i in range(0, len(lines) - 1, 2):
        code = lines[i].strip()
        if not code:
            continue
        try:
            pairs.append((int(code), lines[i + 1].strip()))
        except ValueError:
            # A value that happened to land on a code line: the file is malformed or our pairing
            # slipped. Either way, say so rather than guessing.
            raise ValueError(f"not a group code at line {i + 1}: {code!r}")
    return pairs


def _RawNamespace(path):
    pairs = _ReadPairs(path)

    def codes():
        return collections.Counter(c for c, _ in pairs)

    def values(code):
        return [v for c, v in pairs if c == code]

    return {"pairs": pairs, "codes": codes, "values": values}


def _SemanticNamespace(path):
    import ezdxf
    doc = ezdxf.readfile(path)
    msp = doc.modelspace()
    entities = list(msp)

    def header(name, default=None):
        return doc.header.get(name, default)

    def types():
        return collections.Counter(e.dxftype() for e in entities)

    def by_type(name):
        return [e for e in entities if e.dxftype() == name]

    return {
        "doc": doc, "msp": msp, "entities": entities, "blocks": doc.blocks,
        "layers": doc.layers, "header": header, "types": types, "by_type": by_type,
        "ezdxf": ezdxf,
    }


def Main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("expression", help="Python expression evaluated per file.")
    parser.add_argument("--raw", action="store_true",
                        help="Tokenize instead of parsing; ask about literal group codes.")
    parser.add_argument("--dir", action="append", dest="dirs", metavar="DIR",
                        help="Directory to scan, relative to the repo root. Repeatable. "
                             f"Default: {', '.join(DEFAULT_DIRS)}")
    parser.add_argument("--file", action="append", dest="explicit_files", metavar="PATH",
                        help="Scan this file only. Repeatable.")
    parser.add_argument("--recursive", action="store_true",
                        help="Recurse into subdirectories of each --dir.")
    parser.add_argument("--max-size", type=float, default=None, metavar="MB",
                        help="Skip files larger than this, for a quick pass.")
    parser.add_argument("--list", action="store_true",
                        help="Print matching paths only, for piping.")
    parser.add_argument("--all", action="store_true",
                        help="Print every file, including falsy results.")
    args = parser.parse_args()

    if args.explicit_files:
        files = [pathlib.Path(f) for f in args.explicit_files]
    else:
        files = _CollectFiles(args.dirs or DEFAULT_DIRS, args.recursive)
    if not files:
        sys.exit("No .dxf files found. Is test-data/ populated?")

    if not args.raw:
        try:
            import ezdxf  # noqa: F401
        except ImportError:
            sys.exit("This mode parses with ezdxf, which is not installed.\n"
                     "  pip install -r test/fixtures/requirements.txt\n"
                     "Or use --raw, which needs nothing but Python.")

    code = compile(args.expression, "<expression>", "eval")
    base = {"count": lambda it: sum(1 for _ in it), "Counter": collections.Counter,
            "re": re, "sorted": sorted, "len": len, "set": set}

    results, errors, skipped = [], [], 0
    started = time.monotonic()
    for path in files:
        if args.max_size is not None and path.stat().st_size > args.max_size * 1024 * 1024:
            skipped += 1
            continue
        namespace = dict(base)
        namespace["path"] = path
        namespace["name"] = path.name
        try:
            namespace.update(_RawNamespace(path) if args.raw else _SemanticNamespace(path))
            value = eval(code, namespace)
        except Exception as error:
            errors.append((path, f"{type(error).__name__}: {error}"))
            continue
        results.append((path, value))

    def Relative(path):
        """Relative to the repo root, without resolving.

        test-data/sample-files is a symlink out of the repo on this machine, so resolving would
        print an absolute path from somewhere else entirely.
        """
        try:
            return path.relative_to(REPO_ROOT)
        except ValueError:
            return path

    def Sortable(item):
        value = item[1]
        return (-value, str(item[0])) if isinstance(value, (int, float)) else (0, str(item[0]))

    matched = [r for r in results if r[1]] if not args.all else results
    for path, value in sorted(matched, key=Sortable):
        relative = Relative(path)
        if args.list:
            print(relative)
        else:
            print(f"{str(relative):<52} {value}")

    if args.list:
        return
    elapsed = time.monotonic() - started
    print(f"\n{len(files) - skipped} file(s) in {elapsed:.1f}s, {len(matched)} matched, "
          f"{len(errors)} error(s)" + (f", {skipped} skipped by size" if skipped else ""))
    for path, message in errors:
        print(f"  ERROR {Relative(path)}: {message}")


if __name__ == "__main__":
    Main()

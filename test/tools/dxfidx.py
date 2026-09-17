#!/usr/bin/env python3
"""Content index of the sample-file corpus: "do we already have this drawing?"

    python3 test/tools/dxfidx.py [update]
    python3 test/tools/dxfidx.py find <path | sha256 prefix | name substring>...
    python3 test/tools/dxfidx.py dups
    python3 test/tools/dxfidx.py note <path | sha256 prefix> [text]
    npm run index -- <the same>

**Why content and not names.** Drawings arrive attached to issues and pull requests, named
whatever the reporter's CAD system called them, and a file that is already in the corpus under
another name is indistinguishable from a new one by eye. Two such pairs are in there right now:
`buldge-width-polyline (bad layers).dxf` is byte-identical to `road.dxf`, and `epsg-5186.dwg` to
`korean-site-2-epsg-5186/sw좌표도면_24.09.03-R1.dwg`. So the key is the sha256 of the bytes, and
`find` takes the downloaded file itself: hash it, answer in one command.

**Why a rebuild and not an incremental update.** Hashing the whole corpus takes a couple of
seconds -- 1.2 GB, mostly page-cached -- so there is no mtime cache, no staleness and nothing to
invalidate. The index is always exactly what is on disk at the moment it was written.

The index is `index.ndjson` at the root of the corpus, one JSON object per line, sorted by path,
so it both greps line-wise and parses. It lives inside the corpus rather than in the repository
because the corpus is user- and customer-supplied and cannot be redistributed, and because the
`note` field is hand-written and has to travel with the drawings it describes.

Only `note` is written by hand; everything else is derived. It survives a rebuild keyed by
content, so renaming a file keeps its note, and so does editing one that stays at the same path.
"""

import argparse
import hashlib
import json
import pathlib
import re
import sys
import time

# test/tools/dxfidx.py -> the repository root.
REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

CORPUS_DIR = REPO_ROOT / "test-data" / "sample-files"
INDEX_NAME = "index.ndjson"

CHUNK_SIZE = 1 << 20

# The HEADER section is read out of the first hash chunk rather than by a second pass. The widest
# one in the corpus ends 25 KB in, so a 1 MB chunk is not a limit anything is near.
BINARY_SENTINEL = b"AutoCAD Binary DXF"
DWG_SENTINEL = re.compile(rb"^AC1[0-9]{3}")

# Written in this order, so a rebuilt index diffs cleanly against the previous one. Fields with
# nothing in them are left out of the line entirely.
FIELD_ORDER = ["path", "sha256", "size", "mtime", "acadver", "guid", "note"]


def _ReadHeaderVars(head):
    """Pull $ACADVER and $FINGERPRINTGUID out of the first bytes of a file.

    `head` is the first chunk, not the whole file. Returns a dict that may be empty: a binary DXF,
    a DWG or an archive has no text HEADER to read, and plenty of text DXFs write neither variable.

    A header variable is a group 9 carrying its name followed by one pair carrying its value, so
    the value sits two lines past the name. Matching the name alone would also hit it as a string
    value somewhere else, hence the check that group 9 precedes it.
    """
    if head[:len(BINARY_SENTINEL)] == BINARY_SENTINEL:
        return {}
    if DWG_SENTINEL.match(head):
        # A DWG announces its version in the first six bytes and says nothing else without being
        # parsed properly.
        return {"acadver": head[:6].decode("ascii")}

    text = head.decode("latin-1").replace("\r\n", "\n").replace("\r", "\n")
    end = text.find("\nENDSEC")
    if end >= 0:
        text = text[:end]
    lines = text.split("\n")

    def Value(name):
        for i, line in enumerate(lines):
            if line.strip() != name or i == 0 or lines[i - 1].strip() != "9":
                continue
            if i + 2 < len(lines):
                return lines[i + 2].strip()
        return None

    result = {}
    for name, field in (("$ACADVER", "acadver"), ("$FINGERPRINTGUID", "guid")):
        value = Value(name)
        if value:
            result[field] = value
    return result


def _Digest(path):
    """The sha256 of a file, and its first chunk.

    Takes any path, not only one inside the corpus: `find` hashes the drawing that just came off a
    pull request, which is the whole point of the tool.
    """
    digest = hashlib.sha256()
    head = b""
    with path.open("rb") as stream:
        while True:
            chunk = stream.read(CHUNK_SIZE)
            if not chunk:
                break
            if not head:
                head = chunk
            digest.update(chunk)
    return digest.hexdigest(), head


def _Scan(path):
    """Build the index record for one file of the corpus."""
    checksum, head = _Digest(path)
    stat = path.stat()
    record = {
        "path": str(path.relative_to(CORPUS_DIR)),
        "sha256": checksum,
        "size": stat.st_size,
        "mtime": time.strftime("%Y-%m-%d", time.localtime(stat.st_mtime)),
    }
    record.update(_ReadHeaderVars(head))
    return record


def _CorpusFiles():
    """Every regular file in the corpus, the index itself excepted.

    Deliberately not restricted to `*.dxf`: the corpus holds DWG, `.xz` and `.zip` besides, and
    "do we have this file already" is the same question for all of them. Editor backups (`*~`)
    are indexed too rather than filtered -- they are real bytes on a synced disk, and having them
    turn up under `dups` is how they get noticed.
    """
    if not CORPUS_DIR.exists():
        sys.exit(f"No corpus at {CORPUS_DIR}. It is a symlink to a local collection on this "
                 f"machine; nothing here works without it.")
    files = []
    for path in CORPUS_DIR.rglob("*"):
        if path.is_symlink() or not path.is_file():
            continue
        if path.name == INDEX_NAME and path.parent == CORPUS_DIR:
            continue
        files.append(path)
    return sorted(files, key=lambda p: str(p.relative_to(CORPUS_DIR)))


def _IndexPath():
    return CORPUS_DIR / INDEX_NAME


def _LoadIndex(required=False):
    path = _IndexPath()
    if not path.exists():
        if required:
            sys.exit(f"No index at {path}. Build one with: npm run index")
        return []
    records = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as error:
            sys.exit(f"{path}:{number}: {error}")
    return records


def _WriteIndex(records):
    lines = []
    for record in sorted(records, key=lambda r: r["path"]):
        ordered = {k: record[k] for k in FIELD_ORDER if record.get(k) not in (None, "")}
        # ensure_ascii=False keeps the Korean and Japanese file names readable, and greppable as
        # the user typed them.
        lines.append(json.dumps(ordered, ensure_ascii=False))
    _IndexPath().write_text("\n".join(lines) + "\n", encoding="utf-8")


def _Describe(record):
    parts = [f"{record['size'] / 1024 / 1024:.1f} MB", record["sha256"][:12], record["mtime"]]
    text = f"  {record['path']}\n      {', '.join(parts)}"
    if record.get("note"):
        text += f"\n      note: {record['note']}"
    return text


def _PathsByHash(records):
    grouped = {}
    for record in records:
        grouped.setdefault(record["sha256"], set()).add(record["path"])
    return grouped


def _Diff(old, records):
    """What changed between the previous index and the rebuilt one, as (label, text) lines.

    Paths say what happened; content only explains it. Keeping those apart is the whole
    difficulty. Deleting one of two identical files takes a path away while its content stays in
    the corpus, and since that is exactly what `dups` invites, it must not come out as silence --
    which is what a content-only comparison does. Equally, a rename is not an addition plus a
    removal, so a path that vanishes while another appears with its content is reported as one
    move, but only when the pairing is unambiguous: one path in, one path out. Where several
    paths collapse onto one, each is listed with what became of its content, because which of
    them was "the rename" is not knowable from here and would be a guess presented as fact.
    """
    old_by_path = {r["path"]: r for r in old}
    new_by_path = {r["path"]: r for r in records}
    changed = {p for p in old_by_path.keys() & new_by_path.keys()
               if old_by_path[p]["sha256"] != new_by_path[p]["sha256"]}

    old_paths = _PathsByHash(old)
    new_paths = _PathsByHash(records)
    lines = [("changed", path, "") for path in changed]

    for digest in set(old_paths) | set(new_paths):
        # A path whose content changed is already reported; it would otherwise show up a second
        # time, as a removal under its old hash and an addition under its new one.
        before = old_paths.get(digest, set()) - changed
        after = new_paths.get(digest, set()) - changed
        if before == after:
            continue
        vanished, appeared = sorted(before - after), sorted(after - before)
        if len(vanished) == 1 and len(appeared) == 1:
            lines.append(("moved", f"{vanished[0]} -> {appeared[0]}", ""))
            continue
        for path in vanished:
            survivor = sorted(after)
            lines.append(("removed", path, f"content kept as {survivor[0]}" if survivor
                          else "content gone from the corpus"))
        for path in appeared:
            source = sorted(before)
            lines.append(("added", path, f"same content as {source[0]}" if source else ""))
    # By path, so that the removals and the addition a deduplication produces sit together.
    return sorted(lines, key=lambda line: (line[1], line[0]))


def Update(args):
    """Rebuild the index from what is on disk, carrying hand-written notes over."""
    started = time.monotonic()
    old = _LoadIndex()
    old_by_path = {r["path"]: r for r in old}
    old_by_hash = {}
    for record in old:
        # Several paths can share content, and the note is the reason to prefer one of them.
        held = old_by_hash.get(record["sha256"])
        if held is None or (record.get("note") and not held.get("note")):
            old_by_hash[record["sha256"]] = record

    files = _CorpusFiles()
    records = []
    for path in files:
        record = _Scan(path)
        # A note follows the content first and the path second, so a renamed file keeps its note
        # and so does one that was edited in place.
        previous = old_by_hash.get(record["sha256"]) or old_by_path.get(record["path"])
        if previous and previous.get("note"):
            record["note"] = previous["note"]
        records.append(record)
    _WriteIndex(records)

    elapsed = time.monotonic() - started
    total = sum(r["size"] for r in records)
    index = _IndexPath().relative_to(REPO_ROOT)
    print(f"{len(records)} file(s), {total / 1024 / 1024 / 1024:.2f} GB, in {elapsed:.1f}s "
          f"-> {index}")
    if not old:
        return
    lines = _Diff(old, records)
    for label, text, explanation in lines:
        print(f"  {label:<8} {text}" + (f"    ({explanation})" if explanation else ""))

    new_by_path = {r["path"] for r in records}
    new_by_hash = {r["sha256"] for r in records}
    for record in old:
        if (record.get("note") and record["sha256"] not in new_by_hash
                and record["path"] not in new_by_path):
            print(f"  NOTE LOST for a file no longer present: {record['path']}: {record['note']}")
    if not lines:
        print("  no change")


def _Lookup(records, query):
    """Resolve one query to matching records, and say how it was read."""
    path = pathlib.Path(query)
    if path.is_file():
        checksum, _ = _Digest(path)
        return [r for r in records if r["sha256"] == checksum], f"content of {query}"
    if re.fullmatch(r"[0-9a-fA-F]{6,64}", query):
        lowered = query.lower()
        return [r for r in records if r["sha256"].startswith(lowered)], f"hash prefix {query}"
    lowered = query.lower()
    return ([r for r in records if lowered in r["path"].lower()
             or lowered in (r.get("note") or "").lower()], f"name or note matching {query!r}")


def Find(args):
    """Answer "is this in the corpus" for a file, a hash prefix or a name."""
    records = _LoadIndex(required=True)
    missing = False
    for query in args.queries:
        matches, how = _Lookup(records, query)
        if args.json:
            for record in matches:
                print(json.dumps(record, ensure_ascii=False))
            missing = missing or not matches
            continue
        if matches:
            print(f"{len(matches)} match(es) by {how}:")
            for record in matches:
                print(_Describe(record))
        else:
            missing = True
            print(f"NOT in the corpus, by {how}")
            path = pathlib.Path(query)
            if path.is_file():
                # Not the same bytes, but a same-size file is worth looking at before adding
                # another copy of a drawing that was only re-saved.
                size = path.stat().st_size
                near = [r for r in records if r["size"] == size]
                stem = path.stem.lower()[:12]
                near += [r for r in records
                         if stem and stem in r["path"].lower() and r not in near]
                for record in near[:5]:
                    print(f"  similar: {record['path']} ({record['size']} bytes)")
        print()
    sys.exit(1 if missing else 0)


def Dups(args):
    """Group the index by content and print every group with more than one file in it."""
    records = _LoadIndex(required=True)
    groups = {}
    for record in records:
        groups.setdefault(record["sha256"], []).append(record)
    duplicates = {h: g for h, g in groups.items() if len(g) > 1}
    if not duplicates:
        print("No duplicate content.")
        return
    wasted = 0
    for digest, group in sorted(duplicates.items(), key=lambda kv: -kv[1][0]["size"]):
        wasted += group[0]["size"] * (len(group) - 1)
        print(f"{digest[:12]}  {group[0]['size'] / 1024 / 1024:.1f} MB x {len(group)}")
        for record in group:
            print(f"    {record['path']}")
    print(f"\n{len(duplicates)} group(s), {wasted / 1024 / 1024:.1f} MB in redundant copies")


def Note(args):
    """Read or set the hand-written note on one file."""
    records = _LoadIndex(required=True)
    matches, how = _Lookup(records, args.query)
    if not matches:
        sys.exit(f"Nothing matches {how}.")
    if len(matches) > 1 and args.text is not None:
        print(f"{len(matches)} files match {how}; be more specific:")
        for record in matches:
            print(_Describe(record))
        sys.exit(1)
    if args.text is None:
        for record in matches:
            print(f"{record['path']}: {record.get('note') or '(no note)'}")
        return
    record = matches[0]
    if args.text:
        record["note"] = args.text
    else:
        record.pop("note", None)
    _WriteIndex(records)
    print(f"{record['path']}: {record.get('note') or '(note cleared)'}")


def Main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subparsers = parser.add_subparsers(dest="command")

    update = subparsers.add_parser("update", help="Rebuild the index (the default).")
    update.set_defaults(function=Update)

    find = subparsers.add_parser(
        "find", help="Look a file, a hash prefix or a name up in the index.")
    find.add_argument("queries", nargs="+", metavar="QUERY",
                      help="A path to hash, a sha256 prefix, or a substring of a name or note.")
    find.add_argument("--json", action="store_true", help="Print matching index lines verbatim.")
    find.set_defaults(function=Find)

    dups = subparsers.add_parser("dups", help="Report files with identical content.")
    dups.set_defaults(function=Dups)

    note = subparsers.add_parser("note", help="Read or set the note on one file.")
    note.add_argument("query", metavar="QUERY", help="A path, a sha256 prefix or a name.")
    note.add_argument("text", nargs="?", default=None,
                      help="The note to store. Omit to read it, pass \"\" to clear it.")
    note.set_defaults(function=Note)

    args = parser.parse_args()
    if args.command is None:
        args.function = Update
    args.function(args)


if __name__ == "__main__":
    Main()

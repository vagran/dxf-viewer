# Tests

```bash
npm install     # once
npm test        # node --test; the whole suite
npm run typecheck
npm run smoke   # build every drawing available and report on it
```

No browser and no DXF corpus is needed for any of them; they run in a few seconds.

In VS Code the same things are tasks: `test` (bound to *Tasks: Run Test Task*),
`test (watch)`, `test (current file)` and `typecheck`.

- **`imports.test.mjs`** — imports every module under `src/` in its own node process. The package
  ships raw ES modules, so this is what catches an extensionless relative specifier or a circular
  import that only survives when the graph is entered through `index.js`. The separate process per
  module is the point: within one process the module registry is shared and the second kind of
  failure disappears.
- **`package.test.mjs`** — checks what the published package promises: that everything `src/`
  imports is a runtime dependency rather than a development one, and that the type declarations
  ship.
- **`types/`** — a miniature consumer package that compiles `consumer.ts` against the published
  `index.d.ts`. It imports `dxf-viewer` **by name**, not by relative path, so packaging and module
  resolution are exercised too, and it sets `skipLibCheck: false`, which most starter tsconfigs
  turn on and which is how a broken declaration file ships unnoticed.
- **`scene.test.mjs`** — builds every drawing in `fixtures/` and compares a canonical dump of the
  result against `expected/<name>.dump`. This is the test that covers what the library is actually
  for; everything above it is hygiene.
- **`unit/`** — one file per area, over the modules that are pure functions: `math` (Matrix2 and
  the segment intersection helpers), `buffer` (DynamicBuffer), `batching-key` (the comparator, and
  the prefix-contiguity that batch lookup depends on), `text-format` (the `%%`-code substitution
  and the MTEXT inline format parser), `pattern` (`.pat` parsing and the name registry), `hatch`
  (`ClipLine`) and `font` (the generated test font's glyph geometry). No fixtures and no DXF: these
  take numbers and strings. `parser-color`, `parser-layer` and `parser-hatch` are the same idea one
  level up — they splice group codes into a dozen lines of DXF text and read back what the parser
  made of them, which is how a group whose *value* needs interpreting (a color method marker, a
  bit-coded flag), or whose *meaning depends on where it sits* (group 97, which counts a boundary
  path's source objects but a spline edge's fit data), gets pinned without a fixture.
- **`invariants.test.mjs`** — properties that need no expected output: a translated drawing
  produces the same geometry shifted, a drawing with its blocks exploded produces the same geometry
  as one with blocks, hatch lines stay inside their boundary, and a polyline over 0x10000 vertices
  chunks correctly. Two of these work by building the same drawing two ways and requiring the
  results to agree, so neither side has to be known correct in advance.
- **`validate.test.mjs`** — runs `ValidateScene` over every fixture, and separately proves that
  `ValidateScene` can fail, by corrupting a scene seven different ways and requiring each one to be
  caught. Without that second half a validator that checks nothing would look identical to one that
  works.

`consumer.ts` is an inventory of the public API, so a new public method or option belongs there in
the same change that adds it.

## Text

`scene-dump.mjs` supplies the generated test font to every build, so TEXT and MTEXT fixtures
produce real geometry. That font covers **A, B, I and space only**, which is why fixture text is
spelled from those — the glyphs' identity does not matter, but their differing advance widths are
what make a layout mistake visible. See [fixtures/README.md](fixtures/README.md).

`BuildScene(path, {fonts: false})` reproduces the font-less case, which is what `smoke.mjs` does
and why text is invisible to the corpus sweep.

## Scene dumps

`scene-dump.mjs` builds a scene with `DxfScene` and walks it back out through `SceneReader`, which
resolves block instances and deferred colors the same way the renderer does but produces plain
geometry rather than three.js objects. The dump has two halves, because they fail for different
reasons: the **batch list** in scene order, which is sensitive to batching and paint order, and the
**primitives**, sorted, which say what geometry came out regardless of how it was packed.

To accept a deliberate change:

```bash
DXF_UPDATE_GOLDENS=1 npm test
```

Then **read the diff**. A golden regenerated without being read is worse than no test at all. The
dumps are written to be checkable line by line against the generator function that produced the
fixture — see [fixtures/README.md](fixtures/README.md).

## Looking at a drawing

```bash
npm run svg -- test/fixtures/dimension-linear.dxf          # writes ...-linear.svg next to it
npm run svg -- test-data/selected-samples/enterprise/turtle.dxf t.svg  # or an explicit path
npm run svg -- drawing.dxf --font /path/Roboto.ttf          # readable text; repeat for fallbacks
npm run svg -- drawing.dxf out.svg --background=#fff       # light background
npm run svg -- drawing.dxf out.svg --no-invert             # literal colours
npm run svg -- drawing.dxf out.svg --no-text               # skip text entirely
npm run svg -- drawing.dxf out.svg --png --stroke 3        # rasterize too, via rsvg-convert
npm run svg -- --help
```

`--png` needs `rsvg-convert` on `PATH`; without it the SVG is still written and the failure says
so. Raise `--stroke` when rasterizing: a 1-pixel line lands between pixels and antialiases to a
dimmer shade, which makes thin-line *colours* unreliable to judge from a raster even though the
geometry is fine.

The output path is optional and defaults to the input with a `.svg` extension. Options take either
`--opt value` or `--opt=value`.

**Pass `--font` if you want to read the text.** Without it the generated test font is used, in
which every glyph is a rectangle by design — right for asserting layout, useless for looking at.
Repeat the option to build a fallback chain: the library moves to the next font only for a
character the earlier ones have no glyph for, which is how CJK coverage is added. On
`selected-samples/enterprise/korean.dxf`, Roboto alone yields 82,729 text triangles and the
example project's four-font chain yields 107,253 — the difference is the Korean glyphs Roboto has not got.

A review and debugging aid, **not a test** — nothing is asserted and no SVG is committed. The
scene dumps say what the geometry *is*; they cannot say whether a drawing *looks* right, and that
is the gap this fills, without starting the example project and without a GPU.

It renders the same primitives the dumps are built from, through `SceneReader`, so it shows what
the library decided to draw rather than a second opinion about the file. Anything `SceneReader`
cannot see is invisible here too: line widths, line types and paper space, none of which the
library implements.

By default it reproduces the viewer's own `blackWhiteInversion`, so black and white geometry are
both visible on the dark background the viewer uses. `colorCorrection`, off by default in the
viewer, is not reproduced.

Because it takes any path it works on `test-data/` as well as on fixtures — which committed
per-fixture SVG goldens never could, and the corpus is where the hard drawings are. Output is
grouped into one path element per layer, colour and kind, which is what keeps a large drawing
openable: `city.dxf`'s 155k primitives come out as 33 path elements.

## Tools

Three things in `tools/` that are for troubleshooting rather than testing — nothing in CI runs
them.

### `dxfq.py` — which files have X

```bash
npm run query -- 'count(e for e in msp if e.dxftype() == "SPLINE")'
npm run query -- --raw 'sorted({hex(int(v) >> 24 & 0xFF) for c, v in pairs if c == 420})'
npm run query -- --help
```

The expression is Python, evaluated once per file; whatever it returns prints beside the file name,
and falsy results are skipped — so a predicate reads as a filter and a count reads as a ranking.
Scans `fixtures/` plus `test-data/sample-files/` if you have a corpus there, and skips directories
that are not present, so it works in a fresh clone. `test-data/selected-samples/` is deliberately
not scanned: it is symlinks into `sample-files/`, which is scanned whole, so listing both would
report every one of those drawings twice, under two names.

Two modes. The default parses with **ezdxf** — ask what a drawing *means*, in entities, blocks,
layers and header variables. `--raw` tokenizes into `(code, value)` pairs and interprets nothing —
ask what is *literally in the file*, and it needs nothing but Python.

**Prefer it to grepping DXF.** A DXF is alternating code/value lines in nested sections with either
line ending, and grep sees none of that: `awk '/^ *420$/'` matches nothing at all in a CRLF file,
so a scan like that answers confidently from part of the input. This pairs codes properly and
normalizes line endings.

### `ab.sh` — before and after

```bash
DXF_SMOKE_NO_TIMINGS=1 test/tools/ab.sh -- npm run smoke
test/tools/ab.sh --paths "src/DxfScene.js" -- node test/smoke.mjs test/fixtures/circle-arc.dxf
```

Runs a command twice — once against the working tree, once against `HEAD` — and diffs the output.
It reverts **source only** (`src` by default), so the measurement script stays as you just wrote
it, which is what you want when the measurement is new and the behaviour is old. The stash is
restored by an `EXIT`/`INT`/`TERM` trap, so a command that fails or is killed partway still leaves
your tree as it was.

### `dxfidx.py` — do we already have this drawing

```bash
npm run index                                   # rebuild; says what was added, moved, changed, gone
npm run index -- find ~/Downloads/attached.dxf  # hashes it: is it in the corpus, under what name?
npm run index -- find 47a62c99                  # or by sha256 prefix, or by part of a name
npm run index -- dups                           # files with identical content
npm run index -- note road.dxf "issue #142"     # provenance, kept across rebuilds
```

A content index of `test-data/sample-files/`, keyed by the sha256 of the bytes, written to
`index.ndjson` at the root of that directory — one JSON object per line, sorted by path, so it
greps line-wise and parses. Needs nothing but Python.

Names are not an identity: a drawing attached to an issue arrives named whatever the reporter's
CAD system called it, and the first run of this found two pairs of byte-identical files sitting
in the corpus under unrelated names. `find` takes the downloaded file itself, so the check before
adding anything is one command. `note` is the only hand-written field, and it follows the
*content*, so a renamed file keeps its note.

Hashing the whole 1.2 GB corpus takes about 3 seconds, so there is no incremental mode and nothing
to invalidate — a rebuild is always the truth. The report after a rebuild distinguishes a path
going away from its *content* going away, since deleting one of two identical files is only the
first: a removal whose content survives elsewhere says where, and one whose content does not says
that instead. A rename is reported as a single `moved` line only where the pairing is
unambiguous — one path out, one path in; where several paths collapse onto one, each is listed
with what became of its content rather than a guess about which was the rename.

The index lives inside the corpus rather than in the repository because the drawings are user- and
customer-supplied and cannot be redistributed, and because the notes have to travel with them.

`$ACADVER` and `$FINGERPRINTGUID` are recorded alongside, read out of the head of each file.
Treat the GUID as a *lineage* hint and never as a key: it survives a re-save, but sheets exported
from one template share it, and eight drawings in `korean-site-epsg-5186/` do.

## Smoke sweep

```bash
npm run smoke                                  # everything available
npm run smoke -- test-data/selected-samples/enterprise/city.dxf      # or an explicit list
node --max-old-space-size=6144 test/smoke.mjs  # if the largest drawings run out of heap
```

Parses and builds each drawing, runs `ValidateScene` over the result, and reports timings, batch
and layer counts, buffer sizes, unhandled entity types and any warning. Exits non-zero on a warning
or a validation failure.

A handful of fixtures exist to make a guard fire, so their warning *is* the assertion —
`dimension-degenerate.dxf` has two coincident measurement points so `LinearDimension`'s validity
check has something to reject. Those are listed in [`expected-warnings.mjs`](expected-warnings.mjs),
keyed by repo-relative path, each entry matched as a substring of the message. A listed warning
prints as `expected WARN` and does not fail the run; a listed warning that *stops* appearing prints
as `MISSING expected warning` and does, since a guard that quietly stopped firing is the regression
the fixture is there to catch. Leave handles out of the substring — they move when a fixture is
regenerated — and do not expect a count: a dimension is decomposed twice, so its warnings come in
pairs today.

Three properties are what make it worth being one command:

- **Corpus-optional.** It sweeps `test/fixtures/` plus `test-data/selected-samples/` and its
  `enterprise/` subdirectory, skipping whichever is absent, so the same command is correct for a
  contributor with no corpus and for a checkout that has one. CI only ever sees the fixtures,
  because `test-data/` holds customer and user-reported drawings that cannot be redistributed — the
  real value of this is local, but the fixtures are swept locally too, so what CI runs is never a
  path nobody exercises before pushing.
  They come first in the output, which makes a CI run a prefix of a local one and the two
  directly diffable.
- **No goldens.** Everything it asserts is an invariant or a warning count, so adding a drawing
  costs nothing. A file attached to a bug report is covered as soon as it is linked into
  `test-data/selected-samples/`.
- **Stable, diffable output.** Run it before a change, run it after, `diff` the two. A moved batch
  count on an unchanged drawing means the batching changed, which is the cheapest structural
  regression signal there is. Timings are the only part that varies between runs, so
  `DXF_SMOKE_NO_TIMINGS=1` drops them and leaves a diff with no noise in it.

It drives `DxfParser` and `DxfScene` directly — the half of the pipeline with no DOM. It never
constructs a `DxfViewer`, so nothing here checks materials, shaders or colors as rendered, and it
supplies no fonts, so text layout is skipped. A drawing whose only problem is text looks clean.

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
  and the MTEXT inline format parser), `pattern` (`.pat` parsing and the name registry) and `hatch`
  (`ClipLine`). No fixtures and no DXF: these take numbers and strings.
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

## Smoke sweep

```bash
npm run smoke                                  # everything available
npm run smoke -- test-data/enterprise/city.dxf      # or an explicit list
node --max-old-space-size=6144 test/smoke.mjs  # if the largest drawings run out of heap
```

Parses and builds each drawing, runs `ValidateScene` over the result, and reports timings, batch
and layer counts, buffer sizes, unhandled entity types and any warning. Exits non-zero on a warning
or a validation failure.

Three properties are what make it worth being one command:

- **Corpus-optional.** With `test-data/` present it sweeps all of it; without, it falls back to
  `test/fixtures/` and still passes. The same command is correct for a contributor with no corpus
  and for a checkout that has one. CI only ever sees the fixtures, because `test-data/` holds
  customer and user-reported drawings that cannot be redistributed — the real value of this is
  local.
- **No goldens.** Everything it asserts is an invariant or a warning count, so adding a drawing
  costs nothing. A file attached to a bug report is covered the moment it lands in `test-data/`.
- **Stable, diffable output.** Run it before a change, run it after, `diff` the two. A moved batch
  count on an unchanged drawing means the batching changed, which is the cheapest structural
  regression signal there is. Timings are the only part that varies between runs, so
  `DXF_SMOKE_NO_TIMINGS=1` drops them and leaves a diff with no noise in it.

It drives `DxfParser` and `DxfScene` directly — the half of the pipeline with no DOM. It never
constructs a `DxfViewer`, so nothing here checks materials, shaders or colors as rendered, and it
supplies no fonts, so text layout is skipped. A drawing whose only problem is text looks clean.

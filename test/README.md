# Tests

```bash
npm install     # once
npm test        # node --test test/
npm run typecheck
```

No browser and no DXF corpus is needed for either; both run in a few seconds.

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

`consumer.ts` is an inventory of the public API, so a new public method or option belongs there in
the same change that adds it.

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

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

`consumer.ts` is an inventory of the public API, so a new public method or option belongs there in
the same change that adds it.

The solid HATCH covering rooms 99.4/99.5 is fixed. Compare
[comparison.png](comparison.png), or the zoomed [before](before-zoomed.png) and
[after](after-zoomed.png) views. Full-drawing screenshots are kept local for privacy. The zoom is centered on the supplied world bounds
(23.3325, 31.87)–(27.85, 36.5968), with 12% padding.

Entity and root cause:

- `main-test.dxf`, HATCH handle `187C`, layer `0`, ACI 7, SOLID pattern,
  hatch style 1 (outermost), 17 paths, all flagged external (group 92 = 1).
- Raw entity spans lines 169293–170834. The approximate coordinate search
  matches `23.33246519243721` within these boundaries. There is no literal
  rectangular entity with exactly the supplied rounded corners: the visible
  covering shape is erroneous triangulation of this multi-region HATCH.
- Elevation (groups 10/20/30): `(0, 0, -0.00000000000009)`;
  extrusion (210/220/230): `(0, 0, 1)`. No OCS mirroring is involved.
- `parser/entities/hatch.js` correctly reads all 17 boundaries.
  `DxfScene._GetHatchBoundaryLoops()` generates their vertices.
  `_DecomposeHatch()` previously called Earcut with one outline and treated
  the other 16 disconnected outlines as holes. Earcut's hole input requires
  holes inside that outline: https://github.com/mapbox/earcut#usage.
  Invalid hole placement produces bridges/fills across rooms.
- The fix groups solid boundaries by containment and triangulates each filled
  outline with only its immediate holes. Normal style retains nested islands;
  outermost excludes them; ignore style fills each root outline without holes.
  Pattern hatching and other entity rendering paths are unchanged.

Validation:

- Baseline: upstream `c2578b979e2b87e740d44e644b153b89cc59d707`.
- Input SHA-256: `fb318cb87b83c1f7a0e0b86b41174caba6f7dd9c1c11f95a994ae863e0b8c721`.
- Upstream Vue CLI/webpack example, linked to this checkout; Node 24.8.0,
  Chromium 149 via Playwright, SwiftShader, 1600×1100 viewport, DPR 1.
  Canvas screenshots are 1299×1040. Identical camera/origin records are saved
  in `before-view.json` and `after-view.json`. Loading transitions settle first.
- `node tests/solid-hatch.test.mjs`: 9 tests pass (all 9 fail on baseline).
  Tests cover disjoint outlines for all styles, winding/order, holes assigned
  to the correct outline, nested islands, negative extrusion, and the exact
  extracted HATCH. Node >=22.15 is needed only for the test resolution hook.
- The extracted fixture retains a retraced edge in path 8 from the original
  drawing. Its signed area is not a valid area oracle, so area equality is
  checked for the other 16 paths; separation is checked for all 17.
- `NODE_OPTIONS=--openssl-legacy-provider npm run build` in the example passes
  for both legacy and modern bundles (webpack asset-size warnings).
- No browser page errors in either final capture.
- Exactly 14,422 full-view pixels differ, inside pixel rectangle
  `[168, 67, 982, 280)`; all pixels outside that rectangle are identical.
  The changes extend beyond the user's square: the same HATCH also covers
  part of room 99.4 and previously omitted wall strips. Two other multi-outline
  solid HATCHes, `475` and `10FC`, regain missing wall fills from the same fix.
  This is not a claim of zero pixel changes outside the supplied square.
- Building baseline and fixed scenes with these three HATCHes removed, using
  independent copies of the same four demo font fetchers, yields exactly
  equal scene buffers and metadata, including all remaining text and blocks.
- The room/doorway/label now remain visible, consistent with the reported
  TrueView behavior. TrueView is unavailable here and no reference screenshot
  was supplied, so a pixel comparison against TrueView was not performed.

Reproduce screenshots (the full user drawing stays local; only the extracted
HATCH fixture is committed):

```sh
git clone https://github.com/vagran/dxf-viewer-example-src.git /tmp/dxf-viewer-example-src
cd /tmp/dxf-viewer-example-src
npm install
npm install --no-save /absolute/path/to/this/checkout playwright
npx playwright install chromium
NODE_OPTIONS=--openssl-legacy-provider npm run serve -- --host 127.0.0.1
```

In a second terminal, from this checkout:

```sh
DEMO_DIR=/tmp/dxf-viewer-example-src node proof/capture.cjs after /path/to/main-test.dxf
```

Set `CHROMIUM_EXECUTABLE` if using an existing Chromium installation. Capture
`before` with the baseline source, and `after` with the fixed source, using the
same demo and browser. `comparison.png` simply places the zoomed PNGs side by
side with BEFORE/AFTER labels; the screenshot pixels themselves are unchanged.

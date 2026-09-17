# DXF viewer [![npm](https://img.shields.io/npm/v/dxf-viewer)](https://www.npmjs.com/package/dxf-viewer) [![CI](https://github.com/vagran/dxf-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/vagran/dxf-viewer/actions/workflows/ci.yml)

*If you just need to view your DXF, [click here](https://vagran.github.io/dxf-viewer-example/).*

This package provides DXF 2D viewer component written in JavaScript. It renders drawings using WebGL
(via [three.js](https://threejs.org) library). It was carefully crafted with performance in mind,
intended for drawing huge real-world files without performance problems.

The usage example is available here: https://github.com/vagran/dxf-viewer-example-src

Deployed demo: https://vagran.github.io/dxf-viewer-example/

Release preview: https://vagran.github.io/dxf-viewer-example-preview/ — the same demo running the
current development code, ahead of the latest npm release. Worth opening before reporting a
rendering problem, since the fix may already be in there. It is unreleased work by definition, so
expect the occasional rough edge; no npm version corresponds to it, and the revision it was built
from is shown in its toolbar — please quote that if you report something against it.

## Install

```bash
npm install dxf-viewer
```

## Features

 * File fetching, parsing and preparation for rendering is separated in such a way that it can be
   easily off-loaded to web-worker using provided helpers. So the most heavy-weight processing part
   does not affect UI responsiveness. The example above demonstrates this technique.
 * Geometry batching - minimal number of rendering batches is created during file processing, thus
   minimizing total required number of draw calls.
 * Instanced rendering - features which are rendered multiple times with different transforms (e.g.
   DXF block instances) are rendered by a single draw call using instanced rendering WebGL feature.
 * Multiple fonts support. List of fonts can be specified for text rendering. Raw TTF files are
   supported. Fonts are lazy-loaded, once a character encountered which glyph is not yet available
   through already loaded fonts, next font is fetched and checked for the necessary glyph.
 * Layers - layers are taken into account when creating rendering batches so that they can be easily
   hidden/shown.

## Incomplete features

There are still many incomplete features. I will try to implement some of them when I have some
time. Most significant reason for missing implementation is lack of corresponding sample files.

 * Stream parsing for input file. Currently, mostly relying on dxf-parser package which is not
   stream parser and thus buffers whole the file before parsing. This prevents from supporting big
   DXF file (above gigabyte) due to string size limit in JS engine (also making unnecessary memory
   waste for the buffer).
 * Text styling. Currently, text rendering is using just the specified fonts in the specified order.
   DXF style and font attributes are ignored. Text glyphs are always rendered infilled.
 * Advanced formatting support for MTEXT (fonts, coloring, stacking).
 * Line patterns - all lines are rendered in continuous style for now. I am going to use 1-D texture
   generated on preparation stage, texture coordinates (which should account pattern continuity flag
   in DXF vertices attributes), and a dedicated shader to implement this feature.
 * Line patterns with shapes (e.g. with circles).
 * Wide lines. Currently, all lines are rendered as thin lines. Physical width is not implemented.
 * Variable width lines (i.e. with start and end width specified).
 * Smoothed polyline (curve-fit/spline-fit addition vertices).
 * Some features in hatching implementation: outer hatching style, solid/gradient infill, MPolygon
   support, double lines, boundaries defined by external entities.
 * Block instancing in a grid. Grid attributes are ignored now.
 * Dimensions-specific features and styles (various pre-defined arrowhead blocks, text positioning
   tuning, limits and tolerances). Dimensions types other than linear ones.
 * Leaders
 * Non-UTF-8 file encoding support. Currently, such files are displayed incorrectly. `$DWGCODEPAGE`
   parameter is ignored.
 * Full OCS support. Currently, it is assumed that entity extrusion direction is either +Z or -Z
   (which is commonly used for features mirroring in CAD). Arbitrary directions is not properly
   processed.
 * Paper space, layouts (sheets), viewports.
 * Many less commonly used DXF features.

![samples](https://user-images.githubusercontent.com/6065976/143092164-cced2f5f-1af3-42a4-9a71-5dba68df06e7.png)

## DXF standard

The DXF format is poorly documented by Autodesk. The official documentation primarily covers
high-level, generic concepts, while many critical low-level details are omitted. It is likely that
Autodesk internally relies on its proprietary DWG format implementation - on which DXF is largely
based (so the [libredwg](https://www.gnu.org/software/libredwg) project can serve as a useful
reference in some cases). As a result, determining correct rendering behavior - especially in edge
cases - can be challenging.

As a reference, I primarily rely on the [Autodesk online viewer](https://viewer.autodesk.com),
although it occasionally fails to open certain DXF files.

I would also like to acknowledge the [Ezdxf](https://github.com/mozman/ezdxf) project for its
invaluable work of documenting DXF rendering behavior.

Another useful source of information comes from user reports describing how various CAD applications
handle rendering in practice.

## Contributing

Please refer to the [contribution guidelines](CONTRIBUTING.md) for details on how to make pull
requests (PRs). There is an automated test suite — `npm install && npm test`, which needs no
browser and no DXF files of your own; [test/README.md](test/README.md) describes what it covers
and how to add to it. The project also requires various example files for testing purposes. If you
encounter any issues with DXF rendering, it would be greatly appreciated if you could provide an
example file that demonstrates the problem by attaching it to a created issue. Creating minimal
examples in CAD software can also be very helpful. Additionally, creating examples in various
proprietary CAD software to which I do not have access would be highly valuable. Since the entrance
level to start coding in this project is quite high, it is often more useful to receive a detailed
issue report with sample files rather than a pull request. Also issue pre-analysis is very welcome,
if one could find or guess exact reason of the renderer incorrect behavior. A pull request that
fixes a rendering bug is in practice read as a very good bug report rather than as something to
merge as it stands — [CONTRIBUTING.md](CONTRIBUTING.md) explains what that means for you, and
[A note on AI](#a-note-on-ai) explains how it came to be the default.

## A note on AI

Most pull requests this project receives are now written by an AI agent. That is simply how things
are in 2026+, and nobody is thought less of for it — but it does change what a patch is worth on
arrival, because a PR carries no sign of how much of it was checked before it was sent. A generated
patch is fluent by construction: the problem statement is confident, the commit message is
plausible, the reasoning reads well, and the tests it claims to have passed cannot be checked from
here. In a project where "correct" means *matches what AutoCAD does, on a file nobody in this
repository has ever seen*, none of that is evidence.

This is not a no-AI project — quite the opposite. AI does a lot of the work here now, and it is part
of how it still stays maintained for free by one person. What makes it work is everything around the
model rather than the model itself: a chosen model rather than whichever one is at hand, a prepared
context (the DXF specification, valuable other available DXF-related projects sources, notes on
decisions already made), a local corpus of real drawings (most are proprietary and cannot be shared)
that every change is swept across, an automated test suite with recorded expected output, tooling to
diff a measurement before and after a change — and a maintainer who reads every line before it lands
and is answerable for it.

So the bar is not "no AI". The bar is evidence, and it is the same for everyone:

 * Please say if a change was written with AI. It is not a problem, and it saves guesswork.
 * Say what you actually verified, and how. *"Opened these three drawings, the fill is right now,
   console clean"* is worth more than any amount of explanation.
 * Attach the file. A drawing that reproduces the bug is the part of a report that cannot be
   invented, and it is the part this project most needs.

If you would rather not do the verification, that is completely fine — open an issue with the
drawing instead. It is genuinely the more useful thing to receive. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

This project is licensed under the terms of the
[Mozilla Public License 2.0](https://choosealicense.com/licenses/mpl-2.0/).

## Donations

Want to say thanks to the project maintainer? Here is the link: [![Sponsor](https://img.shields.io/static/v1?label=Sponsor&message=GitHub&color=ea4aaa&logo=githubsponsors)](https://github.com/sponsors/vagran)

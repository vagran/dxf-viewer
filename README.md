# DXF viewer [![npm](https://img.shields.io/npm/v/dxf-viewer)](https://www.npmjs.com/package/dxf-viewer)

*If you just need to view your DXF, [click here](https://vagran.github.io/dxf-viewer-example/).*

This package provides DXF 2D viewer component written in JavaScript. It renders drawings using WebGL
(via [three.js](https://threejs.org) library). It was carefully crafted with performance in mind,
intended for drawing huge real-world files without performance problems.

The usage example is available here: https://github.com/vagran/dxf-viewer-example-src

Deployed demo: https://vagran.github.io/dxf-viewer-example/

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

## Contributing

Please refer to the [contribution guidelines](CONTRIBUTING.md) for details on how to make pull
requests (PRs). The project also requires various example files for testing purposes. If you
encounter any issues with DXF rendering, it would be greatly appreciated if you could provide an
example file that demonstrates the problem by attaching it to a created issue. Creating minimal
examples in CAD software can also be very helpful. Additionally, creating examples in various
proprietary CAD software to which I do not have access would be highly valuable. Since the entrance
level to start coding in this project is quite high, it is often more useful to receive a detailed
issue report with sample files rather than a pull request.

## License

This project is licensed under the terms of the
[Mozilla Public License 2.0](https://choosealicense.com/licenses/mpl-2.0/).

## Donations

Want to say thanks to the project maintainer? Here is the link: [![Donate](https://img.shields.io/static/v1?label=Donate&message=PayPal&color=orange&logo=paypal)](https://www.paypal.com/donate?business=artyom.lebedev@gmail.com&no_recurring=0&item_name=To+support+`dxf-viewer`+project+maintenance.+Thank+you!&currency_code=EUR)

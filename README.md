# DXF viewer

This package provides DXF 2D viewer component written in JavaScript. It renders drawings using WebGL 
(via [three.js](https://threejs.org) library). It was carefully crafted with performance in mind, 
intended for drawing huge real-world files without performance problems.

The usage example is available here: https://github.com/vagran/dxf-viewer-example-src

Deployed demo: https://vagran.github.io/dxf-viewer-example/

The package is released under the Mozilla Public License 2.0.

This is community version of the viewer. It is initially published in the
[corporate repository](https://github.com/ugcs/ugcs-dxf-viewer) and is used in production in
[Atlas](https://atlas.ugcs.com) project. There it will be mostly maintained for project-specific 
needs. The community version will receive all generic features and bug fixes.

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
time. Anything useful implemented in the corporate repository will be merged here as well.

 * Stream parsing for input file. Currently, mostly relying on dxf-parser package which is not
   stream parser and thus buffers whole the file before parsing. This prevents from supporting big
   DXF file (above gigabyte) due to string size limit in JS engine (also making unnecessary memory
   waste for the buffer).
 * Text styling. Currently, text rendering is using just the specified fonts in the specified order.
   DXF style and font attributes are ignored. Text glyphs are always rendered infilled.
 * [Special characters](https://knowledge.autodesk.com/support/autocad/learn-explore/caas/CloudHelp/cloudhelp/2019/ENU/AutoCAD-Core/files/GUID-518E1A9D-398C-4A8A-AC32-2D85590CDBE1-htm.html) in text.
 * Advanced formatting support for MTEXT (fonts, coloring, stacking).
 * Line patterns - all lines are rendered in continuous style for now. I am going to use 1-D texture
   generated on preparation stage, texture coordinates (which should account pattern continuity flag
   in DXF vertices attributes), and a dedicated shader to implement this feature.
 * Line patterns with shapes (e.g. with circles).
 * Wide lines. Currently, all lines are rendered as thin lines. Physical width is not implemented.
 * Variable width lines (i.e. with start and end width specified).
 * Smoothed polyline (curve-fit/spline-fit addition vertices).
 * Hatching
 * Infilled polygons - everything is drawn with outlines now.
 * Projected 3D mesh rendering (3DFACE entities).
 * Block instancing in a grid. Grid attributes are ignored now.
 * Dimensions
 * Leaders
 * Non-UTF-8 file encoding support. Currently, such files are displayed incorrectly. `$DWGCODEPAGE`
   parameter is ignored.
 * Full OCS support. Currently, it is assumed that entity extrusion direction is either +Z or -Z 
   (which is commonly used for features mirroring in CAD). Arbitrary directions is not properly
   processed.
 * Many less commonly used DXF features.

![samples](https://user-images.githubusercontent.com/6065976/143092164-cced2f5f-1af3-42a4-9a71-5dba68df06e7.png)

It is a fork of https://github.com/gdsestimating/dxf-parser. We need it to make some improvements
over the original code:
 * Support additional DXF groups.
 * Stream parsing - parse text as it is fetched without buffering. This allows parsing huge files
   with limited memory consumption.
 * Result filtering - do not include data which is not needed on further processing steps, filtering
   it on-the-fly, thus minimizing memory consumption even more.
 * Additional features support (e.g. hatching).

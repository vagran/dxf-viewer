import * as three from "three"
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls"
import {BatchingKey} from "./BatchingKey"
import {DxfWorker} from "./DxfWorker"
import {MaterialKey} from "./MaterialKey";


/** The representation class for the viewer, based on Three.js WebGL renderer. */
export class DxfViewer {

    /** @param domContainer Container element to create the canvas in. Usually empty div.
     * @param options Some options can be overridden if specified. See DxfViewer.DefaultOptions.
     */
    constructor(domContainer, options = null) {
        this.domContainer = domContainer
        this.options = Object.create(DxfViewer.DefaultOptions)
        if (options) {
            Object.assign(this.options, options)
        }
        options = this.options

        this.clearColor = this.options.clearColor.getHex()

        const scene = this.scene = new three.Scene()
        const renderer = this.renderer = new three.WebGLRenderer({
            alpha: options.canvasAlpha,
            premultipliedAlpha: options.canvasPremultipliedAlpha,
            antialias: options.antialias,
            depth: false
        })
        const camera = this.camera = new three.OrthographicCamera(-1, 1, 1, -1, 0.1, 2);
        camera.position.z = 1
        camera.position.x = 0
        camera.position.y = 0

        this.simpleColorMaterial = this._CreateSimpleColorMaterial()
        this.simpleInstancedColorMaterial = this._CreateSimpleColorMaterial(true)
        this.simplePointMaterial = this._CreateSimplePointMaterial()
        this.simpleInstancedPointMaterial = this._CreateSimplePointMaterial(true)

        //XXX auto resize not implemented
        this.canvasWidth = options.canvasWidth
        this.canvasHeight = options.canvasHeight
        renderer.setSize(this.canvasWidth, this.canvasHeight)
        renderer.setClearColor(options.clearColor, options.clearAlpha)

        this.canvas = renderer.domElement
        this.canvas.getContext("webgl", { premultipliedAlpha: false })
        domContainer.style.display = "block"
        domContainer.appendChild(renderer.domElement)

        //XXX
        // {
        //     const shape = new three.Shape([new three.Vector2(0, 0),
        //                                    new three.Vector2(1, 0),
        //                                    new three.Vector2(0, 1)])
        //
        //     const geometry = new three.ShapeGeometry(shape)
        //     const material = new three.MeshBasicMaterial({color: 0x00ff00})
        //     const mesh = new three.Mesh(geometry, material)
        //     scene.add(mesh)
        // }

        //XXX
        // {
        //     const _verticesArray = new Float32Array([5,5,5,5, 0, 0, 1, 1, 0, -1, -1, 0])
        //     const verticesArray = new Float32Array(_verticesArray.buffer, 4 * 4, 8)
        //     const verticesBufferAttr = new three.BufferAttribute(verticesArray, 2)
        //     const geometry = new three.BufferGeometry()
        //     geometry.setAttribute("position", verticesBufferAttr)
        //     const material = this._CreateSimpleColorMaterialInstance(0xff0000)
        //     const obj = new three.LineSegments(geometry, material)
        //     obj.frustumCulled = false
        //     scene.add(obj)
        // }

        //XXX
        // {
        //     const _verticesArray = new Float32Array([5,5,5,5, 0, 0, 1, 1, 0, -1, -1, 0])
        //     const verticesArray = new Float32Array(_verticesArray.buffer, 4 * 4, 8)
        //     const verticesBufferAttr = new three.BufferAttribute(verticesArray, 2)
        //     const geometry = new three.BufferGeometry()
        //     geometry.setAttribute("position", verticesBufferAttr)
        //     const material = this._CreateSimplePointMaterialInstance(0xff0000, 10)
        //     const obj = new three.Points(geometry, material)
        //     obj.frustumCulled = false
        //     scene.add(obj)
        // }

        //XXX
        // {
        //     const _verticesArray = new Float32Array([5,5,5,5, 0, 0, 1, 1, 0, -1, -1, 0])
        //     const _indicesArray = new Uint16Array([0, 0, 0, 1, 2, 3])
        //     const verticesArray = new Float32Array(_verticesArray.buffer, 4 * 4, 8)
        //     const verticesBufferAttr = new three.BufferAttribute(verticesArray, 2)
        //     const indicesArray = new Uint16Array(_indicesArray.buffer, 2 * 2, 4)
        //     const indicesBufferAttr = new three.BufferAttribute(indicesArray, 1)
        //     const geometry = new three.BufferGeometry()
        //     geometry.setAttribute("position", verticesBufferAttr)
        //     geometry.setIndex(indicesBufferAttr)
        //     const material = this._CreateSimpleColorMaterialInstance(0xff0000)
        //     const obj = new three.LineSegments(geometry, material)
        //     obj.frustumCulled = false
        //     scene.add(obj)
        // }

        //XXX
        // {
        //     const _verticesArray = new Float32Array([5,5,5,5, 0, 0.5, 1, 1, 0, -1, -1, 0])
        //     const verticesArray = new Float32Array(_verticesArray.buffer, 4 * 4, 8)
        //     const verticesBufferAttr = new three.BufferAttribute(verticesArray, 2)
        //     const _transformArray = new Float32Array([
        //         0, 0, 0, 0, 0, 0,
        //         1, 0, 0,  0, 1, 0,
        //         1, 0, 0.5,  0, 1, -0.2,
        //         0.5, 0, 0,  0, 0.5, 0])
        //     const transformArray = new Float32Array(_transformArray.buffer, 6 * 4, 18)
        //     const transformBufferAttrBuf = new three.InstancedInterleavedBuffer(transformArray, 6)
        //     const transformBufferAttr0 = new three.InterleavedBufferAttribute(
        //         transformBufferAttrBuf, 3, 0)
        //     const transformBufferAttr1 = new three.InterleavedBufferAttribute(
        //         transformBufferAttrBuf, 3, 3)
        //     const geometry = new three.InstancedBufferGeometry()
        //     geometry.instanceCount = 3
        //     geometry.setAttribute("position", verticesBufferAttr)
        //     geometry.setAttribute("instanceTransform0", transformBufferAttr0)
        //     geometry.setAttribute("instanceTransform1", transformBufferAttr1)
        //     const material = this._CreateSimpleColorMaterialInstance(0xff0000, true)
        //     const obj = new three.LineSegments(geometry, material)
        //     obj.frustumCulled = false
        //     scene.add(obj)
        // }

        const controls = this.controls = new OrbitControls(camera, renderer.domElement)
        controls.enableRotate = false
        controls.mouseButtons = {
            LEFT: three.MOUSE.PAN
        }
        controls.zoomSpeed = 3
        controls.addEventListener("change", this.Render.bind(this))

        this.Render()

        /* Indexed by MaterialKey. */
        this.materials = new RBTree((m1, m2) => m1.key.Compare(m2.key))
        /* Indexed by layer name, value is list of layer scene objects. */
        this.layers = new Map()
    }

    GetCanvas() {
        return this.canvas
    }

    /** Load DXF into the viewer. Old content is discarded, state is reset.
     * @param url DXF file URL.
     * @param progressCbk {Function?} (phase, processedSize, totalSize)
     *  Possible phase values:
     *  * "fetch"
     *  * "parse"
     *  * "prepare"
     * @param workerFactory {Function?} Factory for worker creation. The worker script should
     *  invoke DxfViewer.SetupWorker() function.
     */
    async Load(url, progressCbk = null, workerFactory = null) {
        const worker = new DxfWorker(workerFactory ? workerFactory() : null)
        const scene = await worker.Load(url, progressCbk)
        await worker.Destroy()

        //XXX
        console.log(`${scene.batches.length} batches, vertices ${scene.vertices.byteLength} B, indices ${scene.indices.byteLength} B`)

        //XXX load blocks
        //XXX create vertices buffer attributes

        for (const batch of scene.batches) {
            this._LoadBatch(scene, batch)
        }

        this._SetView(
            {
                x: scene.bounds.minX + (scene.bounds.maxX - scene.bounds.minX) / 2 - scene.origin.x,
                y: scene.bounds.minY + (scene.bounds.maxY - scene.bounds.minY) / 2 - scene.origin.y
            },
            (scene.bounds.maxX - scene.bounds.minX) * 1.2)

        this.Render()
    }

    Render() {
        this.renderer.render(this.scene, this.camera)
    }

    /** @return {Iterable<String>} List of layer names. */
    GetLayers() {
        return this.layers.keys()
    }

    ShowLayer(name, show) {
        const layerList = this.layers.get(name)
        if (!layerList) {
            return
        }
        for (const obj of layerList) {
            obj.visible = show
        }
        this.Render()
    }

    Destroy() {
        //XXX
    }

    _LoadBatch(scene, batch) {
        if (batch.key.blockName !== null) {
            return
        }

        const objs = []

        if (batch.key.geometryType === BatchingKey.GeometryType.POINTS) {
            objs.push(this._CreatePointsBatch(scene, batch))

        } else if (batch.key.geometryType === BatchingKey.GeometryType.LINES) {
            objs.push(this._CreateLinesBatch(scene, batch))

        } else if (batch.key.geometryType === BatchingKey.GeometryType.INDEXED_LINES) {
            for (const obj of this._CreateIndexedLinesBatches(scene, batch)) {
                objs.push(obj)
            }

        } else {
            console.warn("Unhandled batch geometry type: " + batch.key.geometryType)
            return
        }

        let layerList = this.layers.get(batch.key.layerName)
        if (!layerList) {
            layerList = []
            this.layers.set(batch.key.layerName, layerList)
        }

        for (const obj of objs) {
            this.scene.add(obj)
            layerList.push(obj)
        }
    }

    _SetView(center, width) {
        const aspect = this.canvasWidth / this.canvasHeight
        const height = width / aspect
        const cam = this.camera
        cam.left = center.x - width / 2
        cam.right = center.x + width / 2
        cam.top = center.y + height / 2
        cam.bottom = center.y - height / 2
        cam.zoom = 1
        cam.updateProjectionMatrix()
    }

    _GetSimpleColorMaterial(color, isInstanced = false) {
        const key = new MaterialKey(isInstanced, null, color, 0)
        let entry = this.materials.find({key})
        if (entry !== null) {
            return entry.material
        }
        entry = {
            key,
            material: this._CreateSimpleColorMaterialInstance(color, isInstanced)
        }
        this.materials.insert(entry)
        return entry.material
    }

    _CreateSimpleColorMaterial(instanced = false) {
        const shaders = this._GenerateShaders(instanced, false)
        return new three.RawShaderMaterial({
            uniforms: {
                color: {
                    value: new three.Color(0xff00ff)
                }
            },
            vertexShader: shaders.vertex,
            fragmentShader: shaders.fragment,
            depthTest: false,
            depthWrite: false,
            glslVersion: three.GLSL3
        })
    }

    /** @param color {Number} Color RGB numeric value.
     * @param isInstanced {Boolean} Get version for instanced geometry.
     */
    _CreateSimpleColorMaterialInstance(color, isInstanced = false) {
        const src = isInstanced ? this.simpleInstancedColorMaterial : this.simpleColorMaterial
        /* Should reuse compiled shaders. */
        const m = src.clone()
        m.uniforms.color = { value: new three.Color(color) }
        return m
    }

    _GetSimplePointMaterial(color, isInstanced = false) {
        const key = new MaterialKey(isInstanced, BatchingKey.GeometryType.POINTS, color, 0)
        let entry = this.materials.find({key})
        if (entry !== null) {
            return entry.material
        }
        entry = {
            key,
            material: this._CreateSimplePointMaterialInstance(color, this.options.pointSize,
                                                              isInstanced)
        }
        this.materials.insert(entry)
        return entry.material
    }

    _CreateSimplePointMaterial(isInstanced = false) {
        const shaders = this._GenerateShaders(isInstanced, true)
        return new three.RawShaderMaterial({
            uniforms: {
                color: {
                    value: new three.Color(0xff00ff)
                },
                pointSize: {
                    value: 2
                }
            },
            vertexShader: shaders.vertex,
            fragmentShader: shaders.fragment,
            depthTest: false,
            depthWrite: false,
            glslVersion: three.GLSL3
        })
    }

    /** @param color {Number} Color RGB numeric value.
     * @param size {Number} Rasterized point size in pixels.
     * @param isInstanced {Boolean} Create material for instanced drawing.
     */
    _CreateSimplePointMaterialInstance(color, size = 2, isInstanced = false) {
        const src = isInstanced ? this.simpleInstancedPointMaterial : this.simplePointMaterial
        /* Should reuse compiled shaders. */
        const m = src.clone()
        m.uniforms.color = { value: new three.Color(color) }
        m.uniforms.size = { value: size }
        return m
    }

    _GenerateShaders(isInstanced, pointSize) {
        const instanceAttr = isInstanced ?
            `
            /* First row. */
            in vec3 instanceTransform0;
            /* Second row. */
            in vec3 instanceTransform1;
            ` : ""
        const instanceTransform = isInstanced ?
            `  
            pos.xy = mat2(instanceTransform0[0], instanceTransform1[0],
                          instanceTransform0[1], instanceTransform1[1]) * pos.xy + 
                     vec2(instanceTransform0[2], instanceTransform1[2]);
            ` : ""
        const pointSizeUniform = pointSize ? "uniform float pointSize;" : ""
        const pointSizeAssigment = pointSize ? "gl_PointSize = pointSize;" : ""

        return {
            vertex: `
           
            precision highp float;
            precision highp int;
            in vec2 position;
            ${instanceAttr}
            uniform mat4 modelViewMatrix;
            uniform mat4 projectionMatrix;
            ${pointSizeUniform}
            
            void main() {
                vec4 pos = vec4(position, 0.0, 1.0);
                ${instanceTransform}
                gl_Position = projectionMatrix * modelViewMatrix * pos;
                ${pointSizeAssigment}
            }
            `,
            fragment: `
            
            precision highp float;
            precision highp int;
            uniform vec3 color;
            out vec4 fragColor;
            
            void main() {
                fragColor = vec4(color, 1.0);
            }
            `
        }
    }

    _CreatePointsBatch(scene, batch) {
        const verticesArray =
            new Float32Array(scene.vertices,
                             batch.verticesOffset * Float32Array.BYTES_PER_ELEMENT,
                             batch.verticesCount)
        const verticesBufferAttr = new three.BufferAttribute(verticesArray, 2)
        const geometry = new three.BufferGeometry()
        geometry.setAttribute("position", verticesBufferAttr)
        const material = this._GetSimplePointMaterial(this._TransformColor(batch.key.color))
        const obj = new three.Points(geometry, material)
        obj.frustumCulled = false
        return obj
    }

    _CreateLinesBatch(scene, batch) {
        const verticesArray =
            new Float32Array(scene.vertices,
                             batch.verticesOffset * Float32Array.BYTES_PER_ELEMENT,
                             batch.verticesCount)
        const verticesBufferAttr = new three.BufferAttribute(verticesArray, 2)
        const geometry = new three.BufferGeometry()
        geometry.setAttribute("position", verticesBufferAttr)
        //XXX line type
        const material = this._GetSimpleColorMaterial(this._TransformColor(batch.key.color))
        const obj = new three.LineSegments(geometry, material)
        obj.frustumCulled = false
        return obj
    }

    /** One rendering batch per each indexed chunk. */
    *_CreateIndexedLinesBatches(scene, batch) {
        //XXX line type
        const material = this._GetSimpleColorMaterial(this._TransformColor(batch.key.color))
        for (const chunk of batch.chunks) {
            const verticesArray =
                new Float32Array(scene.vertices,
                                 chunk.verticesOffset * Float32Array.BYTES_PER_ELEMENT,
                                 chunk.verticesCount)
            const indicesArray =
                new Uint16Array(scene.indices,
                                chunk.indicesOffset * Uint16Array.BYTES_PER_ELEMENT,
                                chunk.indicesCount)
            const verticesBufferAttr = new three.BufferAttribute(verticesArray, 2)
            const indicesBufferAttr = new three.BufferAttribute(indicesArray, 1)
            const geometry = new three.BufferGeometry()
            geometry.setAttribute("position", verticesBufferAttr)
            geometry.setIndex(indicesBufferAttr)
            const obj = new three.LineSegments(geometry, material)
            obj.frustumCulled = false
            yield obj
        }
    }

    /** Ensure the color is contrast enough with current background color.
     * @param color {number} RGB value.
     * @return {number} RGB value to use for rendering.
     */
    _TransformColor(color) {
        if (!this.options.colorCorrection && !this.options.blackWhiteInversion) {
            return color
        }
        if (!this.options.colorCorrection) {
            /* Just black and white inversion. */
            const bkgLum = Luminance(this.clearColor)
            if (color === 0xffffff && bkgLum >= 0.8) {
                return 0
            }
            if (color === 0 && bkgLum <= 0.2) {
                return 0xffffff
            }
            return color
        }
        //XXX not implemented
        // const MIN_TARGET_RATIO = 1.5
        // const contrast = ContrastRatio(color, this.clearColor)
        // const diff = contrast >= 1 ? contrast : 1 / contrast
        // if (diff < MIN_TARGET_RATIO) {
        // }
        return color
    }
}

DxfViewer.DefaultOptions = {
    canvasWidth: 400,
    canvasHeight: 300,
    /** Automatically resize canvas when the container is resized. This options
     *  utilizes ResizeObserver API which still not fully standardized. The specified canvas size is
     *  ignored if the option enabled.
     */
    autoResize: false,
    /** Frame buffer clear color. */
    clearColor: new three.Color("#000"),
    /** Frame buffer clear color alpha value. */
    clearAlpha: 1.0,
    /** Use alpha channel in a framebuffer. */
    canvasAlpha: false,
    /** Assume premultiplied alpha in a framebuffer. */
    canvasPremultipliedAlpha: true,
    /** Use antialiasing. May degrade performance on poor hardware. */
    antialias: true,
    /** Correct entities colors to ensure that they are always visible with the current background
     * color.
     */
    colorCorrection: false,
    /** Simpler version of colorCorrection - just invert pure white or black entities if they are
     * invisible on current background color.
     */
    blackWhiteInversion: true,
    /** Size in pixels for rasterized points. */
    pointSize: 2,
}

DxfViewer.SetupWorker = function () {
    new DxfWorker(self, true)
}

/** Transform sRGB color component to linear color space. */
function LinearColor(c) {
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Transform linear color component to sRGB color space. */
function SRgbColor(c) {
    return c < 0.003 ? c * 12.92 : Math.pow(c, 1 / 2.4) * 1.055 - 0.055
}

/** Get relative luminance value for a color.
 * https://www.w3.org/TR/2008/REC-WCAG20-20081211/#relativeluminancedef
 * @param color {number} RGB color value.
 * @return {number} Luminance value in range [0; 1].
 */
function Luminance(color) {
    const r = LinearColor(((color & 0xff0000) >>> 16) / 255)
    const g = LinearColor(((color & 0xff00) >>> 8) / 255)
    const b = LinearColor((color & 0xff) / 255)

    return r * 0.2126 + g * 0.7152 + b * 0.0722
}

/**
 * Get contrast ratio for a color pair.
 * https://www.w3.org/TR/2008/REC-WCAG20-20081211/#contrast-ratiodef
 * @param c1
 * @param c2
 * @return {number} Contrast ratio between the colors. Greater than one if the first color color is
 *  brighter than the second one.
 */
function ContrastRatio(c1, c2) {
    return (Luminance(c1) + 0.05) / (Luminance(c2) + 0.05)
}

function HlsToRgb({h, l, s}) {
    let r, g, b
    if (s === 0) {
        /* Achromatic */
        r = g = b = l
    } else {
        function hue2rgb(p, q, t) {
            if (t < 0) {
                t += 1
            }
            if (t > 1) {
                t -= 1
            }
            if (t < 1/6) {
                return p + (q - p) * 6 * t
            }
            if (t < 1/2) {
                return q
            }
            if (t < 2/3) {
                return p + (q - p) * (2/3 - t) * 6
            }
            return p
        }

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s
        const p = 2 * l - q
        r = hue2rgb(p, q, h + 1/3)
        g = hue2rgb(p, q, h)
        b = hue2rgb(p, q, h - 1/3)
    }

    return (Math.min(Math.floor(SRgbColor(r) * 256), 255) << 16) |
           (Math.min(Math.floor(SRgbColor(g) * 256), 255) << 8) |
            Math.min(Math.floor(SRgbColor(b) * 256), 255)
}

function RgbToHls(color) {
    const r = LinearColor(((color & 0xff0000) >>> 16) / 255)
    const g = LinearColor(((color & 0xff00) >>> 8) / 255)
    const b = LinearColor((color & 0xff) / 255)

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    let h, s
    const l = (max + min) / 2

    if (max === min) {
        /* Achromatic */
        h = s = 0
    } else {
        const d = max - min
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
        switch (max) {
        case r:
            h = (g - b) / d + (g < b ? 6 : 0)
            break;
        case g:
            h = (b - r) / d + 2
            break
        case b:
            h = (r - g) / d + 4
            break
        }
        h /= 6
    }

    return {h, l, s}
}

function Lighten(color, factor) {
    const hls = RgbToHls(color)
    hls.l *= factor
    if (hls.l > 1) {
        hls.l = 1
    }
    return HlsToRgb(hls)
}

function Darken(color, factor) {
    const hls = RgbToHls(color)
    hls.l /= factor
    return HlsToRgb(hls)
}

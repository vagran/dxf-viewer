import * as three from "three"
import {BatchingKey} from "./BatchingKey.js"
import {TransformColor} from "./ColorTransform.js"
import {DxfWorker} from "./DxfWorker.js"
import {MaterialKey} from "./MaterialKey.js"
import {ColorCode, DxfScene} from "./DxfScene.js"
import {OrbitControls} from "./OrbitControls.js"
import {RBTree} from "./RBTree.js"


/** Level in "message" events, published as `DxfViewer.MessageLevel`.
 * @property {string} INFO Informational, nothing is wrong.
 * @property {string} WARN The drawing loaded but something in it was not rendered as authored.
 * @property {string} ERROR The drawing could not be loaded.
 */
const MessageLevel = Object.freeze({
    INFO: "info",
    WARN: "warn",
    ERROR: "error"
})

/** One layer of the loaded drawing, as `GetLayers()` reports it.
 * @typedef {object} LayerInfo
 * @property {string} name Layer name as the drawing spells it. This is what `ShowLayer()` takes.
 * @property {string} displayName Name to show in a user interface.
 * @property {number} color Layer color as an RGB value, after correction against the background.
 * @property {boolean} visible Whether the layer is currently shown. It starts out false for a
 *      layer the drawing has switched off, and follows `ShowLayer()` afterwards.
 */

/** Model-space bounding box of the loaded drawing, in the drawing's own coordinates rather than
 * the scene's — `GetOrigin()` is not subtracted.
 * @typedef {object} Bounds
 * @property {number} minX
 * @property {number} maxX
 * @property {number} minY
 * @property {number} maxY
 */


/** The representation class for the viewer, based on Three.js WebGL renderer. */
export class DxfViewer {

    /**
     * @param {HTMLElement} domContainer Container element to create the canvas in. Usually empty
     *  div. Should not have padding if auto-resize feature is used.
     * @param {?object} options Overrides for any of the defaults. See
     *  {@link DxfViewer.DefaultOptions} for the full set and what each one does.
     */
    constructor(domContainer, options = null) {
        this.domContainer = domContainer
        this.options = Object.create(DxfViewer.DefaultOptions)
        if (options) {
            Object.assign(this.options, options)
        }
        options = this.options

        this.clearColor = this.options.clearColor.getHex()

        this.scene = new three.Scene()

        this.ownsRenderer = !options.renderer
        this.renderer = options.renderer

        if (!this.renderer) {
            try {
                this.renderer = new three.WebGLRenderer({
                   alpha: options.canvasAlpha,
                   premultipliedAlpha: options.canvasPremultipliedAlpha,
                   antialias: options.antialias,
                   depth: false,
                   preserveDrawingBuffer: options.preserveDrawingBuffer
                })
            } catch (e) {
                console.log("Failed to create renderer: " + e)
                this.renderer = null
                return
            }
        }
        const renderer = this.renderer
        /* Prevent bounding spheres calculations which fails due to non-conventional geometry
         * buffers layout. Also do not waste CPU on sorting which we do not need anyway.
         */
        renderer.sortObjects = false
        renderer.setPixelRatio(window.devicePixelRatio)

        const camera = this.camera = new three.OrthographicCamera(-1, 1, 1, -1, 0.1, 2)
        camera.position.z = 1
        camera.position.x = 0
        camera.position.y = 0

        /* Whether the shaders have to encode their output to the renderer's color space.
         *
         * `three.Color` keeps a color in the working color space, which with color management
         * enabled (the default) means linear-sRGB, and three converts it back to sRGB when writing
         * the fragment - but only in the shaders it generates itself. A RawShaderMaterial gets no
         * such conversion injected, and without it every mid tone is written as a linear value into
         * an sRGB canvas and displayed darker than the drawing asks for (white, black and fully
         * saturated colors are the fixed points that hid this).
         */
        this.convertToSrgb = three.ColorManagement.enabled &&
                             renderer.outputColorSpace === three.SRGBColorSpace

        this.simpleColorMaterial = []
        this.simplePointMaterial = []
        for (let i = 0; i < InstanceType.MAX; i++) {
            this.simpleColorMaterial[i] = this._CreateSimpleColorMaterial(i)
            this.simplePointMaterial[i] = this._CreateSimplePointMaterial(i)
        }

        renderer.setClearColor(options.clearColor, options.clearAlpha)

        if (options.autoResize) {
            this.canvasWidth = domContainer.clientWidth
            this.canvasHeight = domContainer.clientHeight
            domContainer.style.position = "relative"
        } else {
            this.canvasWidth = options.canvasWidth
            this.canvasHeight = options.canvasHeight
            this.resizeObserver = null
        }
        renderer.setSize(this.canvasWidth, this.canvasHeight)

        this.canvas = renderer.domElement
        domContainer.style.display = "block"
        if (options.autoResize) {
            this.canvas.style.position = "absolute"
            this.resizeObserver = new ResizeObserver(entries => this._OnResize(entries[0]))
            this.resizeObserver.observe(domContainer)
        }
        domContainer.appendChild(this.canvas)

        this.canvas.addEventListener("pointerdown", this._OnPointerEvent.bind(this))
        this.canvas.addEventListener("pointerup", this._OnPointerEvent.bind(this))

        this.Render()

        /* Indexed by MaterialKey, value is {key, material}. */
        this.materials = new RBTree((m1, m2) => m1.key.Compare(m2.key))
        /* Indexed by layer name, value is Layer instance. */
        this.layers = new Map()
        /* Default layer used when no layer specified. */
        this.defaultLayer = null
        /* Indexed by block name, value is Block instance. */
        this.blocks = new Map()

        /** Set during data loading.
         * @private
         */
        this.worker = null
    }

    /**
     * @returns {boolean} True if renderer exists. May be false in case when WebGL context is lost
     * (e.g. after wake up from sleep). In such case page should be reloaded.
     */
    HasRenderer() {
        return Boolean(this.renderer)
    }

    /**
     * @returns {three.WebGLRenderer | null} Returns the created Three.js renderer.
     */
    GetRenderer() {
        return this.renderer
    }

    /** @returns {HTMLCanvasElement} The canvas the viewer renders into. */
    GetCanvas() {
        return this.canvas
    }

    /** @returns {?object} The parsed document. Retained only when the `retainParsedDxf` option
     *  is set, null otherwise.
     */
    GetDxf() {
        return this.parsedDxf
    }

    /** Resize the canvas, keeping the current view centre and scale.
     * @param {number} width New canvas width in pixels.
     * @param {number} height New canvas height in pixels.
     */
    SetSize(width, height) {
        this._EnsureRenderer()

        const hScale = width / this.canvasWidth
        const vScale = height / this.canvasHeight

        const cam = this.camera
        const centerX = (cam.left + cam.right) / 2
        const centerY = (cam.bottom + cam.top) / 2
        const camWidth = cam.right - cam.left
        const camHeight = cam.top - cam.bottom
        cam.left = centerX - hScale * camWidth / 2
        cam.right = centerX + hScale * camWidth / 2
        cam.bottom = centerY - vScale * camHeight / 2
        cam.top = centerY + vScale * camHeight / 2
        cam.updateProjectionMatrix()

        this.canvasWidth = width
        this.canvasHeight = height
        this.renderer.setSize(width, height)
        if (this.controls) {
            this.controls.update()
        }
        this._Emit("resized", {width, height})
        this._Emit("viewChanged")
        this.Render()
    }

    /** Load DXF into the viewer. Old content is discarded, state is reset.
     * @param {object} params
     * @param {string} params.url DXF file URL.
     * @param {?string[]} params.fonts List of font URLs. Files should have typeface.js format.
     *  Fonts are used in the specified order, each one is checked until necessary glyph is found.
     *  Text is not rendered if fonts are not specified.
     * @param {?Function} params.progressCbk (phase, processedSize, totalSize)
     *  Possible phase values:
     *  * "font"
     *  * "fetch"
     *  * "parse"
     *  * "prepare"
     * @param {?Function} params.workerFactory Factory for worker creation. The worker script
     *  should invoke DxfViewer.SetupWorker() function.
     * @returns {Promise} Resolves once the drawing is loaded and first rendered. Rejects if the
     *  file cannot be fetched or parsed.
     */
    async Load({url, fonts = null, progressCbk = null, workerFactory = null}) {
        if (url === null || url === undefined) {
            throw new Error("`url` parameter is not specified")
        }

        this._EnsureRenderer()

        this.Clear()

        this.worker = new DxfWorker(workerFactory ? workerFactory() : null)
        const {scene, dxf} = await this.worker.Load(url, fonts, this.options, progressCbk)
        await this.worker.Destroy()
        this.worker = null
        this.parsedDxf = dxf

        this.origin = scene.origin
        this.bounds = scene.bounds
        this.hasMissingChars = scene.hasMissingChars

        for (const layer of scene.layers) {
            this.layers.set(layer.name,
                            new Layer(layer.name, layer.displayName, layer.color, layer.visible))
        }
        this.defaultLayer = this.layers.get("0") ?? new Layer("0", "0", 0, true)

        /* Load all blocks on the first pass. */
        for (const batch of scene.batches) {
            if (batch.key.blockName !== null &&
                batch.key.geometryType !== BatchingKey.GeometryType.BLOCK_INSTANCE &&
                batch.key.geometryType !== BatchingKey.GeometryType.POINT_INSTANCE) {

                let block = this.blocks.get(batch.key.blockName)
                if (!block) {
                    block = new Block()
                    this.blocks.set(batch.key.blockName, block)
                }
                block.PushBatch(new Batch(this, scene, batch))
            }
        }

        console.log(`DXF scene:
                     ${scene.batches.length} batches,
                     ${this.layers.size} layers,
                     ${this.blocks.size} blocks,
                     vertices ${scene.vertices.byteLength} B,
                     indices ${scene.indices.byteLength} B
                     transforms ${scene.transforms.byteLength} B`)

        /* Instantiate all entities. */
        for (const batch of scene.batches) {
            this._LoadBatch(scene, batch)
        }

        this._Emit("loaded")

        if (scene.bounds) {
            this.FitView(scene.bounds.minX - scene.origin.x, scene.bounds.maxX - scene.origin.x,
                         scene.bounds.minY - scene.origin.y, scene.bounds.maxY - scene.origin.y)
        } else {
            this._Message("Empty document", MessageLevel.WARN)
        }

        if (this.hasMissingChars) {
            this._Message("Some characters cannot be properly displayed due to missing fonts",
                          MessageLevel.WARN)
        }

        this._CreateControls()
        this.Render()
    }

    /** Draw the current scene into the canvas. The viewer renders on its own whenever the view
     *  or the layer visibility changes, so this is only needed after modifying the scene
     *  returned by GetScene().
     */
    Render() {
        this._EnsureRenderer()
        this.renderer.render(this.scene, this.camera)
    }

    /** @param {boolean} nonEmptyOnly Skip layers which carry no geometry.
     * @returns {Iterable<LayerInfo>} The drawing's layers, in the order the file defines them.
     */
    GetLayers(nonEmptyOnly = false) {
        const result = []
        for (const lyr of this.layers.values()) {
            if (nonEmptyOnly && lyr.objects.length == 0) {
                continue
            }
            result.push({
                name: lyr.name,
                displayName: lyr.displayName,
                color: this._TransformColor(lyr.color),
                visible: lyr.visible
            })
        }
        return result
    }

    /** Show or hide a layer. Does nothing if no such layer is present in the drawing.
     * @param {string} name Layer name, as GetLayers() reports it.
     * @param {boolean} show True to show the layer, false to hide it.
     */
    ShowLayer(name, show) {
        this._EnsureRenderer()
        const layer = this.layers.get(name)
        if (!layer) {
            return
        }
        layer.visible = show
        for (const obj of layer.objects) {
            obj.visible = show
        }
        this.Render()
    }

    /** Change the frame buffer clear color. Unlike the `clearColor` option of the same name, this
     *  takes effect immediately: the already loaded scene is re-rendered with the new background
     *  and the entity colors are corrected against it again. Safe to call before anything is
     *  loaded, where it only establishes the background color.
     *
     * @param {number|string|three.Color} color New clear color. The alpha value is not changed, see
     *      the `clearAlpha` option.
     */
    SetClearColor(color) {
        this._EnsureRenderer()

        const clearColor = color instanceof three.Color ? color : new three.Color(color)
        /* Assigned, not mutated in place: `options` is created with DxfViewer.DefaultOptions as its
         * prototype, so the value here is the shared default until an own property shadows it.
         */
        this.options.clearColor = clearColor
        this.clearColor = clearColor.getHex()
        this.renderer.setClearColor(clearColor, this.options.clearAlpha)

        /* The material cache is keyed by the color as the drawing specifies it, so the correction
         * can be recomputed for the new background. Only uniform values change - no shader is
         * recompiled and no object is rebuilt.
         */
        this.materials.each(entry =>
            entry.material.uniforms.color.value.setHex(this._TransformColor(entry.key.color)))

        this.Render()
    }

    /** Reset the viewer state. */
    Clear() {
        this._EnsureRenderer()
        if (this.worker) {
            this.worker.Destroy(true)
            this.worker = null
        }
        if (this.controls) {
            this.controls.dispose()
            this.controls = null
        }
        this.scene.clear()
        for (const layer of this.layers.values()) {
            layer.Dispose()
        }
        this.layers.clear()
        this.blocks.clear()
        this.materials.each(e => e.material.dispose())
        this.materials.clear()
        this.SetView({x: 0, y: 0}, 2)
        this._Emit("cleared")
        this.Render()
    }

    /** Free all resources. The viewer object should not be used after this method was called. */
    Destroy() {
        if (!this.HasRenderer()) {
            return
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect()
        }
        this.Clear()
        this._Emit("destroyed")
        for (const m of this.simplePointMaterial) {
            m.dispose()
        }
        for (const m of this.simpleColorMaterial) {
            m.dispose()
        }
        this.simplePointMaterial = null
        this.simpleColorMaterial = null
        if (this.ownsRenderer) {
            this.renderer.dispose()
        }
        this.renderer = null
    }

    /** Set the view to a centre point and a width, the height following from the canvas aspect
     *  ratio.
     * @param {three.Vector3} center View centre in scene coordinates. Only X and Y are used.
     * @param {number} width View width in scene coordinates.
     */
    SetView(center, width) {
        const aspect = this.canvasWidth / this.canvasHeight
        const height = width / aspect
        const cam = this.camera
        cam.left = -width / 2
        cam.right = width / 2
        cam.top = height / 2
        cam.bottom = -height / 2
        cam.zoom = 1
        cam.position.set(center.x, center.y, 1)
        cam.rotation.set(0, 0, 0)
        cam.updateMatrix()
        cam.updateProjectionMatrix()
        if (this.controls) {
            this.controls.target.set(cam.position.x, cam.position.y, 0)
            this.controls.update()
        }
        this._Emit("viewChanged")
    }

    /** Set view to fit the specified bounds.
     * @param {number} minX Left edge of the area to fit, in scene coordinates.
     * @param {number} maxX Right edge.
     * @param {number} minY Bottom edge.
     * @param {number} maxY Top edge.
     * @param {number} padding Fraction of the fitted size to leave as a margin.
     */
    FitView(minX, maxX, minY, maxY, padding = 0.1) {
        const aspect = this.canvasWidth / this.canvasHeight
        let width = maxX - minX
        const height = maxY - minY
        const center = {x: minX + width / 2, y: minY + height / 2}
        if (height * aspect > width) {
            width = height * aspect
        }
        if (width <= Number.MIN_VALUE * 2) {
            width = 1
        }
        this.SetView(center, width * (1 + padding))
    }

    /** @returns {three.Scene} three.js scene for the viewer. Can be used to add custom entities
     *      on the scene. Remember to apply scene origin available via GetOrigin() method.
     */
    GetScene() {
        return this.scene
    }

    /** @returns {three.OrthographicCamera} three.js camera for the viewer. */
    GetCamera() {
        return this.camera
    }

    /** @returns {three.Vector2} Scene origin in global drawing coordinates. */
    GetOrigin() {
        return this.origin
    }

    /** @returns {?Bounds} Bounds of the loaded drawing, null if the scene is empty. */
    GetBounds() {
        return this.bounds
    }

    /** Subscribe to the specified event. The following events are defined:
     *  * "loaded" - new scene loaded.
     *  * "cleared" - current scene cleared.
     *  * "destroyed" - viewer instance destroyed.
     *  * "resized" - viewport size changed. Details: {width, height}
     *  * "pointerdown" - Details: {domEvent, position:{x,y}}, position is in scene coordinates.
     *  * "pointerup"
     *  * "viewChanged"
     *  * "message" - Some message from the viewer. {message: string, level: string}.
     *
     * @param {string} eventName One of the names above, unprefixed.
     * @param {function} eventHandler Accepts event object.
     */
    Subscribe(eventName, eventHandler) {
        this._EnsureRenderer()
        this.canvas.addEventListener(EVENT_NAME_PREFIX + eventName, eventHandler)
    }

    /** Unsubscribe from previously subscribed event. The arguments should match previous
     * Subscribe() call.
     *
     * @param {string} eventName The name passed to Subscribe().
     * @param {function} eventHandler The handler passed to Subscribe().
     */
    Unsubscribe(eventName, eventHandler) {
        this._EnsureRenderer()
        this.canvas.removeEventListener(EVENT_NAME_PREFIX + eventName, eventHandler)
    }

    // /////////////////////////////////////////////////////////////////////////////////////////////

    _EnsureRenderer() {
        if (!this.HasRenderer()) {
            throw new Error("WebGL renderer not available. " +
                            "Probable WebGL context loss, try refreshing the page.")
        }
    }

    _CreateControls() {
        if (this.controls) {
            this.controls.dispose()
        }
        const controls = this.controls = new OrbitControls(this.camera, this.canvas)
        controls.enableRotate = false
        controls.mouseButtons = {
            LEFT: three.MOUSE.PAN,
            MIDDLE: three.MOUSE.DOLLY
        }
        controls.touches = {
            ONE: three.TOUCH.PAN,
            TWO: three.TOUCH.DOLLY_PAN
        }
        controls.zoomSpeed = 3
        controls.mouseZoomSpeedFactor = 0.05
        controls.target = new three.Vector3(this.camera.position.x, this.camera.position.y, 0)
        controls.addEventListener("change", () => {
            this.Render()
            this._Emit("viewChanged")
        })
        controls.update()
    }

    _Emit(eventName, data = null) {
        this.canvas.dispatchEvent(new CustomEvent(EVENT_NAME_PREFIX + eventName, {detail: data}))
    }

    _Message(message, level = MessageLevel.INFO) {
        this._Emit("message", {message, level})
    }

    _OnPointerEvent(e) {
        const canvasRect = e.target.getBoundingClientRect()
        const canvasCoord = {x: e.clientX - canvasRect.left, y: e.clientY - canvasRect.top}
        this._Emit(e.type, {
            domEvent: e,
            canvasCoord,
            position: this._CanvasToSceneCoord(canvasCoord.x, canvasCoord.y)
        })
    }

    /** @returns {{x: number, y: number}} Scene coordinate corresponding to the specified canvas
     *  pixel coordinates.
     */
    _CanvasToSceneCoord(x, y) {
        const v = new three.Vector3(x * 2 / this.canvasWidth - 1,
                                    -y * 2 / this.canvasHeight + 1,
                                    1).unproject(this.camera)
        return {x: v.x, y: v.y}
    }

    _OnResize(entry) {
        this.SetSize(Math.floor(entry.contentRect.width), Math.floor(entry.contentRect.height))
    }

    _LoadBatch(scene, batch) {
        if (batch.key.blockName !== null &&
            batch.key.geometryType !== BatchingKey.GeometryType.BLOCK_INSTANCE &&
            batch.key.geometryType !== BatchingKey.GeometryType.POINT_INSTANCE) {
            /* Block definition. */
            return
        }
        const objects = new Batch(this, scene, batch).CreateObjects()

        for (const obj of objects) {
            this.scene.add(obj)
            const layer = obj._dxfViewerLayer ?? this.defaultLayer
            layer.PushObject(obj)
            if (!layer.visible) {
                obj.visible = false
            }
        }
    }

    /** @param {number} color Color RGB numeric value, as the drawing specifies it - before the
     *      contrast correction. The material cache is keyed by this color so that the correction
     *      can be re-applied to the existing materials when the background changes.
     * @param {number} instanceType
     */
    _GetSimpleColorMaterial(color, instanceType = InstanceType.NONE) {
        const key = new MaterialKey(instanceType, null, color, 0)
        let entry = this.materials.find({key})
        if (entry !== null) {
            return entry.material
        }
        entry = {
            key,
            material: this._CreateSimpleColorMaterialInstance(this._TransformColor(color),
                                                              instanceType)
        }
        this.materials.insert(entry)
        return entry.material
    }

    _CreateSimpleColorMaterial(instanceType = InstanceType.NONE) {
        const shaders = this._GenerateShaders(instanceType, false)
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
            glslVersion: three.GLSL3,
            side: three.DoubleSide
        })
    }

    /** @param {number} color Color RGB numeric value.
     * @param {number} instanceType
     */
    _CreateSimpleColorMaterialInstance(color, instanceType = InstanceType.NONE) {
        const src = this.simpleColorMaterial[instanceType]
        /* Should reuse compiled shaders. */
        const m = src.clone()
        m.uniforms.color = {value: new three.Color(color)}
        return m
    }

    /** @param {number} color Color RGB numeric value, as the drawing specifies it - before the
     *      contrast correction. The material cache is keyed by this color so that the correction
     *      can be re-applied to the existing materials when the background changes.
     * @param {number} instanceType
     */
    _GetSimplePointMaterial(color, instanceType = InstanceType.NONE) {
        const key = new MaterialKey(instanceType, BatchingKey.GeometryType.POINTS, color, 0)
        let entry = this.materials.find({key})
        if (entry !== null) {
            return entry.material
        }
        entry = {
            key,
            material: this._CreateSimplePointMaterialInstance(this._TransformColor(color),
                                                              this.options.pointSize, instanceType)
        }
        this.materials.insert(entry)
        return entry.material
    }

    _CreateSimplePointMaterial(instanceType = InstanceType.NONE) {
        const shaders = this._GenerateShaders(instanceType, true)
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

    /** @param {number} color Color RGB numeric value.
     * @param {number} size Rasterized point size in pixels.
     * @param {number} instanceType
     */
    _CreateSimplePointMaterialInstance(color, size = 2, instanceType = InstanceType.NONE) {
        const src = this.simplePointMaterial[instanceType]
        /* Should reuse compiled shaders. */
        const m = src.clone()
        m.uniforms.color = {value: new three.Color(color)}
        m.uniforms.pointSize = {value: size}
        return m
    }

    _GenerateShaders(instanceType, pointSize) {
        const fullInstanceAttr = instanceType === InstanceType.FULL ?
            `
            /* First row. */
            in vec3 instanceTransform0;
            /* Second row. */
            in vec3 instanceTransform1;
            ` : ""
        const fullInstanceTransform = instanceType === InstanceType.FULL ?
            `
            pos.xy = mat2(instanceTransform0[0], instanceTransform1[0],
                          instanceTransform0[1], instanceTransform1[1]) * pos.xy +
                     vec2(instanceTransform0[2], instanceTransform1[2]);
            ` : ""

        const pointInstanceAttr = instanceType === InstanceType.POINT ?
            `
            in vec2 instanceTransform;
            ` : ""
        const pointInstanceTransform = instanceType === InstanceType.POINT ?
            `
            pos.xy += instanceTransform;
            ` : ""

        const pointSizeUniform = pointSize ? "uniform float pointSize;" : ""
        const pointSizeAssigment = pointSize ? "gl_PointSize = pointSize;" : ""

        /* The sRGB transfer function, the same one three.js uses in LinearTosRGB(). Only generated
         * when the renderer's output color space asks for it, see `convertToSrgb`.
         */
        const srgbConversion = this.convertToSrgb ? `
            vec3 LinearToSRGB(vec3 c) {
                return mix(pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055, c * 12.92,
                           vec3(lessThanEqual(c, vec3(0.0031308))));
            }
            ` : ""
        const fragmentColor = this.convertToSrgb ? "LinearToSRGB(color)" : "color"

        return {
            vertex: `

            precision highp float;
            precision highp int;
            in vec2 position;
            ${fullInstanceAttr}
            ${pointInstanceAttr}
            uniform mat4 modelViewMatrix;
            uniform mat4 projectionMatrix;
            ${pointSizeUniform}

            void main() {
                vec4 pos = vec4(position, 0.0, 1.0);
                ${fullInstanceTransform}
                ${pointInstanceTransform}
                gl_Position = projectionMatrix * modelViewMatrix * pos;
                ${pointSizeAssigment}
            }
            `,
            fragment: `

            precision highp float;
            precision highp int;
            uniform vec3 color;
            ${srgbConversion}
            out vec4 fragColor;

            void main() {
                fragColor = vec4(${fragmentColor}, 1.0);
            }
            `
        }
    }

    /** Ensure the color is contrast enough with current background color.
     * @param {number} color RGB value.
     * @returns {number} RGB value to use for rendering.
     */
    _TransformColor(color) {
        return TransformColor(color, this.clearColor, this.options.colorCorrection,
                              this.options.blackWhiteInversion)
    }
}

DxfViewer.MessageLevel = MessageLevel

/** Default values for the options the constructor accepts. An option left out of the object
 * passed to `new DxfViewer()` takes its value from here, so this list is also the full set of
 * options.
 */
DxfViewer.DefaultOptions = {
    /** Canvas width in pixels. Ignored when `autoResize` is set.
     * @default
     */
    canvasWidth: 400,
    /** Canvas height in pixels. Ignored when `autoResize` is set.
     * @default
     */
    canvasHeight: 300,
    /** Automatically resize canvas when the container is resized. This options utilizes
     *  ResizeObserver API which is still not fully standardized. The specified canvas size is
     *  ignored if the option is enabled.
     * @default
     */
    autoResize: false,
    /** Frame buffer clear color.
     * @default black
     */
    clearColor: new three.Color("#000"),
    /** Frame buffer clear color alpha value.
     * @default
     */
    clearAlpha: 1.0,
    /** Use alpha channel in a framebuffer.
     * @default
     */
    canvasAlpha: false,
    /** Assume premultiplied alpha in a framebuffer.
     * @default
     */
    canvasPremultipliedAlpha: true,
    /** Use antialiasing. May degrade performance on poor hardware.
     * @default
     */
    antialias: true,
    /** Correct entities colors to ensure that they are always visible with the current background
     * color.
     * @default
     */
    colorCorrection: false,
    /** Simpler version of colorCorrection - just invert pure white or black entities if they are
     * invisible on current background color.
     * @default
     */
    blackWhiteInversion: true,
    /** Size in pixels for rasterized points (dot mark).
     * @default
     */
    pointSize: 2,
    /** Scene generation options — how the drawing is turned into geometry. See
     *  {@link DxfSceneOptions}.
     */
    sceneOptions: DxfScene.DefaultOptions,
    /** Retain the simple object representing the parsed DXF - will consume a lot of additional
     * memory.
     * @default
     */
    retainParsedDxf: false,
    /** Whether to preserve the buffers until manually cleared or overwritten.
     * @default
     */
    preserveDrawingBuffer: false,
    /** Encoding to use for decoding DXF file text content. DXF files newer than DXF R2004 (AC1018)
     * use UTF-8 encoding. Older files use some code page which is specified in $DWGCODEPAGE header
     * variable. Currently parser is implemented in such a way that encoding must be specified
     * before the content is parsed so there is no chance to use this variable dynamically. This may
     * be a subject for future changes. The specified value should be suitable for passing as
     * `TextDecoder` constructor `label` parameter.
     * @default
     */
    fileEncoding: "utf-8",
    /**
     * @type {three.WebGLRenderer | undefined | null}
     * The Webgl renderer to use. If not specified, a new renderer will be created.
     */
    renderer: undefined
}

/** Set up the worker side of the loading pipeline. A worker script handed to `Load()` through
 * `params.workerFactory` must call this at its top level and do nothing else.
 */
DxfViewer.SetupWorker = function() {
    new DxfWorker(self, true)
}

const InstanceType = Object.freeze({
    /** Not instanced. */
    NONE: 0,
    /** Full affine transform per instance. */
    FULL: 1,
    /** Point instances, 2D-translation vector per instance. */
    POINT: 2,

    /** Number of types. */
    MAX: 3
})

class Batch {
    /**
     * @param {DxfViewer} viewer
     * @param {object} scene Serialized scene.
     * @param {object} batch Serialized scene batch.
     */
    constructor(viewer, scene, batch) {
        this.viewer = viewer
        this.key = batch.key

        if (batch.hasOwnProperty("verticesOffset")) {
            const verticesArray =
                new Float32Array(scene.vertices,
                                 batch.verticesOffset * Float32Array.BYTES_PER_ELEMENT,
                                 batch.verticesSize)
            if (this.key.geometryType !== BatchingKey.GeometryType.POINT_INSTANCE ||
                scene.pointShapeHasDot) {
                this.vertices = new three.BufferAttribute(verticesArray, 2)
            }
            if (this.key.geometryType === BatchingKey.GeometryType.POINT_INSTANCE) {
                this.transforms = new three.InstancedBufferAttribute(verticesArray, 2)
            }
        }

        if (batch.hasOwnProperty("chunks")) {
            this.chunks = []
            for (const rawChunk of batch.chunks) {

                const verticesArray =
                    new Float32Array(scene.vertices,
                                     rawChunk.verticesOffset * Float32Array.BYTES_PER_ELEMENT,
                                     rawChunk.verticesSize)
                const indicesArray =
                    new Uint16Array(scene.indices,
                                    rawChunk.indicesOffset * Uint16Array.BYTES_PER_ELEMENT,
                                    rawChunk.indicesSize)
                this.chunks.push({
                    vertices: new three.BufferAttribute(verticesArray, 2),
                    indices: new three.BufferAttribute(indicesArray, 1)
                })
            }
        }

        if (batch.hasOwnProperty("transformsOffset")) {
            const transformsArray =
                new Float32Array(scene.transforms,
                                 batch.transformsOffset * Float32Array.BYTES_PER_ELEMENT,
                                 batch.transformsSize)
            /* Each transform is 3x2 matrix which is split into two 3D vectors which will occupy two
             * attribute slots.
             */
            const buf = new three.InstancedInterleavedBuffer(transformsArray, 6)
            this.transforms0 = new three.InterleavedBufferAttribute(buf, 3, 0)
            this.transforms1 = new three.InterleavedBufferAttribute(buf, 3, 3)
        }

        this.layer = this.key.layerName !== null ? this.viewer.layers.get(this.key.layerName) : null
    }

    GetInstanceType() {
        switch (this.key.geometryType) {
        case BatchingKey.GeometryType.BLOCK_INSTANCE:
            return InstanceType.FULL
        case BatchingKey.GeometryType.POINT_INSTANCE:
            return InstanceType.POINT
        default:
            return InstanceType.NONE
        }
    }

    /** Create scene objects corresponding to batch data.
     * @param {?Batch} instanceBatch Batch with instance transform. Null for non-instanced object.
     */
    *CreateObjects(instanceBatch = null) {
        if (this.key.geometryType === BatchingKey.GeometryType.BLOCK_INSTANCE ||
            this.key.geometryType === BatchingKey.GeometryType.POINT_INSTANCE) {

            if (instanceBatch !== null) {
                throw new Error("Unexpected instance batch specified for instance batch")
            }
            yield* this._CreateBlockInstanceObjects()
            return
        }
        yield* this._CreateObjects(instanceBatch)
    }

    *_CreateObjects(instanceBatch) {
        const color = instanceBatch ?
            instanceBatch._GetInstanceColor(this) : this.key.color

        /* INSERT layer (if specified) takes precedence over layer specified in block definition. */
        const layer = instanceBatch?.layer ?? this.layer

        //XXX line type
        const materialFactory =
            this.key.geometryType === BatchingKey.GeometryType.POINTS ||
            this.key.geometryType === BatchingKey.GeometryType.POINT_INSTANCE ?
                this.viewer._GetSimplePointMaterial : this.viewer._GetSimpleColorMaterial

        /* The color is passed as the drawing specifies it; the contrast correction is applied by
         * the material factory and re-applied by SetClearColor() when the background changes.
         */
        const material = materialFactory.call(this.viewer, color,
                                              instanceBatch?.GetInstanceType() ?? InstanceType.NONE)

        let objConstructor
        switch (this.key.geometryType) {
        case BatchingKey.GeometryType.POINTS:
        /* This method also called for creating dots for shaped point instances. */
        case BatchingKey.GeometryType.POINT_INSTANCE:
            objConstructor = three.Points
            break
        case BatchingKey.GeometryType.LINES:
        case BatchingKey.GeometryType.INDEXED_LINES:
            objConstructor = three.LineSegments
            break
        case BatchingKey.GeometryType.TRIANGLES:
        case BatchingKey.GeometryType.INDEXED_TRIANGLES:
            objConstructor = three.Mesh
            break
        default:
            throw new Error("Unexpected geometry type:" + this.key.geometryType)
        }

        function CreateObject(vertices, indices) {
            const geometry = instanceBatch ?
                new three.InstancedBufferGeometry() : new three.BufferGeometry()
            geometry.setAttribute("position", vertices)
            instanceBatch?._SetInstanceTransformAttribute(geometry)
            if (indices) {
                geometry.setIndex(indices)
            }
            const obj = new objConstructor(geometry, material)
            obj.frustumCulled = false
            obj.matrixAutoUpdate = false
            obj._dxfViewerLayer = layer
            return obj
        }

        if (this.chunks) {
            for (const chunk of this.chunks) {
                yield CreateObject(chunk.vertices, chunk.indices)
            }
        } else {
            yield CreateObject(this.vertices)
        }
    }

    /**
     * @param {three.InstancedBufferGeometry} geometry
     */
    _SetInstanceTransformAttribute(geometry) {
        if (!geometry.isInstancedBufferGeometry) {
            throw new Error("InstancedBufferGeometry expected")
        }
        if (this.key.geometryType === BatchingKey.GeometryType.POINT_INSTANCE) {
            geometry.setAttribute("instanceTransform", this.transforms)
        } else {
            geometry.setAttribute("instanceTransform0", this.transforms0)
            geometry.setAttribute("instanceTransform1", this.transforms1)
        }
    }

    *_CreateBlockInstanceObjects() {
        const block = this.viewer.blocks.get(this.key.blockName)
        if (!block) {
            return
        }
        for (const batch of block.batches) {
            yield* batch.CreateObjects(this)
        }
        if (this.vertices) {
            /* Dots for point shapes. */
            yield* this._CreateObjects()
        }
    }

    /**
     * @param {Batch} blockBatch Block definition batch.
     * @returns {number} RGB color value for a block instance.
     */
    _GetInstanceColor(blockBatch) {
        const defColor = blockBatch.key.color
        if (defColor === ColorCode.BY_BLOCK) {
            return this.key.color
        } else if (defColor === ColorCode.BY_LAYER) {
            if (blockBatch.layer) {
                return blockBatch.layer.color
            }
            return this.layer ? this.layer.color : 0
        }
        return defColor
    }
}

class Layer {
    constructor(name, displayName, color, visible) {
        this.name = name
        this.displayName = displayName
        this.color = color
        this.visible = visible
        this.objects = []
    }

    PushObject(obj) {
        this.objects.push(obj)
    }

    Dispose() {
        for (const obj of this.objects) {
            obj.geometry.dispose()
        }
        this.objects = null
    }
}

class Block {
    constructor() {
        this.batches = []
    }

    /** @param {Batch} batch */
    PushBatch(batch) {
        this.batches.push(batch)
    }
}

/** Custom viewer event names are prefixed with this string. */
const EVENT_NAME_PREFIX = "__dxf_"

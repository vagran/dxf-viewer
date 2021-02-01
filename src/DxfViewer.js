import * as three from "three"
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls"
import {DxfFetcher} from "./DxfFetcher"
import {DxfScene} from "./DxfScene"
import {BatchingKey} from "./BatchingKey"
import {DxfWorker} from "./DxfWorker"


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

        const scene = this.scene = new three.Scene()
        const renderer = this.renderer = new three.WebGLRenderer({
            alpha: options.canvasAlpha,
            premultipliedAlpha: options.canvasPremultipliedAlpha,
            antialias: options.antialias
        })
        const camera = this.camera = new three.OrthographicCamera(-1, 1, 1, -1, 0.1, 2);
        camera.position.z = 1
        camera.position.x = 0
        camera.position.y = 0

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
        //     const material = this._CreateSimpleColorMaterial(0xff0000)
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

        this.materials = new RBTree((m1, m2) => m1.key.Compare(m2.key))
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
        
        for (const batch of scene.batches) {
            let obj
            if (batch.key.geometryType === BatchingKey.GeometryType.LINES) {
                obj = this._CreateLinesBatch(scene, batch)
            } else {
                //XXX console.warn("Unhandled batch geometry type: " + batch.key.geometryType)
                continue
            }
            this.scene.add(obj)
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

    Destroy() {
        //XXX
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

    _GetSimpleColorMaterial(color) {
        const key = new BatchingKey(null, null, null, color, 0)
        let entry = this.materials.find({key})
        if (entry !== null) {
            return entry.material
        }
        entry = {
            key,
            material: this._CreateSimpleColorMaterial(color)
        }
        this.materials.insert(entry)
        return entry.material
    }

    /** @param color {Number} Color RGB numeric value. */
    _CreateSimpleColorMaterial(color) {
        return new three.RawShaderMaterial({
            uniforms: {
                color: {
                    value: new three.Color(color)
                }
            },
            vertexShader: `
            precision highp float;
            precision highp int;
            attribute vec2 position;
            uniform mat4 modelViewMatrix;
            uniform mat4 projectionMatrix;
            
            void main() {
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 0.0, 1.0);
            }
            `,
            fragmentShader: `
            precision highp float;
            precision highp int;
            uniform vec3 color;
            
            void main() {
                gl_FragColor = vec4(color, 1.0);
            }
            
            `
        })
    }

    _CreateLinesBatch(scene, batch) {
        const verticesArray =
            new Float32Array(scene.vertices,
                             batch.verticesOffset * Float32Array.BYTES_PER_ELEMENT,
                             batch.verticesCount)
        const verticesBufferAttr = new three.BufferAttribute(verticesArray, 2)
        const geometry = new three.BufferGeometry()
        geometry.setAttribute("position", verticesBufferAttr)
        const material = this._GetSimpleColorMaterial(batch.key.color)
        const obj = new three.LineSegments(geometry, material)
        obj.frustumCulled = false
        return obj
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
    antialias: true
}

DxfViewer.SetupWorker = function () {
    new DxfWorker(self, true)
}

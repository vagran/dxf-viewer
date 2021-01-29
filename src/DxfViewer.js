import * as three from "three"
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls"
import {DxfFetcher} from "./DxfFetcher"


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
            premultipliedAlpha: options.canvasPremultipliedAlpha
        })
        const camera = this.camera = new three.OrthographicCamera(-1, 1, 1, -1, 0.1, 2);
        camera.position.z = 1
        camera.position.x = 0
        camera.position.y = 0

        //XXX auto resize not implemented
        renderer.setSize(options.canvasWidth, options.canvasHeight)
        console.log(options.clearColor)//XXX
        renderer.setClearColor(options.clearColor, options.clearAlpha)

        this.canvas = renderer.domElement
        this.canvas.getContext("webgl", { premultipliedAlpha: false })
        domContainer.style.display = "block"
        domContainer.appendChild(renderer.domElement)

        //XXX
        const shape = new three.Shape([ new three.Vector2(0, 0),
                                        new three.Vector2(1, 0),
                                        new three.Vector2(0, 1)])

        const geometry = new three.ShapeGeometry(shape)
        const material = new three.MeshBasicMaterial({ color: 0x00ff00 })
        const mesh = new three.Mesh(geometry, material)
        scene.add(mesh)

        const controls = this.controls = new OrbitControls(camera, renderer.domElement)
        controls.enableRotate = false
        controls.mouseButtons = {
            LEFT: three.MOUSE.PAN
        }
        controls.addEventListener("change", this.Render.bind(this))

        this.Render()
    }

    GetCanvas() {
        return this.canvas
    }

    /** Load DXF into the viewer. Old content is discarded, state is reset. */
    async Load(url) {
        //XXX load and preprocess in web worker
        console.log(url)//XXX
        const dxf = await new DxfFetcher(url).Fetch()
        console.log(dxf)//XXX
    }

    Render() {
        this.renderer.render(this.scene, this.camera)
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
    canvasPremultipliedAlpha: true
}
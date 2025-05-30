
import * as BABYLON from 'babylonjs';
import { sceneFactory } from './scenes';

//use this to synchronize scene behaviors with user inputs or UI pieces 
// i.e. state.subscribeEvent() or use scene listeners to state.setValue(key,value)/state.setState({key:value})
import { state } from '../../../scripts/state';


/**
 * Minimal interface your injected context must satisfy.
 */
export interface BabylonContext {
    /** Initialize engine against the canvas */
    init(canvas: HTMLCanvasElement): Promise<void>;

    /** Tear down current scene (but keep engine alive) */
    clearScene(): Promise<true>;

    /** Build & switch to a new scene */
    switchScene(
        sceneKey: string,
        opts?: { [key: string]: any }
    ): Promise<void>;

    /** Start the render loop */
    startRender(): void;

    /** Stop the render loop */
    stopRender(): void;

    /** Handle a window.resize */
    resize(): void;

    /** Dispose engine + any leftover resources */
    dispose(): Promise<boolean>;
}



/**
 * Implements the BabylonContext interface by
 * delegating scene creation to your sceneFactory map.
 */
export class BabylonContextImpl implements BabylonContext {
    private engine!: BABYLON.Engine | BABYLON.WebGPUEngine;
    private scene: BABYLON.Scene | null = null;
    private canvas!: HTMLCanvasElement;

    /** Initialize WebGL2 engine (WebGPU alternative kept in comments) */
    async init(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        // this.engine = new BABYLON.Engine(canvas, true, {
        //   stencil: true,
        //   preserveDrawingBuffer: true,
        //   disableWebGL2Support: false,
        // });

        this.engine = new BABYLON.WebGPUEngine(canvas, {// MUCH FASTER
            stencil: true,
        })
        await this.engine.initAsync();
        state.setState({
            canvas: this.canvas,
            engine: this.engine
        });
    }

    /**
     * Build & switch to a new scene by key.
     * “begin” ⇒ “default” under the hood.
     */
    async switchScene(
        sceneKey?: string,
        opts?: { numSpheres?: number, [key: string]: any }
    ) {
        await this.clearScene();

        // alias “begin” → “default”
        const factoryKey = sceneKey ? sceneKey : '_default';
        const factoryFn = (sceneFactory as any)[factoryKey] as
            | ((e: BABYLON.Engine | BABYLON.WebGPUEngine, c: HTMLCanvasElement, o?: any) => Promise<BABYLON.Scene>)
            | undefined;

        if (!factoryFn) {
            console.warn(`sceneFactory has no entry for “${sceneKey}”`);
            return;
        }

        this.scene = await factoryFn(this.engine, this.canvas, opts);
        state.setState({
            scene: this.scene
        });
    }

    /** Kick off the engine’s render loop */
    startRender() {
        if (!this.scene) return;
        this.engine.runRenderLoop(() => {
            this.scene!.render();
        });
    }

    /** Stop rendering and clear the canvas to black */
    stopRender() {
        this.engine.stopRenderLoop();
    }

    /** Dispose of the currently loaded scene */
    async clearScene(): Promise<true> {
        // 1) Always stop the render loop first
        this.engine.stopRenderLoop();

        // 2) If there is a scene, dispose it synchronously
        if (this.scene) {
            this.scene.dispose();
            this.scene = null;
        }

        // 3) Blow away whatever’s left in the canvas
        this.engine.clear(new BABYLON.Color4(0, 0, 0, 1), true, true);

        return true;
    }

    /** Handle a window.resize event */
    resize() {
        this.engine.resize();
    }

    /** Full tear‐down of scene + engine */
    async dispose() {
        await this.clearScene();
        if (this.engine)
            this.engine.dispose();
        return true;
    }
}
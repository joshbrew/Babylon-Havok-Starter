import React from 'react';
import { sComponent } from "../../util/state.component";
import * as BABYLON from 'babylonjs';
import HavokPhysics from '@babylonjs/havok';

export class Renderer extends sComponent {
  // Prevent broadcasting internal refs/state
  __doNotBroadcast = ['numSpheres'];

  // Default state
  state = {
    numSpheres: 3000,
    gameState: '', // 'main-menu' | 'begin' | 'start' | 'stop' | 'reset' | null
  };

  canvasRef = React.createRef<HTMLCanvasElement>();
  _rendering = false;

  async componentDidMount() {
    const canvas = this.canvasRef.current as HTMLCanvasElement;
    // Initialize WebGL2 or WebGPU engine. WebGPU much better for rendering but not as supported.
    this.engine = new BABYLON.Engine(canvas, true//new BABYLON.WebGPUEngine(canvas, {
      //
      //   // preserveDrawingBuffer: true,
      //   stencil: true,
      //   // disableWebGL2Support: false,
      // }
    );
    await this.engine.initAsync();
    window.addEventListener('resize', this.handleResize);

    // Auto-begin if stated
    if (this.state.gameState === 'begin') {
      await this._beginScene();
    }
  }

  async componentDidUpdate(prevProps, prevState) {
    const { gameState: renderState } = this.state;
    if (renderState !== prevState.renderState) {
      switch (renderState) {
        case 'begin':
          await this._beginScene();
          break;
        case 'start':
          this._startRender();
          break;
        case 'stop':
          this._stopRender();
          break;
        case 'clear':
        case 'main-menu':
          this._clearScene();
          break;
        case 'reset':
          await this._resetScene();
          break;
        default:
          break;
      }
    }
    if (this.state.numSpheres !== prevState.numSpheres && this.scene) {
      // If numSpheres changes externally, reset to apply new count
      await this._resetScene();
    }
  }

  // Initialize and start scene
  async _beginScene() {
    this._clearScene();
    await this._createScene();
    this._startRender();
  }

  // Start render loop
  _startRender() {
    if (this.engine && this.scene && !this._rendering) {
      this.engine.runRenderLoop(() => this.scene.render());
      this._rendering = true;
      this.setState({ gameState: 'playing' });
    }
  }

  // Stop render loop
  _stopRender() {
    if (this.engine && this._rendering) {
      this.engine.stopRenderLoop();
      // clear the GPU canvas to black to avoid ghost frames
      if (this.engine) {
        this.engine.clear(new BABYLON.Color4(0, 0, 0, 0), true, true);
      }
      this._rendering = false;
    }
  }

  // Reset scene: stop, dispose, recreate
  _clearScene() {
    this._stopRender();
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
  }

  // Reset scene: stop, dispose, recreate
  _resetScene = async () => {
    this._clearScene();
    await this._createScene();
    this._startRender();
  }

  // Create Babylon scene with instanced physics spheres
  async _createScene() {
    const { numSpheres } = this.state;
    const scene = new BABYLON.Scene(this.engine);

    // Camera
    const camera = new BABYLON.FreeCamera('camera1', new BABYLON.Vector3(0, 30, -100), scene);
    camera.setTarget(BABYLON.Vector3.Zero());
    camera.attachControl(this.canvasRef.current, true);

    // Light
    const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), scene);
    light.intensity = 0.7;

    // Template sphere (hidden)
    const template = BABYLON.MeshBuilder.CreateSphere('sphere', { diameter: 2, segments: 32 }, scene);
    template.isVisible = false;

    // Ground
    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 1000, height: 1000 }, scene);

    // Physics
    const havokModule = await HavokPhysics();
    const havokPlugin = new BABYLON.HavokPlugin(true, havokModule);
    scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), havokPlugin);

    // Instances
    for (let i = 0; i < numSpheres; i++) {
      const inst = template.createInstance(`sphere${i}`);
      inst.position.y = Math.random() * 40 + 10;
      inst.position.x = Math.random() * 10 - 5;
      inst.position.z = Math.random() * 10 - 5;
      new BABYLON.PhysicsAggregate(inst, BABYLON.PhysicsShapeType.SPHERE, { mass: 1, restitution: 0.75 }, scene);
    }

    // Ground physics
    new BABYLON.PhysicsAggregate(ground, BABYLON.PhysicsShapeType.BOX, { mass: 0 }, scene);

    this.scene = scene;
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.handleResize);
    this._stopRender();
    if (this.scene) this.scene.dispose();
    if (this.engine) this.engine.dispose();
  }

  handleResize = () => {
    if (this.engine) this.engine.resize();
  };

  render() {
    return (
      <canvas
        ref={this.canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    );
  }
}

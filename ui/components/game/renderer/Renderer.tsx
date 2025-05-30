// Renderer.tsx
import React from 'react';
import { sComponent, state } from '../../util/state.component';
import { BabylonContext } from './babylonContext';
import { GameState } from '../../../scripts/state';

interface Props {
  /** Provide this from outside (e.g. wire up your sceneFactory → engine → context here) */
  context: BabylonContext;
}

interface State {
  gameState: GameState | '';
  gameScene: string;
  gameOpts?: Record<string, any>;
}

export class Renderer extends sComponent<Props, State> {
  state: State = {
    gameState: '',
    gameScene: '_default',
    gameOpts: undefined,
  };

  private canvasRef = React.createRef<HTMLCanvasElement>();
  private _rendering = false;

  async componentDidMount() {
    const canvas = this.canvasRef.current!;
    await this.props.context.init(canvas);
    window.addEventListener('resize', this.handleResize);

    // Auto‐begin if requested
    if (this.state.gameState === 'begin') {
      await this.props.context.switchScene(
        this.state.gameScene,
        this.state.gameOpts
      );
      this._startRender();
    }
  }

  async componentDidUpdate(_prevProps: Props, prevState: State) {
    const { gameState, gameScene, gameOpts } = this.state;

    // 1) If the scene key or its opts changed → reload that scene
    const optsChanged =
      JSON.stringify(gameOpts) !== JSON.stringify(prevState.gameOpts);
    if (gameScene !== prevState.gameScene || optsChanged) {
      await this.props.context.switchScene(gameScene, gameOpts);
      if (['begin', 'start', 'playing'].includes(gameState)) {
        this._startRender();
      }
      return;
    }

    // 2) Otherwise, if only gameState changed → handle controls
    if (gameState !== prevState.gameState) {
      switch (gameState) {
        case 'begin':
          this._beginScene();
          break;
        case 'start':
          this._startRender();
          break;
        case 'stop':
          this._stopRender();
          break;
        case 'clear':
        case 'main-menu':
          await this._clearScene();
          break;
        case 'reset':
          // **Stop** the old loop **before** clearing the scene
          this._stopRender();
          // Rebuild the same scene
          await this.props.context.switchScene(
            prevState.gameScene,
            prevState.gameOpts
          );
          // **Restart** rendering
          this._startRender();
          break;
        default:
          break;
      }
    }
  }

  // Initialize and start scene
  private async _beginScene() {
    // clearScene now does everything — stopRenderLoop, scene.dispose, canvas-clear
    await this.props.context.clearScene();
  
    // build the new scene
    await this.props.context.switchScene(this.state.gameScene, this.state.gameOpts);
  
    // kick off rendering
    this._startRender();
  }

  private _startRender() {
    if (!this._rendering) {
      this.props.context.startRender();
      this.setState({ gameState: 'playing' });
    }
    this._rendering = true;
  }

  private _stopRender() {
    if (this._rendering) {
      this.props.context.stopRender();
    }
    this._rendering = false;
  }

  private async _clearScene() {
    if (this._rendering) {
      this._stopRender();
    }
    await this.props.context.clearScene();
  }

  private handleResize = () => {
    this.props.context.resize();
  };

  async componentWillUnmount() {
    window.removeEventListener('resize', this.handleResize);
    this._stopRender();
    await this._clearScene();
    this.props.context.dispose();
  }

  render() {
    return (
      <canvas
        ref={this.canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    );
  }
}

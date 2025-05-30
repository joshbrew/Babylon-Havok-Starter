import * as BABYLON from 'babylonjs';
import HavokPhysics from '@babylonjs/havok';
import keyboard from 'keyboardjs';
import { Howl } from 'howler';
import { state } from '../../../scripts/state';
import { SpriteFactory } from './babylonHelpers';
import * as GUI from 'babylonjs-gui';

export interface SceneFactoryMap {
  [key: string]: (
    engine: BABYLON.Engine,
    canvas: HTMLCanvasElement,
    opts?: Record<string, any>
  ) => Promise<BABYLON.Scene>;
}

const COLLISION_GROUPS = {
  PLAYER: 1 << 0,
  ENEMY: 1 << 1,
  PLAYER_BULLET: 1 << 2,
  ENEMY_BULLET: 1 << 3,
} as const;

type BulletType = 'player' | 'enemy';

interface BaseBulletConfig {
  url: string;
  size: number;
  role: string;
  membership: number;
  collideWith: number;
}
interface PlayerConfig extends BaseBulletConfig {
  velocity: BABYLON.Vector3;
}
interface EnemyConfig extends BaseBulletConfig {
  velocityLine: BABYLON.Vector3;
  velocitySpiral: (angle: number) => BABYLON.Vector3;
}

const bulletConfigs: { player: PlayerConfig; enemy: EnemyConfig } = {
  player: {
    url: 'assets/sprites/playerBullet.png',
    size: 4,
    role: 'playerBullet',
    membership: COLLISION_GROUPS.PLAYER_BULLET,
    collideWith: COLLISION_GROUPS.ENEMY,
    velocity: new BABYLON.Vector3(0, 0, 80),
  },
  enemy: {
    url: 'assets/sprites/enemyBullet.png',
    size: 4,
    role: 'enemyBullet',
    membership: COLLISION_GROUPS.ENEMY_BULLET,
    collideWith: COLLISION_GROUPS.PLAYER,
    velocityLine: new BABYLON.Vector3(0, 0, -40),
    velocitySpiral: (angle: number) =>
      new BABYLON.Vector3(Math.cos(angle), 0, -Math.sin(angle)).scale(40),
  },
};

interface Bullet {
  sprite: BABYLON.InstancedMesh;
  physMesh: BABYLON.Mesh;
  body: any;
  birth: number;
}

interface Sounds {
  playerShoot: Howl;
  enemyShoot: Howl;
  hitPlayer: Howl;
  hitEnemy: Howl;
  bgMusic: Howl;
  winMusic: Howl;
  loseMusic: Howl;
}
// #endregion

export const sceneFactory: SceneFactoryMap = {
  gradius: async (engine, canvas) => {
    const game = new BatsuganScene(engine, canvas);
    return game.init();
  },
};

export class BatsuganScene {
  // #region Class Variables
  private scene: BABYLON.Scene;
  private sprites: SpriteFactory;
  private physicsPlugin!: BABYLON.HavokPlugin;
  private playerAggr!: BABYLON.PhysicsAggregate;
  private playerPhys!: BABYLON.TransformNode;
  private enemyPhys!: BABYLON.TransformNode;
  private playerSprite!: BABYLON.AbstractMesh;
  private enemySprite!: BABYLON.AbstractMesh;
  private bulletTemplates: Partial<Record<BulletType, BABYLON.Mesh>> = {};
  private playerBullets: Bullet[] = [];
  private enemyBullets: Bullet[] = [];
  private bodyToInstance = new Map<any, BABYLON.InstancedMesh>();
  private sounds!: Sounds;
  private lastShot = 0;
  private lastLine = 0;
  private lastSpiral = 0;

  private bgMusic!: Howl;
  private winMusic!: Howl;
  private loseMusic!: Howl;

  private readonly BULLET_LIFESPAN = 5000;

  /** How fast enemy bullets spin (rad/sec) */
  private readonly ENEMY_BULLET_SPIN_SPEED = Math.PI;

  /** Maximum roll tilt for the player (10°) */
  private readonly MAX_TILT_ANGLE = Math.PI / 4;

  /** How quickly the ship eases into its tilt */
  private readonly TILT_SMOOTH_FACTOR = 5;


  // sliding movement state
  private playerVelocity = new BABYLON.Vector3(0, 0, 0);
  private readonly ACCELERATION = 200;   // units/sec²
  private readonly FRICTION = 4;     // higher → more drag
  private readonly MAX_SPEED = 60;    // units/sec

  private boundKeys = ['a', 'd', 'w', 's', 'left', 'right', 'up', 'down', 'space'] as const;
  private inputUnbinds: (() => void)[] = [];
  private onBeforeRenderObserver!: BABYLON.Observer<any>;
  private isPlayerAlive = true;
  private isEnemyAlive = true;

  private readonly PLAYER_INVULN_MS = 300;    // same as flicker duration
  private originalPlayerMembershipMask!: number;
  private originalPlayerCollideMask!: number;
  private playerInvulnerable = false;

  private hitEmitters: BABYLON.ParticleSystem[] = [];
  private nextEmitter = 0;
  private readonly MAX_HIT_EMITTERS = 3;

  // starfield emitter
  private starfield!: BABYLON.ParticleSystem;
  // player tail emitter
  // private tailPS!: BABYLON.ParticleSystem;


  private guiTex!: GUI.AdvancedDynamicTexture;
  private introText!: GUI.TextBlock;
  private overlay!: GUI.Rectangle;
  private isIntroDone = false;

  private scorePanel!: GUI.ScrollViewer;
  private scoreGrid!: GUI.Grid;

  // #region Constructor & Disposal
  constructor(
    private engine: BABYLON.Engine,
    canvas: HTMLCanvasElement
  ) {
    this.scene = new BABYLON.Scene(engine);
    this.sprites = new SpriteFactory(this.scene);

    window.addEventListener('keydown', (e) => {
      const block = [
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'
      ];
      if (block.includes(e.key)) {
        e.preventDefault();
      }
    });

    state.subscribeEvent('lives', (lives) => {
      if (lives <= 0 && state.data.gameState !== 'lose') {
        const scores = state.data.scores || {} as any;
        scores[`${new Date().toISOString()}`] = state.data.score; // this will be saved in localStorage automatically (see ui/scripts/state.ts)
        state.setState({
          scores,
          gameState: 'lose'
        });
      }
    });

    state.subscribeEvent('bossHP', (bossHP) => {
      if (bossHP <= 0 && state.data.gameState !== 'win') {
        this.playerInvulnerable = true;
        const scores = state.data.scores || {} as any;
        scores[`${new Date().toISOString()}`] = state.data.score; // this will be saved in localStorage automatically (see ui/scripts/state.ts)
        state.setState({
          scores,
          gameState: 'win'
        });
      }
    })


    this.registerCleanup();
  }
  // #endregion

  // #region Initialization
  public async init(): Promise<BABYLON.Scene> {
    // 1) Audio setup
    this.sounds = this.setupSounds();

    // 2) Static scene setup
    this.setupState();
    this.setupCamera();
    this.setupLight();
    this.setupBackground();

    // 3) Physics & particles
    await this.setupPhysics();
    this._initStarfield();
    this._initHitParticles();

    // 4) Entities
    this.createPlayer();
    this.createEnemy();
    this._initTailPlane();

    // 5) UI & Intro
    this.setupGUI();
    this.bgMusic.play();
    this.showIntro(3000).then(() => {
      this.isIntroDone = true;
      this.setupInput();
      state.subscribeEvent('gameState', s => {
        if (s === 'win') { this.bgMusic.stop(); this.winMusic.play(); this.playEndAnimation(true); }
        if (s === 'lose') { this.bgMusic.stop(); this.loseMusic.play(); this.playEndAnimation(false); }
      });
    });

    return this.scene;
  }
  // #endregion

  // #region Setup Methods
  private setupState() {
    state.setState({
      playerHP: 100,
      bossHP: 100,
      playerDamage: 2.5,
      bossDamage: 10,
      score: 0,
      lives: 3,
    });
  }

  //not that necessary but worth demoing, better to leave off to limit program weight
  private setupGUI() {
    this.guiTex = GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');

    // Intro text
    this.introText = new GUI.TextBlock();
    this.introText.text = "Get Ready!";
    this.introText.color = "white";
    this.introText.fontSize = 72;
    this.introText.alpha = 0;     // start invisible
    this.guiTex.addControl(this.introText);

    // Full‐screen overlay (for win/lose)
    this.overlay = new GUI.Rectangle();
    this.overlay.width = "100%";
    this.overlay.height = "100%";
    this.overlay.background = "green";
    this.overlay.alpha = 0;       // start transparent
    this.guiTex.addControl(this.overlay);

    this.scorePanel = new GUI.ScrollViewer();
    this.scorePanel.width = "300px";
    this.scorePanel.height = "250px";
    this.scorePanel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.scorePanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    this.scorePanel.background = "rgba(0,0,0,0.6)";
    this.scorePanel.barSize = 12;
    this.scorePanel.isVisible = false;
    this.guiTex.addControl(this.scorePanel);

    this.scoreGrid = new GUI.Grid();
    this.scoreGrid.addColumnDefinition(0.5);
    this.scoreGrid.addColumnDefinition(0.5);

    this.scorePanel.addControl(this.scoreGrid);
  }


  private showScores() {
    // tear down any old rows/controls
    this.scoreGrid.clearControls();
    while (this.scoreGrid.rowCount) {
      this.scoreGrid.removeRowDefinition(0);
    }

    // header row
    this.scoreGrid.addRowDefinition(30);
    const hDate = new GUI.TextBlock("hdrDate", "Date");
    hDate.fontSize = 18;
    hDate.fontWeight = "bold";
    hDate.color = "white";
    this.scoreGrid.addControl(hDate, 0, 0);    // ← row 0, col 0

    const hScore = new GUI.TextBlock("hdrScore", "Score");
    hScore.fontSize = 18;
    hScore.fontWeight = "bold";
    hScore.color = "white";
    this.scoreGrid.addControl(hScore, 0, 1);   // ← row 0, col 1

    // sort entries descending
    const entries = Object.entries(state.data.scores || {}) as [string, number][];
    entries.sort(([, a], [, b]) => b - a);

    // one row per entry
    entries.forEach(([date, score], i) => {
      const row = i + 1;
      this.scoreGrid.addRowDefinition(25);

      const dt = new Date(date);
      const dateStr = dt.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit'
      })

      const d = new GUI.TextBlock(`date${i}`, dateStr);
      d.fontSize = 16;
      d.color = "white";
      d.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
      this.scoreGrid.addControl(d, row, 0);

      const s = new GUI.TextBlock(`score${i}`, `${score}`);
      s.fontSize = 16;
      s.color = "white";
      s.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
      this.scoreGrid.addControl(s, row, 1);    // ← row i+1, col 1
    });

    this.scorePanel.isVisible = true;
  }

  private setupCamera() {
    const camera = new BABYLON.FreeCamera(
      'cam',
      new BABYLON.Vector3(0, 150, 50),
      this.scene
    );
    camera.setTarget(new BABYLON.Vector3(0, 0, 50));
    camera.rotation.z = Math.PI;
    camera.inputs.clear();
  }

  private setupLight() {
    new BABYLON.HemisphericLight(
      'ambient',
      new BABYLON.Vector3(0, -1, 0),
      this.scene
    ).intensity = 2;
  }

  private setupBackground() {
    const backdrop = BABYLON.MeshBuilder.CreatePlane(
      'backdrop',
      { size: 150 },
      this.scene
    );
    backdrop.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    backdrop.position.set(0, 0, 50);
    const backMat = new BABYLON.StandardMaterial('backMat', this.scene);
    backMat.emissiveTexture = new BABYLON.Texture(
      'assets/sprites/starfield.png',
      this.scene
    );
    backMat.disableLighting = true;
    backMat.backFaceCulling = false;
    backdrop.material = backMat;
  }

  // #region Sound Setup
  private setupSounds(): Sounds {
    this.bgMusic = new Howl({ src: ['assets/sounds/royaltyfree.mp3'], loop: true, volume: 0.2 });
    this.winMusic = new Howl({ src: ['assets/sounds/win.mp3'], loop: false, volume: 0.2 });
    this.loseMusic = new Howl({ src: ['assets/sounds/lose.mp3'], loop: false, volume: 0.2 });

    const ps = new Howl({ src: ['assets/sounds/Laser_Gun.wav'] });
    ps.volume(0.1);
    const es = new Howl({ src: ['assets/sounds/Dog_Bark.wav'] });
    es.volume(0.1);

    const hitEnemy = new Howl({ src: ['assets/sounds/Water_Splash.wav'] });
    hitEnemy.volume(0.2);
    const hitPlayer = new Howl({ src: ['assets/sounds/Menu_Out.wav'] });
    hitPlayer.volume(0.2);

    return {
      playerShoot: ps,
      enemyShoot: es,
      hitPlayer,
      hitEnemy,
      bgMusic: this.bgMusic,
      winMusic: this.winMusic,
      loseMusic: this.loseMusic
    };
  }
  // #endregion

  private async setupPhysics() {
    const module = await HavokPhysics();
    const plugin = new BABYLON.HavokPlugin(true, module);
    this.scene.enablePhysics(new BABYLON.Vector3(0, 0, 0), plugin);
    this.physicsPlugin = plugin;
  }

  private registerCleanup() {
    this.scene.onDisposeObservable.add(() => {
      // 1) remove your render-loop observer
      if (this.onBeforeRenderObserver) {
        this.scene.onBeforeRenderObservable.remove(this.onBeforeRenderObserver);
      }

      // 2) unbind all keyboard listeners
      this.inputUnbinds.forEach(unbind => unbind());
      this.inputUnbinds.length = 0;

      // 3) stop & dispose all Howl sounds
      Object.values(this.sounds).forEach(sound => {
        sound.stop();
        sound.unload();
      });

      // 4) dispose every particle system
      this.hitEmitters.forEach(ps => ps.dispose());
      this.hitEmitters.length = 0;
      if (this.starfield) {
        this.starfield.dispose();
      }

      // 5) dispose any tail or other custom meshes
      //    (they’re children of the scene, so scene.dispose() will catch them,
      //     but if you kept references you can null them out here)

      // 6) dispose all bullets & physics meshes
      this.playerBullets.forEach(b => {
        b.sprite.dispose();
        b.physMesh.dispose();
      });
      this.enemyBullets.forEach(b => {
        b.sprite.dispose();
        b.physMesh.dispose();
      });
      this.playerBullets = [];
      this.enemyBullets = [];


      // 7) dispose your hidden bullet templates
      Object.values(this.bulletTemplates).forEach(tmpl => tmpl?.dispose());
      this.bulletTemplates = {};

      this.physicsPlugin.dispose();
      
      // 8) dispose GUI
      if (this.guiTex) {
        this.guiTex.dispose();
      }

      // 9) finally, clear any other subscriptions (e.g. to your state store)
      //    If subscribeEvent returned an unsubscribe, call it here.
      //    e.g. this.livesUnsub(); this.bossHPUnsub();

      // (scene.dispose() itself will clean up lights, cameras, physics, etc.)
    });
  }

  // #endregion


  // #region UI & Intro Animations
  private async showIntro(totalMs: number) {
    // fade in over 500ms, hold, fade out over 500ms
    await this.animateAlpha(this.introText, 0, 1, 15);
    await this.delay(totalMs - 1000);
    await this.animateAlpha(this.introText, 1, 0, 15);
  }



  private playEndAnimation(didWin: boolean) {
    this.overlay.background = didWin ? "green" : "red";
    // fade‐in overlay
    this.animateAlpha(this.overlay, 0, 1, 30).then(() => {
      // now show the top‐score table
      this.showScores();
      // optional: after a delay you could auto‐dispose or reset
      setTimeout(() => {
        // e.g. this.scene.dispose();
      }, 1500);
    });
  }

  // helper: animate any control.alpha from→to over N frames
  private animateAlpha(
    control: GUI.Control,
    from: number,
    to: number,
    frames: number
  ): Promise<void> {
    const anim = new BABYLON.Animation(
      "alphaAnim",
      "alpha",
      30,
      BABYLON.Animation.ANIMATIONTYPE_FLOAT,
      BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
    );
    anim.setKeys([
      { frame: 0, value: from },
      { frame: frames, value: to }
    ]);
    return new Promise((resolve) => {
      this.scene.beginDirectAnimation(control, [anim], 0, frames, false, 1, () => resolve());
    });
  }

  // simple timeout→Promise
  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
  // #endregion


  // #region Input & Game Loop
  private setupInput() {
    let left = false, right = false, up = false, down = false;
    const bind = keyboard.bind.bind(keyboard);

    this.inputUnbinds.push(bind('a', () => left = true, () => left = false));
    this.inputUnbinds.push(bind('d', () => right = true, () => right = false));
    this.inputUnbinds.push(bind('w', () => up = true, () => up = false));
    this.inputUnbinds.push(bind('s', () => down = true, () => down = false));
    this.inputUnbinds.push(bind('left', () => left = true, () => left = false));
    this.inputUnbinds.push(bind('right', () => right = true, () => right = false));
    this.inputUnbinds.push(bind('up', () => up = true, () => up = false));
    this.inputUnbinds.push(bind('down', () => down = true, () => down = false));
    this.inputUnbinds.push(bind('space', () => this.spawnPlayerBullet()));

    const canvas = this.engine.getRenderingCanvas();
    if (canvas) { canvas.tabIndex = 0; canvas.focus(); }

    // capture the observer id so we can remove it later
    this.onBeforeRenderObserver =
      this.scene.onBeforeRenderObservable.add(() => {
        const now = performance.now();
        const dt = this.engine.getDeltaTime() / 1000;

        if (this.isPlayerAlive) {
          this.updatePlayerMovement(left, right, up, down, dt);
        }
        if (this.isEnemyAlive) {
          this.tryEnemyFire(now);
        }

        this.cleanup(this.playerBullets, now);
        this.cleanup(this.enemyBullets, now);

        // ● Spin all enemy bullets about Y as they fly
        this.enemyBullets.forEach(b => {
          b.sprite.rotation.z += this.ENEMY_BULLET_SPIN_SPEED * dt;
        });
      });

  }
  // #endregion

  // #region Movement
  private updatePlayerMovement(
    left: boolean,
    right: boolean,
    up: boolean,
    down: boolean,
    dt: number
  ) {
    // 1) build a direction vector (with Z flipped so “up” increases Z)
    const dir = new BABYLON.Vector3(
      (right ? 1 : 0) - (left ? 1 : 0),
      0,
      (up ? 1 : 0) - (down ? 1 : 0)
    );

    // 2) apply acceleration
    if (dir.lengthSquared() > 0) {
      dir.normalize().scaleInPlace(this.ACCELERATION * dt);
      this.playerVelocity.addInPlace(dir);
    }

    // 3) apply exponential friction
    const frictionFactor = Math.exp(-this.FRICTION * dt);
    this.playerVelocity.scaleInPlace(frictionFactor);

    // 4) cap max speed
    const speed = this.playerVelocity.length();
    if (speed > this.MAX_SPEED) {
      this.playerVelocity.scaleInPlace(this.MAX_SPEED / speed);
    }

    // 5) compute the next position and clamp to viewport
    const current = this.playerPhys.position;
    const next = current.add(this.playerVelocity.scale(dt));
    next.x = BABYLON.Scalar.Clamp(next.x, -30, 30);
    next.z = BABYLON.Scalar.Clamp(next.z, 5, 50);

    //low level hack to get proper animation control
    const bodyId = this.playerAggr.body._pluginData.hpBodyId;
    this.physicsPlugin._hknp.HP_Body_SetPosition(bodyId, [next.x, next.y, next.z]);

    // ● Smooth 10° Z‐roll based on horizontal velocity
    const tiltTarget = BABYLON.Scalar.Clamp(
      (this.playerVelocity.x / this.MAX_SPEED) * this.MAX_TILT_ANGLE,
      -this.MAX_TILT_ANGLE,
      this.MAX_TILT_ANGLE
    ) + Math.PI;
    this.playerSprite.rotation.y = BABYLON.Scalar.Lerp(
      this.playerSprite.rotation.y,
      tiltTarget,
      Math.min(dt * this.TILT_SMOOTH_FACTOR, 1)
    );
  }
  // #endregion



  // #region Animations
  private _initTailPlane() {
    // 1) build the plane
    const tail = BABYLON.MeshBuilder.CreatePlane(
      'tailPlane',
      { width: 0.5, height: 4 },
      this.scene
    );
    tail.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    tail.parent = this.playerSprite;
    tail.position.set(0, -0.1, -2.5);

    // 2) white material
    const mat = new BABYLON.StandardMaterial('tailMat', this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = BABYLON.Color3.White();
    tail.material = mat;

    // 3) flicker in render loop, with spring ramp on freq
    tail.isVisible = false;
    const maxFreq = 10;     // Hz at MAX_SPEED
    const minSpeed = 2;     // below this, no flicker
    const maxSpeed = this.MAX_SPEED;
    const springFactor = 3; // >1 gives a “snappier” ramp near top

    this.scene.onBeforeRenderObservable.add(() => {
      if (!this.isPlayerAlive) {
        tail.isVisible = false;
        return;
      }

      const speed = this.playerVelocity.length();
      if (speed <= minSpeed) {
        tail.isVisible = false;
        return;
      }

      // normalize [0–1]
      let t = Math.min(speed / maxSpeed, 1);

      // spring easing: slow at first, then snap up
      // t_spring = 1 - (1 - t)^springFactor
      const tSpring = 1 - Math.pow(1 - t, springFactor);

      // flicker frequency in Hz
      const freq = tSpring * maxFreq;

      // sine wave at that freq: visible when positive
      const timeSec = performance.now() * 0.001;
      tail.isVisible = Math.sin(2 * Math.PI * freq * timeSec) > 0;
    });
  }


  private flicker(
    mesh: BABYLON.AbstractMesh,
    duration = 300,   // total flicker time in ms
    interval = 100    // toggle every 100ms
  ) {
    let elapsed = 0;

    const handle = setInterval(() => {
      mesh.isVisible = !mesh.isVisible;
      elapsed += interval;
      if (elapsed >= duration) {
        clearInterval(handle);
        mesh.isVisible = true;
      }
    }, interval);
  }

  private flashing = new WeakSet<BABYLON.AbstractMesh>();

  private flickerWhite(
    mesh: BABYLON.AbstractMesh,
    duration = 300,
    interval = 100
  ) {
    // if already flashing, bail out
    if (this.flashing.has(mesh)) {
      return;
    }
    this.flashing.add(mesh);

    const mat = mesh.material as BABYLON.StandardMaterial;
    if (!mat) {
      this.flashing.delete(mesh);
      return;
    }

    // 1) back up everything
    const origDiffuseTex = mat.diffuseTexture;
    const origEmissiveTex = mat.emissiveTexture;
    const origDiffuseColor = mat.diffuseColor.clone();
    const origEmissiveColor = mat.emissiveColor.clone();

    // 2) force flat white
    mat.disableLighting = true;

    let elapsed = 0;
    const handle = setInterval(() => {
      const isOriginal = mat.diffuseTexture !== null;

      if (isOriginal) {
        // on: strip textures, white-out
        mat.diffuseTexture = null;
        mat.emissiveTexture = null;
        mat.diffuseColor = BABYLON.Color3.White();
        mat.emissiveColor = BABYLON.Color3.White();
      } else {
        // off: restore
        mat.diffuseTexture = origDiffuseTex;
        mat.emissiveTexture = origEmissiveTex;
        mat.diffuseColor = origDiffuseColor.clone();
        mat.emissiveColor = origEmissiveColor.clone();
      }

      elapsed += interval;
      if (elapsed >= duration) {
        clearInterval(handle);
        // final restore
        mat.disableLighting = false;
        mat.diffuseTexture = origDiffuseTex;
        mat.emissiveTexture = origEmissiveTex;
        mat.diffuseColor = origDiffuseColor.clone();
        mat.emissiveColor = origEmissiveColor.clone();
        this.flashing.delete(mesh);
      }
    }, interval);
  }

  // #endregion


  // #region Particle Effects
  private _initStarfield() {
    this.starfield = new BABYLON.ParticleSystem('starfield', 500, this.scene);
    this.starfield.particleTexture = new BABYLON.Texture('assets/sprites/enemyBullet.png', this.scene);
    this.starfield.minSize = 0.5;
    this.starfield.maxSize = 0.8;
    this.starfield.minLifeTime = 4;
    this.starfield.maxLifeTime = 6;
    this.starfield.emitRate = 100;
    // emit from top of playfieldaa
    this.starfield.createBoxEmitter(
      new BABYLON.Vector3(-40, 1, -10),
      new BABYLON.Vector3(40, 1, 110),
      new BABYLON.Vector3(-40, 60, -10),
      new BABYLON.Vector3(40, 60, 110)
    );
    this.starfield.minEmitPower = 10;
    this.starfield.maxEmitPower = 10;
    this.starfield.direction1 = new BABYLON.Vector3(0, 0, -10);
    this.starfield.direction2 = new BABYLON.Vector3(0, 0, -10);
    this.starfield.color1 = new BABYLON.Color4(Math.random(), Math.random(), Math.random(), 1);
    this.starfield.color2 = new BABYLON.Color4(Math.random(), Math.random(), Math.random(), 1);
    this.starfield.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    this.starfield.start();
  }

  private _initHitParticles() {
    for (let i = 0; i < this.MAX_HIT_EMITTERS; i++) {
      const ps = new BABYLON.ParticleSystem(`hitStreaks${i}`, 200, this.scene);
      ps.particleTexture = new BABYLON.Texture("assets/sprites/laser_streak.png", this.scene);
      ps.color1 = new BABYLON.Color4(1, 1, 1, 1);
      ps.color2 = new BABYLON.Color4(1, 1, 1, 0.5);
      ps.colorDead = new BABYLON.Color4(1, 1, 1, 0);
      ps.minSize = 1;
      ps.maxSize = 2;
      ps.minLifeTime = 1;
      ps.maxLifeTime = 2;
      ps.minEmitPower = 8;
      ps.maxEmitPower = 12;
      ps.updateSpeed = 0.02;
      ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
      ps.emitRate = 0;   // manual bursts

      // define a cone of directions via a zero-volume BoxParticleEmitter
      const dir1 = new BABYLON.Vector3(-1, 1, -1);
      const dir2 = new BABYLON.Vector3(1, 1, 1);
      const zero = BABYLON.Vector3.Zero();
      ps.createBoxEmitter(dir1, dir2, zero, zero);

      ps.start();
      this.hitEmitters.push(ps);
    }
  }

  private _burstHitAt(pos: BABYLON.Vector3) {
    const ps = this.hitEmitters[this.nextEmitter];
    this.nextEmitter = (this.nextEmitter + 1) % this.MAX_HIT_EMITTERS;

    ps.emitter = pos.clone();

    // 1) emit exactly 100 particles, no more :contentReference[oaicite:0]{index=0}
    ps.manualEmitCount = 100;

    // 2) force one update so particles are created now
    ps.animate();

    // 3) stop further emissions
    ps.manualEmitCount = 0;

    // 4) set each new particle’s angle from its direction
    for (const p of ps.particles) {
      p.angle = Math.atan2(p.direction.z, p.direction.x);
    }
  }
  // #endregion


  // #region Ship Creation & Collisions
  private createShip(
    name: string,
    url: string,
    size: number,
    x: number,
    y: number,
    z: number,
    membership: number,
    collideWith: number,
    hitCb: (inst: BABYLON.InstancedMesh, evt: BABYLON.IPhysicsCollisionEvent, evtState: BABYLON.EventState) => void
  ) {
    // ─── parent only holds position & physics ─────────────────────────
    const parent = new BABYLON.TransformNode(name + 'Parent', this.scene);
    parent.position.set(x, y, z);

    // ─── physics body on the parent ──────────────────────────────────
    const aggr = new BABYLON.PhysicsAggregate(
      parent as any,
      BABYLON.PhysicsShapeType.SPHERE,
      { mass: name === 'player' || name === 'enemy' ? 0 : 1, restitution: 1, radius: size / 3.25 },
      this.scene
    );
    aggr.body.setEventMask(this.physicsPlugin._hknp.EventType.COLLISION_STARTED.value);

    aggr.shape.filterMembershipMask = membership;
    aggr.shape.filterCollideMask = collideWith;
    aggr.body.setMotionType(
      // name === 'player' || name === 'enemy'
      BABYLON.PhysicsMotionType.ANIMATED //this is kinematic (governed by programmatic control)
      // : BABYLON.PhysicsMotionType.DYNAMIC
    );


    // ─── create the billboarded sprite mesh ───────────────────────────
    const sprite = this.sprites.createSprite(name, url, size, name);
    sprite.parent = parent;

    // apply billboard + flat‐toward‐camera rotation on the mesh itself:
    sprite.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    sprite.rotation.x = 0;
    sprite.rotation.y = Math.PI;

    // reconfigure material exactly like the old example:
    if (sprite.material instanceof BABYLON.StandardMaterial) {
      const mat = sprite.material as BABYLON.StandardMaterial;
      const tex = new BABYLON.Texture(url, this.scene);
      tex.hasAlpha = true;

      mat.diffuseTexture = tex;
      mat.opacityTexture = tex;
      mat.useAlphaFromDiffuseTexture = true;
      mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      mat.disableLighting = false;  // ← allow hemispheric shading
      mat.backFaceCulling = false;
    }

    // ─── collision handling callback ─────────────────────────────────
    aggr.body.getCollisionObservable().add((evt, evtState) => {
      // console.log(name, 'collided with', evt.collider)
      const other = evt.collider === aggr.body ? evt.collidedAgainst : evt.collider;
      const inst = this.bodyToInstance.get(other);
      if (inst) hitCb(inst, evt, evtState);
    });

    return { sprite, aggr };
  }


  private createPlayer() {
    const { sprite, aggr } = this.createShip(
      'player',
      'assets/sprites/playerShip.png',
      6,
      0, 10, 5,
      COLLISION_GROUPS.PLAYER,
      COLLISION_GROUPS.ENEMY_BULLET,
      (inst, evt) => this.handlePlayerHit(inst, evt)
    );
    this.playerSprite = sprite;
    this.playerAggr = aggr;
    // sprite.rotation.x = -Math.PI / 4;
    this.playerPhys = sprite.parent as BABYLON.TransformNode;
    this.originalPlayerMembershipMask = aggr.shape.filterMembershipMask;
    this.originalPlayerCollideMask = aggr.shape.filterCollideMask;
    this.playerInvulnerable = false;
  }

  private createEnemy() {
    const { sprite, aggr } = this.createShip(
      'enemy',
      'assets/sprites/enemyShip.png',
      24,
      0, 10, 95,
      COLLISION_GROUPS.ENEMY,
      COLLISION_GROUPS.PLAYER_BULLET,
      (inst, evt) => this.handleEnemyHit(inst, evt)
    );
    this.enemySprite = sprite;
    this.enemyPhys = sprite.parent as BABYLON.TransformNode;
  }

  // #endregion


  // #region Collision Handlers
  private handlePlayerHit(inst: BABYLON.InstancedMesh, evt: BABYLON.IPhysicsCollisionEvent) {
    if (inst.metadata.role !== 'enemyBullet') return;
    inst.parent?.dispose();
    inst.dispose();
    if (!this.isPlayerAlive || this.playerInvulnerable) return;
    this.playerInvulnerable = true;
    const newHP = (state.data.playerHP ?? 0) - (state.data.bossDamage ?? 0);
    const newScore = (state.data.score ?? 0) - 50;
    state.setState({ playerHP: newHP, score: newScore });

    this._burstHitAt(evt.collidedAgainst.getObjectCenterWorld());

    this.sounds.hitPlayer.play();
    this.flickerWhite(this.playerSprite);

    // Disable *membership* and *collide* so no further bullet hits register
    const shape = this.playerAggr.shape;
    shape.filterMembershipMask = 0;
    shape.filterCollideMask = 0;

    // Restore after invuln window
    setTimeout(() => {
      this.playerInvulnerable = false;
      if (!this.isPlayerAlive) return;
      shape.filterMembershipMask = this.originalPlayerMembershipMask;
      shape.filterCollideMask = this.originalPlayerCollideMask;
    }, this.PLAYER_INVULN_MS);

    if (newHP <= 0) {
      const newLives = (state.data.lives ?? 0) - 1;
      state.setValue('lives', newLives);
      if (newLives > 0) {
        this.respawnPlayer();
      } else {
        this.despawnPlayer();
      }
    }
  }


  private handleEnemyHit(inst: BABYLON.InstancedMesh, evt: BABYLON.IPhysicsCollisionEvent) {
    // 1) ignore any hits once the boss is gone
    if (!this.isEnemyAlive || inst.metadata.role !== 'playerBullet') {
      return;
    }

    // 2) safely tear down the bullet + its parent if present
    if (inst.parent) {
      inst.parent.dispose();
    }
    inst.dispose();
    // 3) subtract HP, update state & score
    const newHP = (state.data.bossHP || 0) - (state.data.playerDamage || 0);
    state.setState({
      bossHP: newHP,
      score: (state.data.score || 0) + 100
    });

    this._burstHitAt(evt.collidedAgainst.getObjectCenterWorld());

    // 4) play hit sound + white flicker
    this.sounds.hitEnemy.play();
    this.flickerWhite(this.enemySprite);

    // 5) despawn if HP ≤ 0
    if (newHP <= 0) {
      this.despawnEnemy();
    }
  }


  private despawnPlayer() {
    this.isPlayerAlive = false;
    this.playerSprite.parent?.dispose();
    this.playerAggr.dispose();

    // unbind each key
    for (const key of this.boundKeys) {
      keyboard.unbind(key);
    }
  }

  private respawnPlayer() {
    // reset HP
    this.playerInvulnerable = true;
    state.setValue('playerHP', 100);

    // move back to start
    this.playerPhys.position.set(0, 10, 5);
    this.playerAggr.body._pluginData.hpBodyId;  // if you need to HP_Body_SetPosition likewise

    // you may want a brief “respawn flash”:
    this.flickerWhite(this.playerSprite);
    setTimeout(() => { this.playerInvulnerable = false; }, this.PLAYER_INVULN_MS)

    // ensure collisions are back on
    this.playerAggr.shape.filterCollideMask = this.originalPlayerCollideMask;
  }



  private despawnEnemy() {
    this.isEnemyAlive = false;
    this.enemySprite.parent!.dispose();
    // this.scene.onBeforeRenderObservable.remove(this.onBeforeRenderObserver);
    // clear any live enemy bullets
    // this.enemyBullets.forEach(b => {
    //   b.sprite.dispose();
    //   b.physMesh.dispose();
    // });

    // this.enemyBullets = [];
  }
  // #endregion


  // #region Weapon Fire
  private spawnPlayerBullet() {
    const now = performance.now();
    if (now - this.lastShot < 200) return;
    const cfg = bulletConfigs.player;
    const start = this.playerPhys.position.add(new BABYLON.Vector3(0, 1, 0));
    this.instanceBullet('player', cfg, start, cfg.velocity);
    this.sounds.playerShoot.play();
    this.lastShot = now;
  }

  private tryEnemyFire(now: number) {
    if (now - this.lastLine > 2000) {
      this.spawnEnemyLine();
      this.sounds.enemyShoot.play();
      this.lastLine = now;
    }
    if (now - this.lastSpiral > 5000) {
      this.spawnEnemySpiral();
      this.sounds.enemyShoot.play();
      this.lastSpiral = now;
    }
  }
  // #endregion


  // #region Bullet Management
  // ─── line shot: spawnEnemyLine ─────────────────────────────────
  private spawnEnemyLine() {
    const cfg = bulletConfigs.enemy;
    const cols = 7;
    const spacing = cfg.size;
    const halfWidth = ((cols - 1) * spacing) / 2;

    for (let i = 0; i < cols; i++) {
      const xOff = -halfWidth + i * spacing;

      // spawn half a bullet‐size down (toward the player) on Y
      const start = this.enemyPhys.position.add(
        new BABYLON.Vector3(xOff, -cfg.size * 0.5, 0)
      );

      this.instanceBullet('enemy', cfg, start, cfg.velocityLine);
    }
  }

  // ─── spiral shot: spawnEnemySpiral ─────────────────────────────
  private async spawnEnemySpiral() {
    const cfg = bulletConfigs.enemy;
    for (let i = 0; i < 48; i++) {
      const angle = (2 * Math.PI * i) / 24 + Date.now() / 1000;

      // same Y‐offset so bullets start at the ship’s nose
      const start = this.enemyPhys.position.add(
        new BABYLON.Vector3(0, -cfg.size * 0.5, 0)
      );

      this.instanceBullet('enemy', cfg, start, cfg.velocitySpiral(angle));
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  private instanceBullet(
    type: BulletType,
    cfg: PlayerConfig | EnemyConfig,
    pos: BABYLON.Vector3,
    vel: BABYLON.Vector3
  ) {
    // ─── build the hidden template on first use ──────────────────────
    if (!this.bulletTemplates[type]) {
      const tmpl = BABYLON.MeshBuilder.CreatePlane(
        `tmpl_${type}`,
        { size: cfg.size },
        this.scene
      );
      tmpl.isVisible = false;
      tmpl.material = this.sprites.getMaterial(cfg.url);
      this.bulletTemplates[type] = tmpl;
    }
    const template = this.bulletTemplates[type]!;

    // ─── create & orient the sprite instance ────────────────────────
    const inst = template.createInstance(`${type}#${Date.now()}`);
    inst.metadata = { role: cfg.role };
    inst.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    inst.rotation.y = Math.PI;

    // ─── create the (invisible) physics sphere at world‐space pos ────
    const phys = BABYLON.MeshBuilder.CreateSphere(
      `phys_${type}#${Date.now()}`,
      { diameter: cfg.size },
      this.scene
    );
    phys.isVisible = false;
    phys.position.copyFrom(pos);

    // ─── parent the sprite to the phys body, then zero its local offset
    inst.parent = phys;
    inst.position.set(0, 0, 0);

    // ─── set up the physics aggregate for movement & collisions ─────
    const aggr = new BABYLON.PhysicsAggregate(
      phys,
      BABYLON.PhysicsShapeType.SPHERE,
      { mass: 1, restitution: 1, radius: cfg.size / 2 },
      this.scene
    );
    aggr.shape.filterMembershipMask = cfg.membership;
    aggr.shape.filterCollideMask = cfg.collideWith;
    aggr.body.setLinearVelocity(vel);
    aggr.body.setEventMask(
      this.physicsPlugin._hknp.EventType.COLLISION_STARTED.value
    );

    // map body → sprite for collision callbacks
    this.bodyToInstance.set(aggr.body, inst);

    // ─── stash into the correct bullet pool ───────────────────────────
    const record: Bullet = {
      sprite: inst,
      physMesh: phys,
      body: aggr.body,
      birth: performance.now()
    };
    if (type === 'player') {
      this.playerBullets.push(record);
    } else {
      this.enemyBullets.push(record);
    }
  }


  private cleanup(pool: Bullet[], now: number) {
    for (let i = pool.length - 1; i >= 0; i--) {
      const b = pool[i];
      const z = b.physMesh.position.z;
      if (now - b.birth > this.BULLET_LIFESPAN || z < -10 || z > 110) {
        b.sprite.dispose();
        b.physMesh.dispose();
        pool.splice(i, 1);
      }
    }
  }
  // #endregion
}

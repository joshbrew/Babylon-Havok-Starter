// sceneFactory.ts
// ---------------
// Central module for creating and registering multiple Babylon.js scenes

import * as BABYLON from 'babylonjs';
import HavokPhysics from '@babylonjs/havok';
import keyboard from 'keyboardjs'
import howler from 'howler'
import { SpriteFactory } from './babylonHelpers'
import { BatsuganScene } from './batsuganScene'

//use this to synchronize scene behaviors with user inputs or UI pieces 
// i.e. state.subscribeEvent() or use scene listeners to state.setValue(key,value)/state.setState({key:value})
import { state } from '../../../scripts/state';

export interface SceneFactoryMap {
    [key: string]: (
        engine: BABYLON.Engine,
        canvas: HTMLCanvasElement,
        opts?: { [key: string]: any }
    ) => Promise<BABYLON.Scene>;
}


export const sceneFactory: SceneFactoryMap = {
    /** Default physics-demo scene (previously "begin" state) */
    _default: async (
        engine: BABYLON.Engine,
        canvas: HTMLCanvasElement,
        opts: { numSpheres?: number } = { numSpheres: 3000 }
    ) => {
        const scene = new BABYLON.Scene(engine);

        // ── Camera ─────────────────────────────────────────────────────────
        const camera = new BABYLON.FreeCamera(
            'camera1',
            new BABYLON.Vector3(0, 30, -100),
            scene
        );
        camera.setTarget(BABYLON.Vector3.Zero());
        camera.attachControl(canvas, true);

        // ── Lights & Shadows ────────────────────────────────────────────────
        const hemi = new BABYLON.HemisphericLight(
            'hemiLight',
            new BABYLON.Vector3(0, 1, 0),
            scene
        );
        hemi.intensity = 0.5;

        const point = new BABYLON.PointLight(
            'pointLight',
            new BABYLON.Vector3(0, 50, 0),
            scene
        );
        point.intensity = 0.8;

        const shadowGen = new BABYLON.ShadowGenerator(2048, point);
        shadowGen.useBlurExponentialShadowMap = true;
        shadowGen.blurKernel = 32;

        // ── Ground ─────────────────────────────────────────────────────────
        const ground = BABYLON.MeshBuilder.CreateGround(
            'ground',
            { width: 1000, height: 1000 },
            scene
        );
        ground.receiveShadows = true;

        // ── Template Sphere ────────────────────────────────────────────────
        const template = BABYLON.MeshBuilder.CreateSphere(
            'sphere',
            { diameter: 2, segments: 32 },
            scene
        );
        template.isVisible = false;

        // ── Tell Babylon we'll use a per-instance "color" buffer (4 floats) ──
        template.registerInstancedBuffer('color', 4);

        // ── Shared material that reads "color" per-instance ────────────────
        const mat = new BABYLON.StandardMaterial('instMat', scene);
        // mat.useVertexColors = true;
        mat.specularPower = 64;
        template.material = mat;

        // ── Physics setup ─────────────────────────────────────────────────
        const havokModule = await HavokPhysics();
        const havokPlugin = new BABYLON.HavokPlugin(true, havokModule);
        scene.enablePhysics(new BABYLON.Vector3(0, -9.8, 0), havokPlugin);

        // ── Instances with bright random colors ───────────────────────────
        const n = opts.numSpheres ?? 3000;
        for (let i = 0; i < n; i++) {
            const inst = template.createInstance(`sphere${i}`);
            inst.position.set(
                Math.random() * 10 - 5,
                Math.random() * 40 + 10,
                Math.random() * 10 - 5
            );

            // assign a bright random Color4 to *this* instance
            inst.instancedBuffers.color = new BABYLON.Color4(
                0.5 + Math.random() * 0.5,
                0.5 + Math.random() * 0.5,
                0.5 + Math.random() * 0.5,
                1.0
            );

            // let it cast shadows
            shadowGen.addShadowCaster(inst);

            // physics body
            const instAggr = new BABYLON.PhysicsAggregate(
                inst,
                BABYLON.PhysicsShapeType.SPHERE,
                { mass: 1, restitution: 0.75 },
                scene
            );

            //instAggr.body.setLinearVelocity(new BABYLON.Vector3(0,0,0));
            //instAggr.body.setLinearDamping(
            // 0,
            // );
            instAggr.body.applyForce(
                new BABYLON.Vector3(0, 0, 0), //force
                new BABYLON.Vector3(0, 0, 0)  //location
            );
        }


        // ── Ground physics ─────────────────────────────────────────────────
        const groundAggr = new BABYLON.PhysicsAggregate(
            ground,
            BABYLON.PhysicsShapeType.BOX,
            { mass: 0 },
            scene
        );

        groundAggr.body.setCollisionCallbackEnabled(true);
        groundAggr.body.getCollisionObservable().add(
            () => {
                console.log("Ground collision!"); //careful with performance!!
            }
        )

        /** 
            //event masks? can limit what events appear on the observa
            const started = hk._hknp.EventType.COLLISION_STARTED.value 
            const continued = hk._hknp.EventType.COLLISION_CONTINUED.value 
            const finished = hk._hknp.EventType.COLLISION_FINISHED.value
            
            const eventMask = started //| continued | finished
            groundAggr.body.setEventMask(eventMask)

            const observable = groundAggr.body.getCollisionObservable()
            const observer = observable.add((collisionEvent) => {
                console.log(collisionEvent)
            });
        */

        //scene.onBeforeAnimationsObservable.add(()=>{}); //before animation step
        //scene related callbacks per-frame (do this to keep updates batched off of state etc.)
        //scene.onBeforePhysicsObservable.add(()=>{}); //before physics step
        //scene.onBeforeRenderObservable.add(()=>{}); //before render step


        return scene;
    },

    /** Gradius-style shooter */
    gradius: async (engine, canvas, opts = {}) => {
        const scene = new BABYLON.Scene(engine);
        const sprites = new SpriteFactory(scene);

        state.setState({
            playerHP: 100,
            bossHP: 100,
            playerDamage: 10,
            bossDamage: 5,
            score: 0,
            lives: 3
        })

        const COLLISION_GROUPS = {
            PLAYER: 1 << 0,  // 0b0001
            ENEMY: 1 << 1,  // 0b0010
            PLAYER_BULLET: 1 << 2,  // 0b0100
            ENEMY_BULLET: 1 << 3,  // 0b1000
        };

        const bulletConfigs = {
            player: {
                url: 'assets/sprites/playerBullet.png' as const,
                size: 4,
                role: 'playerBullet' as const,
                membership: COLLISION_GROUPS.PLAYER_BULLET,  
                collideWith: COLLISION_GROUPS.ENEMY,
                velocity: new BABYLON.Vector3(0, 0, 80),
            },
            enemy: {
                url: 'assets/sprites/enemyBullet.png' as const,
                size: 4,
                role: 'enemyBullet' as const,
                membership: COLLISION_GROUPS.ENEMY_BULLET,
                collideWith: COLLISION_GROUPS.PLAYER,
                velocityLine: new BABYLON.Vector3(0, 0, -40),
                velocitySpiral: (angle: number) =>
                    new BABYLON.Vector3(Math.cos(angle), 0, -Math.sin(angle)).scale(40),
            }
        } as const

        type BulletType = keyof typeof bulletConfigs


        // ─────────────── Background ────────────────────────────────────────
        const backdrop = BABYLON.MeshBuilder.CreatePlane(
            'backdrop',
            { size: 200 },
            scene
        );
        backdrop.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        backdrop.position.set(0, 0, 50);
        const backMat = new BABYLON.StandardMaterial('backMat', scene);
        backMat.emissiveTexture = new BABYLON.Texture('assets/sprites/starfield.png', scene);
        backMat.disableLighting = true;
        backdrop.material = backMat;

        // ─────────────── Camera ─────────────────────────────────────────────
        const camera = new BABYLON.FreeCamera(
            "cam",
            // hover 100 units up over the middle of your playfield (z = 50)
            new BABYLON.Vector3(0, 150, 50),
            scene
        );
        // look straight down at z = 50
        camera.setTarget(new BABYLON.Vector3(0, 0, 50));
        camera.rotation.z = Math.PI;
        // lock out any user panning/rotation
        camera.inputs.clear();

        new BABYLON.HemisphericLight(
            'ambient',
            new BABYLON.Vector3(0, -1, 0),
            scene
        ).intensity = 2;
        // ─────────────── Sounds ─────────────────────────────────────────────
        const playerShootSnd = new howler.Howl({ src: ['assets/sounds/Laser_Gun.wav'] });
        playerShootSnd.volume(0.1);
        const enemyShootSnd = new howler.Howl({ src: ['assets/sounds/Dog_Bark.wav'] });
        enemyShootSnd.volume(0.1);

        // ─────────────── Physics Init ─────────────────────────────────────
        const havokModule = await HavokPhysics();
        const physicsPlugin = new BABYLON.HavokPlugin(true, havokModule);
        scene.enablePhysics(new BABYLON.Vector3(0, 0, 0), physicsPlugin);

        // collision‐started event mask
        const COLLISION_STARTED = physicsPlugin._hknp.EventType.COLLISION_STARTED.value;

        // map physics‐body → mesh for lookup in collision handler
        const bodyToMesh = new Map<any, BABYLON.Mesh>();

        function lockRotation(aggr: BABYLON.PhysicsAggregate) {
            aggr.body.setAngularVelocity(BABYLON.Vector3.Zero());
        }

        // ─────────────── Helper: create a billboarded sprite‐mesh ──────────
        function createSprite(
            name: string,
            url: string,
            size: number,
            role: string
        ) {
            const mesh = BABYLON.MeshBuilder.CreatePlane(name, { size }, scene);
            
            // always face the camera
            mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
            mesh.rotation.x = Math.PI / 2;
            mesh.rotation.y = Math.PI;

            // build ONE StandardMaterial that carries both color + alpha
            const mat = new BABYLON.StandardMaterial(`${name}Mat`, scene);

            // load as a “diffuse” so color & alpha both come in
            const tex = new BABYLON.Texture(url, scene);
            tex.hasAlpha = true;

            mat.diffuseTexture = tex;                 // drives color
            mat.opacityTexture = tex;                 // drives alpha
            mat.useAlphaFromDiffuseTexture = true;     // use that alpha
            mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;

            mat.disableLighting = false;             // full‐bright
            mat.backFaceCulling = false;            // show both sides

            mesh.material = mat;
            mesh.metadata = { role };
            return mesh;
        }

        // ─────────────── Player Ship ───────────────────────────────────────
        const player = createSprite('player', 'assets/sprites/playerShip.png', 6, 'player');
        player.position.set(0, 10, 5);
        // physics body on same mesh (box‐shaped)
        const playerAggr = new BABYLON.PhysicsAggregate(
            player,
            BABYLON.PhysicsShapeType.BOX,
            { mass: 0 },
            scene
        );
        playerAggr.body.setMotionType(BABYLON.PhysicsMotionType.ANIMATED);

        bodyToMesh.set(playerAggr.body, player);
        playerAggr.body.setEventMask(COLLISION_STARTED);
        playerAggr.body.getCollisionObservable().add((evt) => {
            //evt.collider; evt.collidedAgainst; evt.collidedAgainstIndex; evt.colliderIndex;
            const other = evt.collider === playerAggr.body ? evt.collidedAgainst : evt.collider;
            const otherMesh = bodyToMesh.get(other);
            if (otherMesh?.metadata.role === 'enemyBullet') {
                // player hit
                state.setValue('lives', (state.data.lives || 0) - 1);
                // dispose bullet
                otherMesh.dispose();
            }
        });

        lockRotation(playerAggr);
        // ─────────────── Enemy Ship ────────────────────────────────────────
        const enemy = createSprite('enemy', 'assets/sprites/enemyShip.png', 24, 'enemy');
        enemy.position.set(0, 10, 95);
        const enemyAggr = new BABYLON.PhysicsAggregate(
            enemy,
            BABYLON.PhysicsShapeType.BOX,
            { mass: 0 },
            scene
        );
        enemyAggr.body.setMotionType(BABYLON.PhysicsMotionType.ANIMATED);

        bodyToMesh.set(enemyAggr.body, enemy);
        enemyAggr.body.setEventMask(COLLISION_STARTED);
        enemyAggr.body.getCollisionObservable().add((evt) => {
            //evt.collider; evt.collidedAgainst; evt.collidedAgainstIndex; evt.colliderIndex;
            const other = evt.collider === enemyAggr.body ? evt.collidedAgainst : evt.collider;
            const otherMesh = bodyToMesh.get(other);
            if (otherMesh?.metadata.role === 'playerBullet') {
                // enemy hit
                state.setValue('score', (state.data.score || 0) + 100);
                otherMesh.dispose();
            }
        });

        lockRotation(enemyAggr);

        // Player ship only collides with enemy bullets:
        playerAggr.shape.filterMembershipMask = COLLISION_GROUPS.PLAYER;
        playerAggr.shape.filterCollideMask = COLLISION_GROUPS.ENEMY_BULLET;

        // Enemy ship only collides with player bullets:
        enemyAggr.shape.filterMembershipMask = COLLISION_GROUPS.ENEMY;
        enemyAggr.shape.filterCollideMask = COLLISION_GROUPS.PLAYER_BULLET;
        // ─────────────── Bullet Pools ─────────────────────────────────────
        type Bullet = {
            mesh: BABYLON.Mesh;
            body: any;
            birth: number;
        };
        const playerBullets: Bullet[] = [];
        const enemyBullets: Bullet[] = [];
        const BULLET_LIFESPAN = 5000; // ms

        /** generic bullet spawner */
        function spawnBullet(
            type: BulletType,
            position: BABYLON.Vector3,
            velocity: BABYLON.Vector3
        ) {
            const cfg = bulletConfigs[type]
            const name = `${type}#${Date.now()}`
            const mesh = sprites.createSprite(name, cfg.url, cfg.size, cfg.role)
            mesh.position.copyFrom(position)

            const aggr = new BABYLON.PhysicsAggregate(
                mesh,
                BABYLON.PhysicsShapeType.BOX,
                { mass: 1, restitution: 1 },
                scene
            )
            aggr.body.setEventMask(COLLISION_STARTED)
            // collisions back to player/enemy handled in their own observers
            aggr.shape.filterMembershipMask = cfg.membership
            aggr.shape.filterCollideMask = cfg.collideWith
            aggr.body.setLinearVelocity(velocity)
            lockRotation(aggr)

            const pool = type === 'player' ? playerBullets : enemyBullets
            pool.push({ mesh, body: aggr.body, birth: performance.now() })
        }

        /** fire a line of enemy bullets */
        function spawnEnemyLine() {
            const cols = 7
            for (let i = 0; i < cols; i++) {
                const x = -((cols - 1) / 2) * 4 + i * 4
                const pos = new BABYLON.Vector3(x, 1, 95)
                spawnBullet('enemy', pos, bulletConfigs.enemy.velocityLine)
            }
            enemyShootSnd.play()
        }

        /** fire an enemy spiral */
        async function spawnEnemySpiral() {
            const count = 24
            const now = Date.now() / 1000

            let delay = (t=3) => {
                return new Promise((res)=>{
                    setTimeout(()=>{
                        res(true);
                    },t);
                })
            }

            for (let i = 0; i < count; i++) {
                const angle = 2 * Math.PI * i / count + now
                const pos = enemy.position.add(new BABYLON.Vector3(0, 1, 0))
                const vel = bulletConfigs.enemy.velocitySpiral(angle)
                spawnBullet('enemy', pos, vel)
                await delay(20);
            }
            enemyShootSnd.play()
        }

        // ─────────────── Input ──────────────────────────────────────────────
        let left = false, right = false;
        keyboard.bind('left', () => (left = true), () => (left = false));
        keyboard.bind('right', () => (right = true), () => (right = false));
        let lastShot = 0;
        keyboard.bind('space', () => {
            const t = performance.now()
            if (t - lastShot > 200) {
                spawnBullet('player', player.position.add(new BABYLON.Vector3(0, 1, 0)),
                    bulletConfigs.player.velocity)
                playerShootSnd.play()
                lastShot = t
            }
        });

        // ─────────────── Main Loop ─────────────────────────────────────────
        let lastLine = 0, lastSpiral = 0;
        scene.onBeforeRenderObservable.add(() => {
            const dt = engine.getDeltaTime() / 1000;
            const now = performance.now();

            // move player
            const speed = 50;
            let dx = (right ? 1 : 0) - (left ? 1 : 0);
            player.position.x = BABYLON.Scalar.Clamp(
                player.position.x + dx * speed * dt,
                -30, 30
            );

            // enemy fire
            if (now - lastLine > 2000) { spawnEnemyLine(); lastLine = now; }
            if (now - lastSpiral > 5000) { spawnEnemySpiral(); lastSpiral = now; }

            // clean up old bullets
            function cleanup(pool: Bullet[]) {
                for (let i = pool.length - 1; i >= 0; i--) {
                    const b = pool[i];
                    if (
                        now - b.birth > BULLET_LIFESPAN ||
                        b.mesh.position.z < -10 ||
                        b.mesh.position.z > 110
                    ) {
                        b.mesh.dispose();
                        pool.splice(i, 1);
                    }
                }
            }
            cleanup(playerBullets);
            cleanup(enemyBullets);
        });

        return scene;
    },

    /** Main menu placeholder scene */
    level2: async (engine, canvas) => {
        const helper = new BatsuganScene(engine, canvas);
        return helper.init();
    },

    /** Core gameplay scene */
    level3: async (engine, canvas) => {
        const scene = new BABYLON.Scene(engine);
        // TODO: set up your game world, entities, controls…
        return scene;
    },

    /** Level transition UI */
    levelTransition: async (engine, canvas) => {
        const scene = new BABYLON.Scene(engine);
        // TODO: animation / fade / loading…
        return scene;
    },

    /** Game over scene */
    gameOver: async (engine, canvas) => {
        const scene = new BABYLON.Scene(engine);
        // TODO: display score, retry button…
        return scene;
    },

    /** Win screen */
    winState: async (engine, canvas) => {
        const scene = new BABYLON.Scene(engine);
        // TODO: confetti, next‐level button…
        return scene;
    },
};

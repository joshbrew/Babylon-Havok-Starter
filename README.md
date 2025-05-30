## Build and run

This project demonstrates Havok Physics and BabylonJS (WebGPU or you can comment in WebGL2 in ui/components/game/renderer/babylonContext.ts) in a lightweight, state-aware and local storage-enabled react application. It handles scene switching for you and other things with a simple state system to sync html UI and game state controls. The build environment is mobile-ready. Controls are only set up for desktop rn. 

With `tinybuild` installed globally (`npm i -g tinybuild`): `npm start`

### [Try it (babylon-havok-starter.netlify.app)](https://babylon-havok-starter.netlify.app/)
<img width="504" alt="knockoff-min (1)" src="https://github.com/user-attachments/assets/5c7240a9-9348-4a63-8ee6-38393fe4ba96" />

This one-off bakugan ripoff uses havok physics objects to govern collisions with simple collision masking. It can be optimized to recycle physics aggregates or thinner instances if spawning thousands of entities. The current implementation can handle a few thousand entities no problem. Another optimization will be to move the entire render system to a thread but it requires replicating the key event system.  

## Configuration

See [`./tinybuild.config.js`](./tinybuild.config.js) for settings. 

Add build:true for build-only, add serve:true for serve-only, or set bundle or server to false alternatively.

Note, you want to change to using core packages and so on to only get the packages you need compiled out of Babylonjs to lower program weight. Ensure HavokPhysics.wasm is present in the dist or otherwise the same level as the importing javascript file as it uses import.meta.url to locate it. (we did it for you in the existing dist)

SFX pack used: https://coffeevalenbat.itch.io/sweet-sounds-sfx-pack

Assets were generated and then compressed/resized/filtered etc, sorry.

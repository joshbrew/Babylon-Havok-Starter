## Build and run

This project demonstrates Havok Physics and BabylonJS in a lightweight, state-aware and local storage-enabled react application. It handles scene switching for you and other things with a simple state system to sync html UI and game state controls. 

With `tinybuild` installed globally (`npm i -g tinybuild`): `npm start`

### [Try it (babylon-havok-starter.netlify.app)](https://babylon-havok-starter.netlify.app/)
<img width="504" alt="knockoff-min (1)" src="https://github.com/user-attachments/assets/5c7240a9-9348-4a63-8ee6-38393fe4ba96" />

## Configuration

See [`./tinybuild.config.js`](./tinybuild.config.js) for settings. 

Add build:true for build-only, add serve:true for serve-only, or set bundle or server to false alternatively.

Note, you want to change to using core packages and so on to only get the packages you need compiled out of Babylonjs to lower program weight.

SFX pack used: https://coffeevalenbat.itch.io/sweet-sounds-sfx-pack

Assets were generated and then compressed/resized/filtered etc, sorry.

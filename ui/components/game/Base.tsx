import React from 'react'
import { sComponent, state } from "../util/state.component";
import { Renderer } from './renderer/Renderer';
import {BabylonContextImpl} from './renderer/babylonContext'
import { MainMenu } from './ui/MainMenu';
import { InGameMenu } from './ui/Playing';

const ctx = new BabylonContextImpl();

export class GameBase extends sComponent {

    state = {
        gameState: "main-menu", //e.g. main-menu, paused, playing, game-menu1..2..3 etc etc
    }
    // __doNotBroadcast = [];

    constructor() {
        super();
    }


    render() {

        const { gameState } = this.state;
        console.log(gameState);

        return (
            <>
                { /* 2D or 3D renderer as base layer. */}
                <div id="renderer" className='renderer'>
                    <Renderer context={ctx} />
                </div>
                { /* HTML UI on top of renderer. */}
                <div id="ui" className="ui">
                    {   
                        gameState === "main-menu" &&
                        <MainMenu />
                    }
                    {
                        (
                            gameState === "playing" || 
                            gameState === "win"     ||
                            gameState === "lose"
                        ) && 
                        <InGameMenu />
                    }
                </div>
            </>
        );
    }

}
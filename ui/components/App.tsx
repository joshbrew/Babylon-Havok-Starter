import React from 'react'
import { sComponent, state } from "./util/state.component";
import { GameBase } from './game/Base';

export class App extends sComponent {

    render() {
        return (
            <>
                <GameBase/>
            </>
        );
    }

}
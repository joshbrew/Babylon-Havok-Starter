import React from 'react'
import { sComponent, state } from "../../util/state.component";

export class MainMenu extends sComponent {

    state = {
        gameState: "", //e.g. main-menu, paused, playing, game-menu1..2..3 etc etc
    }
    __doNotBroadcast = [];

    onStart = () => {
        this.setState({gameState:'begin'});
    }

    render() {
        return (
            <span id="main-menu">
                <button onClick={this.onStart}>Start</button>
                <button>Settings</button>
                <button>Credits</button>
            </span>
        );
    }

}
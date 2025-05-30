import {state} from '../components/util/state.component'

export {state}

export type GameState =
    | 'main-menu'
    | 'begin'
    | 'start'
    | 'playing'
    | 'stop'
    | 'reset'
    | 'clear'
    | string; // allow any custom scene key too

//default game state starts here. these will sync with sComponents in the UI
state.setState({
    gameState: 'main-menu' as GameState | '',
    gameScene: 'level2' as string,
    gameOpts: undefined as Record<string, any> | undefined,
    userId:"player1"
});

//we can back up/restore certain values in simple localStorage (note: uses cache which can clear)
state.useLocalStorage = true;
state.localStorageKeys = [
    "scores", 
    "progress",
    "userId"
    //etc... you can update these on state or on sComponents to sync with UI, etc.
];

//get the previous game state
state.restoreLocalStorage();
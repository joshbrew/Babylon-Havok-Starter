import React from 'react';
import { sComponent } from '../../util/state.component';

export class InGameMenu extends sComponent<{}, {
    gameState: 'main-menu' | 'playing' | 'win' | 'lose' | 'reset',
    playerHP?: number,
    bossHP?: number,
    score?: number,
    lives?: number
}> {
    state = {
        gameState: 'playing',
        playerHP: undefined as number | undefined,
        bossHP: undefined as number | undefined,
        score: undefined as number | undefined,
        lives: undefined as number | undefined
    };
    __doNotBroadcast = [];

    onExit = () => {
        this.setState({ gameState: 'main-menu' });
    }

    onReset = () => {
        this.setState({ gameState: 'reset' });
    }

    render() {
        const {
            gameState,
            playerHP = 0,
            bossHP = 0,
            score = 0,
            lives = 0
        } = this.state;

        // Overlay for win/lose
        const isEndState = gameState === 'win' || gameState === 'lose';

        return (
            <div id="play-menu" className="ingame-menu">
                <button
                    className="ingame-menu__exit-button"
                    onClick={this.onExit}
                >
                    X
                </button>

                <div className="ingame-menu__stats">
                    {/* Boss HP (top-left) */}
                    <div className="stat stat--hp stat--boss">
                        <label className="stat__label">Boss HP</label>
                        <progress
                            className="stat__progress stat__progress--boss"
                            max={100}
                            value={bossHP}
                        />
                    </div>

                    {/* Player HP (bottom-right) */}
                    <div className="stat stat--hp stat--player">
                        <label className="stat__label">Player HP</label>
                        <progress
                            className="stat__progress stat__progress--player"
                            max={100}
                            value={playerHP}
                        />
                    </div>

                    {/* Score (just above Lives) */}
                    <div className="stat stat--score">
                        <span className="stat__label">Score:</span>
                        <span className="stat__value stat__value--score">{score}</span>
                    </div>

                    {/* Lives (bottom-right) */}
                    <div className="stat stat--lives">
                        <span className="stat__label">Lives:</span>
                        <span className="stat__value stat__value--lives">{lives}</span>
                    </div>
                </div>

                {isEndState && (
                    <div className="ingame-menu__end-overlay">
                        <h2 className="ingame-menu__end-title">
                            {gameState === 'win' ? 'You Win!' : 'Game Over'}
                        </h2>
                        <button
                            className="ingame-menu__reset-button"
                            onClick={this.onReset}
                        >
                            Reset
                        </button>
                    </div>
                )}
            </div>

        );
    }
}

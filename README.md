**PhysTrix** is a chaotic Tetris-like stacker built around the moment a clean stack **stops being stable**.

It's like playing **that one game**, with all of its modern controls and mechanics, as seen in games like TETR.IO and Tetris Effect: Connected, until the moment of chaos: **everything is affected by gravity**. Wrong stack? It will collapse. But you have well balanced control. And your Tetris skills will - mostly, kinda, maybe - transfer here! 

Until the point you realise everything happens in real time and you must soft-drop your T to **block something from falling**, and then just rotate it in a slot for a **glorified T-SPIN Double**... only for that unstable stack to become the next disaster.

PhysTrix's basic control and handling is following the modern standards *(from that one 2009 document)*. Place, soft-drop, hard 
drop, hold & take, SRS, kicks, special spins, but that's where its Tetris roots end. You have tetrominos, pentominos, polyominoes 
of any order, and our **custom rotation and kick system** handles any polyomino it can. (And yes, we use SRS for tetrominoes!) 

And then here comes the gravity. Gravity, yes, we have 2 gravity modes. Grid-based gravity as seen in some Tetris variants and DR. Mario, and actual physics based gravity - where polyominos have their friction, bouncineess, mass, and the whole stack can collapse, forcing you to play in a very different stacking style.

It is fast, messy, experimental, funny and built for players who enjoy making a plan just before gravity ruins it.

## Features

- Physics presets: Balanced, Slippery, Rubber, and Static
- Classic mode through the Static preset, but this one also have gravity.
- Tetrominoes, pentominoes, and higher-order polyominoes in Hard mode
- Hold, next queue, soft drop, hard drop, 180 rotations, spins, combos, and scoring
- Physics line scans with combo chain system. Line clear, fall, Combo line clear!
- Keyboard and standard gamepad support

## Run locally

Use any localhost server to serve the game folder. Node is not required. The `server.js` is provided for my local tests.

```bat
start-server.bat
```

```sh
npm start
```

Open [http://localhost:8080/](http://localhost:8080/).

The game must be served through a server. Opening `index.html` directly with `file://` prevents browser modules and CDN resources from loading correctly.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | Left / Right Arrow | D-pad Left / Right |
| Soft drop | Down Arrow | D-pad Down |
| Hard drop | Space | D-pad Up |
| Rotate left | `Z` | A |
| Rotate right | Up Arrow or `X` | B |
| Rotate 180 | `A` | Y |
| Hold | Shift | RB / RT |
| Physics release | `C` or `V` | X |
| Pause | `P` | Start |
| Start or restart | Enter | Start |

`C` is reserved for release during Physics mode. Use Shift for keyboard hold there.

## Modes

### Physics presets

- Balanced: standard physics material values.
- Slippery: low-friction bodies.
- Rubber: high bounce bodies.
- Static: classic board-backed play without falling-body simulation.

### Polyomino sets

- Tetrominos only - you may have pattern memory on this.
- Tetro and Pentaminos - balanced with some extras
- Pentaminos only - yes, only pentaminos.
- Hard mode with orders 4 through 8 - that have some challenging shapes.

## Project files

- `index.html`: browser entry page.
- `main.js`: application bootstrap.
- `app/`: persistent Pixi app shell, scenes, session state, and hash routing.
- `game/`, `gameplay/`: game state, controls, scoring, pieces, rotations, and gameplay modes.
- `physics/`: Box2D world, line scanning, vanishing, and fracture handling.
- `render/`, `ui/`, `audio/`: Pixi rendering, HUD, effects, shaders, and generated sound.
- `config/`: gameplay, UI, effect, color, control, and skin configuration.
- `minoskins/`: JSON shader skin settings.
- `server.js`: local static file server on port 8080 for testing

## Notes

PhysTrix is currently designed for desktop browsers. 

Tetris is a trademark of The Tetris Company. PhysTrix is an unofficial personal fan project.

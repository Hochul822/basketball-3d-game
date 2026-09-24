# STREET 3ON3 🏀

A 3D street-basketball game with toon shading, built with Three.js. Two teams of three play half-court: first to 21 wins (or whoever leads when the 4-minute clock runs out).

## Running it

### Quickest: a single HTML file
Download **`street-3on3.html`** from the repo root and double-click it. It opens in your browser and runs as-is, with no server or install.
(Everything, including Three.js, is inlined in that one file. Without an internet connection only the Google Fonts are missing, and the game still plays normally.)

To regenerate the file after changing the code:
```bash
npm run build:single   # → street-3on3.html (also dist/street-3on3.html)
```

### Development server
```bash
npm install
npm run dev      # development server (http://localhost:5173)
npm run build    # production build → dist/
npm run preview  # serve the build
```

URL options:
- `?demo=1` starts CPU vs CPU spectator mode.
- `?q=high|mid|low` sets graphics quality. The default is `high` on desktop and `mid` on touch devices.

## Controls

| Key | On offense | On defense |
| --- | --- | --- |
| WASD / arrow keys | Move | Move |
| Shift | Sprint | Sprint |
| J | Jump shot: hold, then release at the top of the jump for a **PERFECT**. Driving to the rim turns it into a layup or dunk. | Block (jump) |
| K | Pass (steer toward a teammate with the direction keys) | Steal |
| L | Alley-oop pass | Block |
| Q / R / C / E / F | Crossover / behind-the-back / between-the-legs / spin move / step-back | – |
| Space | **Special move** (needs a full gauge) | **Special defense** |
| Tab | – | Switch to another defender |
| P / Esc, M, H | Pause, music on/off, controls help | |

On touch devices you get a virtual joystick and on-screen buttons.

### Tutorial
The first time you press PLAY, a tutorial starts automatically. It teaches movement, sprinting, the five dribble moves, jump shots, layups and dunks, passing, alley-oops, steals, blocks and special moves in 14 steps. The `Skip tutorial` button in the bottom right jumps straight into a game, and you can replay the tutorial anytime from the title screen's **Tutorial** button. (Whether you've finished it is stored in the browser's localStorage.)

### Special moves (full STREET POWER gauge)
- **METEOR SLAM**: a long-range flying windmill 360° dunk. Includes slow motion, a flaming ball, lightning, a floor shockwave and crack, and knocks nearby defenders down.
- **ANKLE BREAKER**: a three-move combo (crossover, behind-the-back, crossover) with afterimages. The nearest defender falls.
- **SUPERNOVA SHOT**: a very high jump shot with an energy trail and fireworks. It always goes in.
- **PICKPOCKET / SKY WALL** (defense): a dash steal, or a guaranteed super block.

The gauge fills from made baskets, dunks, ankle breakers, steals and blocks.

### Rules
- Baskets are 2 points inside the arc and 3 points outside it.
- After a change of possession (defensive rebound or steal), you have to **CLEAR**: take the ball outside the arc before a basket counts.
- 12-second shot clock. After every made basket there's a check ball at the top of the key.

## Technical overview

| File | Contents |
| --- | --- |
| `src/character.js` | Procedural character rig with long limbs (lathe and rounded geometry, fingers, faces, hair styles) and analytic two-bone leg IK that keeps the feet planted |
| `src/player.js` | Locomotion (phase-based gait, arm swing, dribbling), pose blending, movement physics |
| `src/actions.js` | All moves as keyframes with Hermite/Catmull-Rom interpolation. Each move is authored for the right hand and mirrored automatically for the left. |
| `src/ball.js` | Ball physics (rim torus, backboard, pole, net), dribble and hand-to-hand transfer trajectories |
| `src/game.js` | Rules, possession, shot success, blocks and steals, specials, camera direction |
| `src/ai.js` | Offense (drive, shot selection, dribble moves, passing lanes, alley-oops), man-to-man defense, rebounding |
| `src/effects.js` | GPU particles, ribbon trails, shockwaves, lightning, afterimages, screen FX (chromatic aberration, zoom blur, speed lines) |
| `src/toon.js` | Cel-shading material with a rim light, and inverted-hull outlines |
| `src/court.js` | Street court at dusk: graffiti wall, chain-link fence, street lights, city skyline, crowd, physics-driven net |
| `src/tutorial.js` | Step-by-step tutorial (court setup, completion checks, drills, ball reset) |
| `src/audio.js` | All sound effects and the boom-bap BGM, synthesized with Web Audio |

No external assets: every texture, model and sound is generated procedurally.

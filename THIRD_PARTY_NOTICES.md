# Third-party notices

This project (GPL-3.0, see `LICENSE`) includes code adapted from the following MIT-licensed project.

## threejs-water / WebGL Water

- Source: https://github.com/jeantimex/threejs-water (port of Evan Wallace's WebGL Water, http://madebyevan.com/webgl-water/)
- Adapted in:
  - `src/render/ocean/sim.js` (from `src/Water.ts`)
  - `src/render/ocean/shaders/step.frag.glsl`, `drop.frag.glsl`, `normal.frag.glsl`, `box.frag.glsl`,
    `fullscreen.vert.glsl` (from `WaveSimulation`, `WaterRipple`, `WaterNormal`, `BoxDisplacement` shaders)
  - `src/render/ocean/ultra/caustics.js` and `shaders/caustics.*.glsl` (from `CausticsPass.ts`, `Caustics.*`)
  - `src/render/ocean/ultra/objectPasses.js` (from `ObjectTexturePass.ts`)
  - `src/render/ocean/ultra/shaders/surface.frag.glsl` (from `WaterAbove.frag`)

```
MIT License

Original work Copyright (c) 2011 Evan Wallace
Modified work Copyright (c) 2026 Yong Su

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## three.js

- https://github.com/mrdoob/three.js — MIT License, Copyright © 2010-2026 three.js authors. Bundled from npm.

## @p3p2/client and lean-qr

- https://github.com/doublependu/p3p2 (`client/`) — MIT License, Copyright (c) 2026 Man & Bot. Bundled from npm; it
  loads the room client, the panel and the QR code only when a room is opened.
- The QR code is drawn by lean-qr (https://github.com/davidje13/lean-qr), bundled into the client's `p3p2-qr` chunk —
  MIT License, Copyright (c) 2021-2025 David Evans.

Both under the MIT licence text quoted above for threejs-water, with their own copyright lines.

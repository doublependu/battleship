
Make a classic battleship game in the browser, human vs AI: 

Use this as a reference: https://en.wikipedia.org/wiki/Battleship_(game)

Use 3D rendering with three.js

Use real water: https://github.com/jeantimex/threejs-water
You can decide on whether to use this water implementation as is or adapt it to the game

Create 3D battleship models that move slightly with the wave

Create visual effect that show explosions on battleships and the ultimate sinking and destruction of ships


# General

- Loading page and pause screen should have a "fork me on github" link to encourage adaptation
- For now, the project should be deployed as a static website
- Prepare the project to deploy on cloudflare using wrangler with preview url = false
- Show the game's version in an unused corner of the game. 
    - template: "v.<first 4 letters of the deployed git commit>"
- If the project allows, use responsive design and make sure to use the full screen on both PC and mobile with different screen sizes and aspect ratios
    - mobile: mid-game, transition between horizontal and vertical screen should work without incorrect scaling
    - mobile: if possible, should stop touch-based zooms that the user can't zoom back out
- Should write scripts to play the game as a human player
    - make sure the game is balanced and fun for a human player
    - record the gameplay for reference but don't commit the recordings
    - use this to improve the gameplay and reduce bugs


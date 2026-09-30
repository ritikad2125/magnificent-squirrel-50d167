# 🎨 Paint Militia

A jetpack paint-blaster party game (Mini Militia style) for 2–8 players, each on their own phone or computer. It runs entirely on Netlify: static files plus one Netlify Function backed by Netlify Blobs.

## Publish it (no Git, no terminal)
1. Log in at https://app.netlify.com. You must be logged in, because that's what makes Netlify build the project.
2. Open **Netlify Drop** (https://app.netlify.com/drop), or go to **Sites → Add new site → Deploy manually**.
3. Drag **`netlify-ready-game.zip`** (or the unzipped folder) onto the drop zone.
4. Netlify installs dependencies, type-checks, bundles the function, and publishes. Open the site URL when it's done.

Netlify Blobs is set up automatically for the function, so there's no database, API key, or environment variable to configure.

## Play
1. One person taps **Create Room** and gets a 4-letter code.
2. Everyone else opens the site and enters the code, or opens the `…/?room=CODE` link shown in the lobby. They tap **Join**, then **I'm Ready!**
3. The host taps **Start Match**.

**Phones:** the left stick moves (push up to fly the jetpack), and the right stick aims and fires.
**Keyboard:** A/D move, W or Space jetpack, mouse aims and fires.

## Rules
- 100 HP, which regenerates after 4 seconds without being hit. Respawn after 3 seconds, with 2 seconds of spawn protection.
- +1 per splat. −1 for falling in the river or splatting yourself.
- A match ends after 5 minutes, or when someone reaches 20 splats.
- Ties are broken by fewer times splatted, then by more splats.
- Weapons: Splat Rifle, Blob Shotgun, Sniper Squirter, Balloon Launcher. Juice boxes heal 50 HP. Pickups respawn after 15 seconds.

## How it works
| Part | File |
|---|---|
| Game page, art, controls | `public/index.html`, `public/style.css`, `public/art.js`, `public/game.js` |
| Rules and physics shared by browser and function | `public/shared.js` |
| Netlify Function (called at `/.netlify/functions/game`) | `netlify/functions/game.ts` |
| Referee logic | `lib/game-server.ts` |

- **Each device runs its own player** (movement, jetpack, bullets), so controls feel instant.
- **Every device syncs with the function about 10 times a second.** Each sync posts its position and shots and gets everyone else's.
- **Remote players are smoothed.** Other players are drawn from a short buffer, about a quarter-second behind real time.
- **The function is the referee.** It decides hits, splats, pickups, respawns, scores, and the match clock.
- **Room state lives in one Netlify Blobs entry.**
  - Reads use strong consistency.
  - Every change is an ETag-conditional write (`onlyIfMatch`), retried if another player wrote first, so simultaneous hits and pickups are never lost or double-counted.
  - New rooms use `onlyIfNew`, so two rooms can never share a code.

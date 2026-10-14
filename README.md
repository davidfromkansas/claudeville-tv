# Claudeville TV

A Twitch-style viewer for Claude playing SimCity 2000 (Claudeville 3).

- Plain static files: `index.html`, `style.css`, `app.js`. No build step.
- Reads the game bot's live data from the existing GitHub Pages site:
  `/claude-simcity2000/claudeville-3/` (`attempts.json` and each `attempt-N/` folder).
- Re-checks the data every 60 seconds, so new moves, numbers, screenshots, recordings and attempts appear on their own.
- Each attempt has its own link: `#/attempt/3`.
- To read data from somewhere else, add `?data=<url of the claudeville-3 folder>`.

Meant to be served from a repo on the same `davidfromkansas.github.io` site (for example `/claudeville-tv/`).

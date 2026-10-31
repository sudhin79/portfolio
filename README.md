# Lights On

Sudhin Swain's portfolio: a playable Mumbai night where every lit window is a running container, every car on the Sea Link is a request, and visitors try to break the system badly enough to wake him up.

No frameworks, build step or trackers.

Live at **https://sudhin79.github.io/portfolio/**

## Run it

Open `site/index.html` directly, or:

```bash
python3 -m http.server 8000 -d site        # http://localhost:8000
docker build -t lights-on . && docker run --rm -p 8080:8080 lights-on   # http://localhost:8080
```

## Deploy

Push to a GitHub repo and set Settings > Pages > Source to "GitHub Actions". `.github/workflows/pages.yml` publishes the `site/` folder on each push to `main`.

## Where things are

| File | What it does |
| --- | --- |
| `site/index.html` | All the words, including the résumé (one source for the dialog and the printed PDF) |
| `site/js/sim.js` | The simulation: pods, nodes, autoscaler, faults, alerting, and the text explaining each failure |
| `site/js/city.js` | Draws the city on a canvas from the simulation state |
| `site/js/main.js` | Connects scrolling, panels, the pipeline demo and the résumé |
| `site/css/styles.css` | Styling and the print résumé |
| `site/js/game.js` | "Now you hold the pager": the incidents, answers and scoring |
| `site/js/flows.js` | The animated project diagrams |
| `site/js/audio.js` | Optional sound, all synthesised |
| `site/js/night.js` | Achievements and the personal handover note. Kept in memory only |

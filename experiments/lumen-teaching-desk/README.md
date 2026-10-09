# Teaching desk — Lumen UI experiment

An isolated, responsive secondary dashboard using Lumen Elements 4.0.0. Open it through the **new UI BETTA** button at the top of the main dashboard. The main dashboard remains the default; its backend and behavior are unchanged. All names, classes and lesson content here are fictional sample data.

Open `index.html` through a local HTTP server. From this folder: `python3 -m http.server 4188 --bind 127.0.0.1`, then visit http://127.0.0.1:4188.

Try class switching, student search, attendance status cycling, bulk attendance, participation points, notes, lesson completion, focus mode, week planner, and saved lessons. Command/Ctrl+S saves the selected lesson. Escape exits focus mode.

Drafts persist in localStorage under `lumen-teaching-desk-experiment-v1`, separate from the current app. There are no backend requests or production credentials. Reloading retains drafts. To reset the experiment, remove only that localStorage key.

To rebuild after editing: `pnpm install --ignore-scripts`, then `node build.mjs`. The compiled `dist/` files are self-contained; no external CDN is required at runtime.

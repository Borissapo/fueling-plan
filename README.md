# Weekly Fueling Plan — PWA

A Progressive Web App that renders your weekly cycling fueling plan from a simple JSON file. Installable on your phone's home screen, works offline, auto-deploys via Vercel.

## Quick Start

### 1. Push to GitHub

```bash
cd fueling-plan-pwa
git init
git add .
git commit -m "initial fueling plan PWA"
git remote add origin https://github.com/YOUR_USERNAME/fueling-plan.git
git push -u origin main
```

### 2. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub.
2. Click **Add New → Project** and import your `fueling-plan` repo.
3. Framework Preset: **Other** (it's a static site, no build step).
4. Click **Deploy**.
5. You'll get a URL like `fueling-plan.vercel.app` — that's your app.

### 3. Install on your phone

Open the Vercel URL in Safari (iOS) or Chrome (Android):
- **iOS:** tap the Share button → "Add to Home Screen"
- **Android:** tap the three-dot menu → "Install app" (or the install banner)

## Updating your plan

Edit `data/plan.json` and push to GitHub. Vercel auto-deploys in ~10 seconds.

### What to change each week

1. Update `meta.weekLabel` to the new date range.
2. Replace the `days` array with the new week's sessions.
3. For completed days, set `status: "done"` and fill in actual power data under `power.source: "actual"`.
4. For planned days, set `power.source: "estimate"` with `intensityFactor` and `durationSec`.
5. Update `changelog` with what changed.

### JSON structure cheat sheet

```
meta.ftp           → your current FTP in watts
meta.weight        → working weight in kg
meta.offBikeBaseline → non-exercise TDEE in kcal
meta.deficitPerDay → target daily deficit in kcal

days[].date        → "YYYY-MM-DD"
days[].type        → "rest" | "easy" | "hard"
days[].status      → "done" | "today" | "upcoming"
days[].macros      → { kcal, carbs, protein, fat }
days[].power       → { source: "actual"|"estimate", avgWatts, durationSec, rideKcal, intensityFactor }
days[].fuel        → { title, rows: [{ label, text }] }
days[].meals       → { label, items: ["..."] }
days[].preload     → { label, items: ["..."] }
```

## TrainingPeaks API (future)

The app includes a placeholder for direct TP API integration. When ready:

1. Register at [TrainingPeaks Developer](https://developer.trainingpeaks.com/)
2. Get a `clientId` and set a `redirectUri` (your Vercel URL + `/tp-callback`)
3. Update `plan.json`:
   ```json
   "trainingPeaks": {
     "enabled": true,
     "clientId": "YOUR_CLIENT_ID",
     "redirectUri": "https://your-app.vercel.app/tp-callback"
   }
   ```
4. The OAuth flow and workout fetching will need to be implemented in `index.html` — the structure is already scaffolded in the `refreshTP()` function.

## Features

- Reads all plan data from a single `plan.json` file
- Auto-highlights today's card and scrolls to it
- Power-based calorie costing with actual vs. estimated ride data
- Dark mode support (follows system preference)
- PWA: installable, works offline via service worker
- Mobile-first responsive layout
- No build step, no dependencies, no framework

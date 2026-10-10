# ColdRoute SG — dispatcher console (frontend)

A single-screen dispatcher console for planning one cold-chain van run in Singapore. The flow is:
**draft the run → optimise → read why → dispatch**.

## Screenshots

| Draft: input | Optimised: results |
| --- | --- |
| ![Input](docs/screenshots/01-input.png) | ![Results](docs/screenshots/02-results.png) |
| **Compare view and stop card** | **Map-first layout** |
| ![Compare](docs/screenshots/03-compare-stop-card.png) | ![Map-first](docs/screenshots/04-map-first.png) |
| **Dark mode** | |
| ![Dark](docs/screenshots/05-dark.png) | |

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production bundle in dist/
npm run preview    # serve dist/ on http://localhost:4173
```

No API key is needed. Basemap tiles come from CARTO (Positron and Dark Matter), repainted with the theme's land, water and park colours at load time.

## What the demo shows

| Area | What it does |
| --- | --- |
| Input panel | Departure time, depot, optimisation profile (Pharma, Balanced, Fastest), address search with a mocked OneMap lookup, inline editing of time window, unloading time and cargo class, and an ambiguous-address resolver. |
| Optimising | A short, staged progress list for the five data sources, then the result. `⌘↵` runs it. |
| Results panel | Four KPIs, each compared with the shortest route. Also a plain-language "Why this route" summary and the stop order with W/P/T/C/L risk meters and how far each stop moved. |
| Map | Numbered stops, a route drawn on real roads, a hatched shower cell and carparks with walking links. Optional layers show slow road segments and the shortest route as a ghost. The highest-risk stop pulses. |
| Stop card | Click any stop: ETA, window, unloading time, a "Why here" explanation, and every risk factor compared with the shortest route. |
| Timeline | Delivery windows, unloading blocks, waits, lateness and the shower period on one time axis. In Compare view it also shows the shortest route as ghost blocks. |

Three views: **ColdRoute**, **Shortest route**, and **Compare**. Switching views redraws the map, list and timeline.

## Design system

The brand colour is **Safety Orange** on warm paper, the high-vis orange used across logistics. Other colours only appear where they carry meaning:

| Role | Light | Used for |
| --- | --- | --- |
| Brand | `#d3460a` | Primary buttons, stop numbers, unloading blocks, selection. 4.52:1 contrast with white text (WCAG AA). |
| Route | `#ec5d13` | The ColdRoute line on the map. Brighter than the brand colour so it reads on map tiles. |
| Green (`ok`) | `#079455` | Improvements vs the shortest route, on time, live data |
| Amber (`warn`) | `#ca8504` | Medium risk, addresses that need review. Yellow-amber, so it is not confused with the brand orange. |
| Rose (`bad`) | `#e31b54` | Late, highest-risk stop, slow traffic. Rose rather than red, for the same reason. |
| Blue (`rain`) | `#2e90fa` | Shower cells on the map and in the timeline |
| Cargo dots | violet, blue, cyan | PHARMA, FROZEN, CHILLED |

Dark mode (**Night Shift**) uses warm charcoal with a brighter orange (`#ff7a33`) and dark text on orange buttons.

Use **View** in the top bar to switch appearance and layout, or set them in the URL: `?theme=dark` and `?layout=float` (map-first with floating panels). The same menu can jump straight to the input or results state for demos.

Both themes live in `src/lib/themes.ts`, with the UI tokens and the matching map palette in one place. `applyTheme()` writes the tokens to `<html>` as CSS variables before first paint. Components only use semantic utilities (`bg-panel`, `text-fg-2`, `bg-brand`, `text-ok`, `bg-bad-soft`, …). The other palettes explored earlier (teal, glacier blue, indigo, mono) are in commit `94abb12`.

## Data and algorithm

- `src/data/osrm.json` is a snapshot of a real driving-time matrix and per-leg road geometry from the public OSRM server. It covers the depot, the 7 sample stops and the 3 address-book entries. Run `npm run data:osrm` to refresh it.
- `src/lib/optimizer.ts` enumerates every stop order: 5,040 for 7 stops, about 60 ms for 8. It returns two plans. The **baseline** minimises drive time only. The **recommended** plan minimises a weighted cost of drive time, weather, parking, traffic, cold-chain exposure and lateness, using the profile's weights.
- `src/lib/explain.ts` turns the difference between the two plans into the summary and "Why here" text.
- Weather, parking and traffic values are mocked in `src/data/sample.ts`. The shapes match the backend's `/api/data/*` responses, so moving to live data only changes where the values come from. The UI stays the same.

## Structure

```text
src/
├─ App.tsx                 state machine (draft → optimising → optimised), layouts, shortcuts
├─ index.css               design tokens and themes
├─ components/
│  ├─ Shell.tsx            nav rail, top bar, brand
│  ├─ StopsEditor.tsx      input panel and optimising progress
│  ├─ ResultsPanel.tsx     KPIs, explanation, stop order
│  ├─ MapView.tsx          MapLibre map, overlays, markers, layer chips
│  ├─ StopCard.tsx         stop detail card on the map
│  ├─ Timeline.tsx         time-axis view
│  ├─ StyleMenu.tsx        View menu: appearance, layout, demo states
│  └─ ui.tsx               buttons, segmented control, tags, meters
├─ lib/                    optimizer, explanations, time helpers, types
└─ data/                   sample run, OSRM snapshot
```

## Notes

- MapLibre v6 ships an ES-module worker. `MapView.tsx` sets its URL explicitly. `vite.config.ts` emits it as `.js`, so static hosts such as Amplify serve it with a JavaScript MIME type.
- MapLibre's stylesheet is unlayered, so it overrides Tailwind's layered utilities. That is why the map container is positioned with an inline style.

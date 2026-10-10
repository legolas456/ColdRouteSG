# Brand and visuals

Use this for anything visual outside the app: slides, posters, report figures, images, videos. Inside the app, [`../frontend/AGENTS.md`](../frontend/AGENTS.md) and `frontend/src/lib/themes.ts` are the source of truth. If they change, update this page.

## Name and voice

- Write **ColdRoute SG**. "ColdRoute" on its own is fine once the context is clear. Never "Coldroute" or "Cold Route".
- Tagline: *Plan cold. Arrive on time. Explain every route.*
- Voice: calm, precise, plain English. Talk about outcomes ("0 late deliveries, 8 extra minutes"), not algorithms. Avoid hype.

## Logo

`frontend/public/favicon.svg`: a white route line from a filled start dot to an open end ring, on a Safety Orange rounded square. Keep it on light or dark neutrals. Don't recolour it or add effects.

## Colour

The palette is warm neutrals plus one brand colour. Colour carries meaning, so don't use it as decoration.

| Role | Light | Dark | Use for |
| --- | --- | --- | --- |
| Brand (Safety Orange) | `#d3460a` | `#ff7a33` | Logo, primary action, the ColdRoute route, stop numbers |
| Brand soft | `#fef1e8` | `rgba(255,122,51,0.13)` | Highlight panels such as "Why this route" |
| Background | `#f8f7f5` | `#12110f` | Page |
| Panel | `#ffffff` | `#1a1816` | Cards, panels |
| Text | `#1c1917` / `#57534e` / `#78716c` | `#f2efea` / `#b8b2aa` / `#8a847c` | Primary / secondary / tertiary |
| Border | `#ece9e4` | `rgba(255,255,255,0.07)` | Dividers, card edges |
| Good | `#079455` | `#47cd89` | Improvements, on-time |
| Warning | `#ca8504` | `#fac515` | Watch-outs |
| Bad | `#e31b54` | `#fd6f8e` | Late, highest risk; use sparingly |
| Rain | `#2e90fa` | `#53b1fd` | Shower cells, rain periods |
| Cargo: Pharma | `#7a5af8` | `#9b8afb` | Cargo tags |
| Cargo: Frozen | `#2e90fa` | `#53b1fd` | Cargo tags |
| Cargo: Chilled | `#06aed4` | `#67e3f9` | Cargo tags |

The shortest route is always neutral grey and dashed, so ColdRoute is the only orange line. The neutrals were adapted from the Manus web app tokens, warmed slightly.

## Type

| Role | Font | Use |
| --- | --- | --- |
| Display | Libre Baskerville (fallback Georgia) | Titles, big KPI numbers |
| Text | System sans: SF Pro / Segoe UI (fallback Helvetica, Arial) | Everything else |
| Data | SF Mono (fallback JetBrains Mono, Menlo) | Times, distances, small uppercase labels |

Numbers use tabular figures so times line up.

## Imagery

- Prefer **real screenshots** from `frontend/docs/screenshots/` (or fresh ones from `npm run dev`) over generated UI mock-ups.
- Maps show Singapore only, on a quiet grey basemap.
- For illustrations: flat, light background, one orange accent, thin lines. Avoid stock-photo trucks, neon and gradients.
- Use real Singapore place names from the demo run (NUH, Holland Village, AMK Hub, Woodlands Health Campus, Tampines Mall, MBFC Tower 3, Tanjong Pagar, Jurong depot).

## Slides and video

- Background `#f8f7f5` or white, Libre Baskerville titles, at most one orange highlight per slide.
- Lead with the comparison: ColdRoute vs the shortest route, with the numbers.
- Label anything mocked or simulated.

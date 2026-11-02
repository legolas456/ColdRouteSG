# AGENTS.md: frontend

Rules for anyone changing `frontend/`, people and AI coding agents alike. The goal is one consistent product: it should look as if one designer made every screen. When a rule here and your instinct disagree, follow the rule or change it in this file first.

## Stack and commands

React 19, TypeScript (strict), Vite 8, Tailwind CSS 4, MapLibre GL 6, lucide-react icons, clsx. Node ≥ 20.19 (`.nvmrc` pins 22).

```bash
npm run dev          # http://localhost:5173 (?state=results opens on the optimised run)
npm run build        # tsc -b + vite build; must pass before you push
npm run typecheck
npm run data:osrm    # re-fetch road geometry and drive times into src/data
npm run data:sg-mask # re-fetch the Singapore outline used to dim the neighbours
```

## Where things live

| Path | What |
| --- | --- |
| `src/App.tsx` | The state machine (draft → optimising → optimised), layout, theme, account, sharing, shortcuts. Components are controlled from here. |
| `src/components/ui.tsx` | Shared primitives: `Button`, `IconButton`, `Segmented`, `Tag`, `StatusPill`, `CargoTag`, `Kbd`, `Divider`. Reuse them before writing new ones. |
| `src/components/Pickers.tsx` | `TimePicker` and `MinutesPicker`: pick-or-type fields for times of day and durations. |
| `src/components/*` | One main component per file, PascalCase. |
| `src/index.css` | Tailwind setup, design tokens, the few global classes (`num`, `eyebrow`, `scroll-thin`). |
| `src/lib/themes.ts` | Light and dark token values, plus the map palette for each. |
| `src/lib/types.ts` | Shared types. Keep these shapes when wiring the backend. |
| `src/data/` | The sample run (a recorded rainy morning) and snapshots: OSRM roads, HDB carpark coordinates, NEA areas, the Singapore mask. |

## Design rules

### Colour

- **Tokens only.** Use the Tailwind colours mapped to tokens (`bg-panel`, `bg-subtle`, `bg-hover`, `text-fg` / `fg-2` / `fg-3` / `fg-4`, `border-line`, `brand`, `ok`, `warn`, `bad`, `rain`). No hex values in components. New colours go into `themes.ts` for both light and dark.
- **Colour carries meaning, never decoration.**

| Colour | Means |
| --- | --- |
| Brand orange | Actions, selection, the ColdRoute plan |
| Green `ok` | Better than the shortest route, on time, live data |
| Amber `warn` | Medium risk, needs review |
| Rose `bad` | Late, high risk, slow traffic |
| Blue `rain` | Rain |
| Violet, blue, cyan | Cargo: pharma, frozen, chilled (dots only) |

- Text must meet WCAG AA. White on brand is 4.52:1; don't lighten the brand.

### Buttons and actions

- **One solid primary per screen.** Draft: **Optimise route**. Optimised: **Dispatch to driver**. Shared view: **Make a copy**.
- `Button` variants: `primary` (that one action), `tonal` (the panel's main action when the screen already has a primary, e.g. **Re-optimise**), `secondary` (default), `ghost` (quiet toolbar actions). Sizes: `md` (32 px) and `sm` (28 px).
- **Placement.** Run-level actions (Share, Dispatch) go in the top bar. Plan-level actions (Optimise, Re-optimise, Edit stops) go at the top of the panel, under the title. The bottom of the panel is only for the account. Don't add sticky action footers.

### Switches and controls

- **One switch style.** Choosing one of 2–4 options is always `Segmented`: the optimisation profile, the route view, the data mode, Plan / Timeline on phones. Each option is its own outlined button and the chosen one is filled (brand-soft with a brand ring), so it reads as clickable. Options may carry an icon; icons hide on a narrow panel. Don't build tabs, underline tabs or pill variants.
- **Pick, don't make people type.** Times use `TimePicker` (15-minute slots, a closing time lists only later slots with "+2 h" hints) and durations use `MinutesPicker` (common values, then **Custom…**). Typing stays as a shortcut. Lists render in a portal so the panel never clips them; on touch screens time lists open without the keyboard.
- Map layers use the existing layer chips in `MapView.tsx`.
- Every control needs a hover state, a pressed state and a visible keyboard focus ring. The global `:focus-visible` style handles the ring, so don't remove outlines.

### Typography

| Use | Style |
| --- | --- |
| Run title | `font-serif` 26 px |
| KPI numbers | `font-serif` 30 px |
| Body | Sans 13 px |
| Secondary text | 12 / 11.5 px, `text-fg-3` |
| Tags | 10.5 px |
| Times, distances, counts | `num` (monospaced, tabular) |
| Small uppercase labels | `eyebrow` |

Serif is only for titles and big numbers. Don't add new sizes for one-off cases.

### Spacing, shape, icons

- Panel content uses `px-5`. Spacing follows a 4 px grid; gaps are usually 8, 12 or 16 px.
- Radii: `rounded-control` for buttons and inputs, `rounded-panel` for cards, `rounded-full` for pills and avatars. Shadows: `shadow-card` or `shadow-float` only.
- Icons come from lucide-react only: 14 px with stroke 1.8 in buttons, 12 px in chips.

### Writing

- Plain English, sentence case, short. Say what happens, not the internal score: "Unloads in rain", not "W 0.8".
- Times are 24-hour (`09:05`). Use `·` as the separator. Name the data source when it builds trust (NEA, LTA, HDB · URA, OneMap, OSRM).
- Labels must fit. When space runs out, shorten the label (e.g. "Shortest" on a narrow panel) or truncate it with a `title` tooltip. Never let a button or tab wrap onto two lines.

### Layout and themes

- Desktop (≥ 768 px): panel on the left (340–600 px, resizable, can be hidden), map and timeline on the right. Phone: full-screen map with a bottom sheet.
- Both layouts render the same components. `App.tsx` picks the arrangement; small differences use `max-md:`; panel-width differences use container queries (`@container`, `@max-sm:`).
- Every screen must work in light and dark. The default follows the system.
- The map stays locked to Singapore (bounds plus a mask). Overlays sit under the place labels.

### Mock vs real

- Mocks live in `src/data/`. Keep them realistic: real places, plausible times. Where a real system would differ, say so in the UI (e.g. the note in the sign-in dialog).
- Runtime calls go only to public, keyless services, straight from the browser: OneMap (search and tiles), OSRM (drive times and roads) and data.gov.sg (live feeds). The one exception is our own backend's road-speed grid (`VITE_TRAFFIC_URL`), because LTA's key must stay on a server; the browser never holds a key. Each one has a fallback, and the UI says when it is used. The sample run makes no calls apart from tiles.
- Saved UI preferences use `usePersistentState` with `coldroute.*` keys.

## Code

- TypeScript strict and no `any`. Shared types belong in `lib/types.ts`.
- Use Tailwind classes, with `clsx` for conditional classes. Global CSS goes only in `index.css`.
- Comments explain why, not what.
- Commits use an imperative summary line. PRs that change the UI include screenshots.

## Before you open a PR

- [ ] `npm run build` passes.
- [ ] Checked in light and dark, at panel widths 340 and 600, and on a 390 px phone.
- [ ] No new colours, sizes or switch styles outside the tokens and primitives above.
- [ ] Still one solid primary per screen.
- [ ] README screenshots updated if the UI changed visibly.

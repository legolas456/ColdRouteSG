# Live conditions: from a feed list to the plan

**Status: proposal, waiting for the team's sign-off (11 Oct 2026).** Nothing here is built yet except where it says so. Decisions we need are in [Decisions](#decisions).

A user's feedback on the live demo:

> The conditions aren't obvious. A live feed page is fine, but I can't tell how it affects us.

They are right. The live data already changes the plan: NEA rain decides whether a stop unloads in rain, and HDB free lots change the parking risk. But the console never says so. The Conditions panel lists the feeds by source, in a popover behind a small pill in the top bar, apart from the map, the stops and the route decision.

This document says what live data is for, where each feed should show up, how to make its effect visible, and how to watch it while the van is out. It ends with a build plan in small PRs.

## What we found (11 Oct, 15:20–15:50)

We ran the console from `main` with the live feeds (Sunday 11 Oct, thundery showers forecast over the north and west), saved those feeds, and re-ran the optimiser offline on them. The script and its output are in the task notes, not the repo.

| # | Finding | Why it matters |
| --- | --- | --- |
| 1 | The map draws all 14 wet NEA areas and labels "Thundery showers 15:00–17:00" at Woodlands HC, for a run that unloads there at 10:19. | Breaks design principle 1: rain should show only where it overlaps an arrival. The map suggests a risk the plan doesn't have. |
| 2 | The stop card's Weather row says "Thundery showers · Woodlands" while the risk row below says "Dry at 10:19". | Two answers to one question. The dispatcher can't tell which one the plan used. |
| 3 | A run leaving at 09:00, planned at 15:24, is planned without rain. The only warning is a note inside the Conditions popover. | In Live mode with the default 09:00 departure, rain almost never counts, and nothing on the results says so. |
| 4 | The optimiser treats the end of NEA's 2-hour period as the rain stopping. On a 15:30 departure it moves Woodlands HC to 17:02, two minutes after the forecast ends, and calls it dry. | The end of a forecast is not the end of the rain. The plan games the boundary. |
| 5 | In Live mode, four stops with their own loading bay switch to an HDB carpark farther away: Woodlands HC (basement, 100 m) to W588 (400 m); Tampines Mall (loading bay, 50 m) to T12 (200 m, 0 of 20 lots free). | A van at Tampines Mall uses the mall's bay. "T12 has 0 free lots" looks like live data at work, but it is a modelling error. |
| 6 | LTA cameras are 8 cameras at Woodlands, Tuas and Sentosa Gateway. The nearest to any sample stop is 2.9 km away. | Cameras can only be context. They never change the plan. |

### What the conditions actually change today

Same stops, departure and weights, optimised twice: with the conditions, and with **neutral conditions** (no rain, each stop's own default parking). Then the neutral order is driven under the real conditions to see what ignoring them would cost.

| Case | Order with the conditions vs neutral | Ignoring the conditions would… |
| --- | --- | --- |
| **Recorded 09:05** (the demo morning) | Tanjong Pagar moves 5th → 7th (unloads 11:57, after the heavy rain over the City clears at 11:15); Tampines moves 7th → 5th; AMK Hub and Woodlands HC swap. +2 min of driving. | unload Tanjong Pagar in heavy rain at 11:12: cost 279 vs 245, exposure 117 vs 113 min |
| **Live 15:27, sample leaving 09:00** | Same order. Only parking changes (finding 5). Exposure +1 min. | change nothing: the forecast doesn't reach 09:00–12:00 |
| **Live 15:27, same run leaving 15:30** (windows shifted +6 h 30) | Woodlands HC moves 3rd → 4th (17:02, after the forecast period, see finding 4); AMK Hub moves up. +2 min of driving. | unload Woodlands HC in thundery showers at 16:49: cost 328 vs 243, exposure 123 vs 114 min |

So the live data does change real decisions, but only when the run falls inside the forecast. And the change is easy to compute and to say in one line.

## 1. What live data is for

Live data has three jobs, one for each moment of a run. Today we only do the first, and we don't show it.

| Moment | The dispatcher asks | What the product does | Value to the dispatcher |
| --- | --- | --- | --- |
| **Before: plan** | "Given today's rain and parking, what order?" | The conditions feed the cost: rain over a stop's unloading, walk and free lots at its carpark. | They don't have to check NEA and HDB by hand. Pharma and frozen cargo don't unload in a storm or wait for a lot. |
| **After: explain** | "Why this order, and not the one I'd have picked?" | Say which stops the conditions moved, why, and what ignoring them would cost. | They can trust the plan, defend it to drivers and customers, and spot bad data (a full HDB carpark next to a mall with its own bay). |
| **During: watch** | "Is the plan still good?" | Re-check the remaining stops on every refresh. Speak up only when a change matters, and offer to re-optimise. | They act early, before the van is in the rain: re-sequence, or call the customer. This is the real reason to be live. |

The comparison with the shortest route stays. It answers a different question: what risk-aware planning buys over a plain router. The new comparison is **with the conditions vs without them**: what *today's data* changed.

## 2. One mechanism: "What the conditions changed"

Everything below hangs on one computation, done after each optimisation:

1. **Neutral run.** Optimise the same stops with the same departure and weights, no rain, and each stop's default parking (its own bay, or the recorded or estimated value). Traffic stays as it is: it isn't live yet, so it's not part of the difference.
2. **Cost of ignoring.** Drive the neutral order under the real conditions (`simulate`, one pass). This gives "would unload in rain at 11:12" and the extra exposure.
3. **Per stop.** For each stop: position with and without, unloading time, rain overlap, carpark used and its lots. The cause is the factor whose cost changed most (weather or parking), with its source and time.

Rules, the same as for the existing explanations: the wording must match the direction of the move; one or two causes per stop; if the order didn't change, say so ("Today's conditions didn't change the order") and list only real cost changes. Cost: one more optimisation, about 6 ms for 7 stops (5,040 orders) and 50–90 ms for 8 (40,320), measured in Node on a Mac. Above 8 stops the optimiser uses 2-opt, which is cheaper.

Example lines, from the cases above:

- "Tanjong Pagar moved later (5th → 7th) so it unloads after the heavy rain over the City clears at 11:15. Recorded 09:05."
- "Ignoring the conditions, 1 stop would unload in rain and cold-chain exposure would be 4 min higher."
- "Woodlands HC moved later (3rd → 4th): NEA forecasts thundery showers over Woodlands 15:00–17:00. NEA 15:06."
- "Today's conditions didn't change the order. The forecast covers 15:00–17:00 and this run unloads 09:30–12:01."

It works in **Recorded mode too**, so the demo can show it on the rainy morning without depending on the weather. The recorded plan itself doesn't change.

## 3. Fix first: make every surface tell the same story

Before adding anything, fix findings 1–5 (F1–F6 below). These are small, and without them the new parts would explain a plan the map contradicts.

| Fix | Change |
| --- | --- |
| F1 Map shows relevant rain | Cells over a stop's area that overlap its unloading (±30 min) are drawn as today, labelled with their period ("Heavy rain 10:30–11:15"). Other wet areas are drawn faint, without labels or drift. The Rain chip still hides all of them. |
| F2 Weather at arrival | The stop card and stop rows say the weather *at unloading*: "Heavy rain at 11:12", "Dry at 10:19", or "Not in the forecast (NEA covers 15:00–17:00)". The area's general forecast moves to the Conditions tab. |
| F3 Timeline | Only rain periods inside the run's time axis. The legend names the stops they touch. |
| F4 Forecast horizon | When no stop's unloading is inside NEA's period, the results say so above the KPIs: "Rain not checked: NEA covers 15:00–17:00, this run unloads 09:30–12:01", with **Plan from now**. Not just a note in the popover. |
| F5 Forecast end | A live rain cell continues past NEA's period for scoring (proposed: 30 min, then unknown), so the optimiser can't park a stop at "17:02, dry". Stops after the period get the watch-out "After the forecast". |
| F6 Own bay first | Parking gets a kind: own loading bay, HDB, or estimated. Live HDB lots apply to HDB and estimated stops (addresses from search, estates). A stop with its own bay keeps it, and the nearest HDB carpark is shown as the fallback. |

F1–F3 change only what's drawn. F4 adds a notice. F5 and F6 change Live plans only. **The recorded plan is unchanged**: same order, same KPIs. The faint style from F1 would apply to the recorded light-rain cell over Choa Chu Kang, which no stop touches.

## 4. Where each feed lands

| | Map | Stop row (Plan) | Stop card | Results summary | Timeline | Conditions tab |
| --- | --- | --- | --- | --- | --- | --- |
| **NEA 2-hour forecast** | Relevant cells strong, with period labels; the rest faint (F1) | "Unloads in rain" with an `NEA` tag | Weather at unloading; with/without position if rain moved it | "What the conditions changed"; horizon notice (F4) | Rain bands over the stops they touch (F3) | Per stop: weather at unloading. Feeds: all 47 areas |
| **HDB carpark lots** | Carparks layer: the carpark each stop uses, its free lots, dashed walk line | "400 m walk", "0/20 lots" with an `HDB` tag | Carpark used, kind (own bay / HDB), lots, walk | Parking causes in "What the conditions changed" | — | Per stop: carpark and lots. Feeds: HDB totals |
| **LTA cameras** | New Cameras layer, off by default: 8 pins; click opens the camera viewer (PR #9) | — | Nearest camera within 3 km, opens the viewer (built) | — | — | Per stop: nearest camera or "none within 3 km". Feeds: all cameras |
| **Traffic** (estimate) | Heavy-traffic stretches (built), plus an "Estimate" label | "Heavy traffic" (built), marked as an estimate | Traffic factor, "Estimate" | Not part of "What the conditions changed" | — | Stated in "What this data can't tell you" |

## 5. Entry and page design

### Options

| Option | What | For | Against |
| --- | --- | --- | --- |
| A. Popover, by stop | Keep the pill's popover; make the first layer per stop and move the per-source feeds to a second layer. | Smallest change | Still apart from the plan; 420 px over the map; awkward on a phone; easy to miss. |
| **B. Conditions tab** (recommended) | A **Plan · Conditions** switch at the top of the left panel (a `Segmented`). On a phone the sheet gets Plan · Timeline · Conditions. The pill opens this tab. | The conditions sit next to the plan they explain, at full panel height, on every screen size. Selecting a stop works the same in both tabs. | A bigger change: the popover goes. |

### The Conditions tab (option B)

A sketch with the recorded morning's real values (4 of 7 stops shown):

```text
[ Plan | Conditions ]                                   Recorded 09:05   (refresh)
[ Live data | Recorded ]
(Live only: the "Conditions changed since 14:20 ... [Re-optimise]" banner sits here, see 7)

WHAT THE CONDITIONS CHANGED
  Tanjong Pagar moved later (5th -> 7th) so it unloads after the heavy rain
  over the City clears at 11:15.                                    Recorded 09:05
  Ignoring them: Tanjong Pagar unloads in heavy rain at 11:12, +4 min cold-chain exposure.

BY STOP              at unloading            parking                          camera
  1  NUH         09:30   Dry                 NUH Car Park A, 200 m, 41% free   none within 3 km
  4  Woodlands   10:32   Dry                 WHC Basement 2, 100 m, 55% free   [image] 2.9 km
  6  MBFC        11:43   Dry, rain ended     Marina Square MSCP, 1.1 km, 12%   none within 3 km
  7  Tanjong P.  11:57   Dry, rain ended     Guoco Tower B2, 400 m, 22%        none within 3 km   Moved later

FEEDS  >   NEA 47 areas · HDB 2,005 carparks · LTA 8 cameras        (expands to today's panel)
WHAT THIS DATA CAN'T TELL YOU  >
```

- **By stop** comes first, in route order. Each row shows the stop's ETA, the weather at unloading, the carpark used and its lots, and the nearest camera. A badge marks what the conditions changed ("Moved later", "0 lots"). Clicking a row selects the stop, as in the Plan tab.
- **Feeds** is the second layer: today's per-source panel (NEA grid, HDB summary, cameras) with each feed's own update time.
- In the **draft**, the tab shows what the optimiser will use, and the horizon check from F4 *before* optimising.
- The **pill** stays as the status ("Live 15:36", "Recorded 09:05"). It turns `warn` with a dot when conditions changed. Clicking it opens the Conditions tab, and opens the panel if it is hidden.
- The **Plan tab** gets a compact "What the conditions changed" card under "Why this route", linking to the tab.

## 6. Making the effect visible

| Where | What |
| --- | --- |
| Plan tab | "What the conditions changed" card: one to three lines with source chips, and the cost of ignoring them. When nothing changed, it says so in one line. |
| Stop rows | Watch-outs that come from live data carry a small source tag (`NEA`, `HDB`). A stop the conditions moved gets "Moved by rain" or "Moved by parking". |
| Stop card | A line under "Why here": "Without today's conditions: 3rd, unloading 16:49 in thundery showers." Detail rows give values at unloading. |
| Map | Hovering a line in "What the conditions changed" highlights the stop and its rain cell or carpark. |
| Later, maybe | Let Compare switch its reference between "Shortest route" and "Ignoring conditions". |

## 7. Watching during the run

Today, Live refetches every 5 minutes and nothing happens. Proposed:

1. **Each refresh**, for an optimised Live plan: rebuild the conditions, re-simulate the *current order* for the stops still ahead, and compare with the conditions the plan was built on. Also re-optimise the remaining stops in the background.
2. **Speak up only if it matters** for a stop still ahead:
   - its unloading now overlaps forecast rain, or no longer does (good news counts);
   - its carpark falls to 0 lots or under 10% free;
   - re-optimising saves at least 10 cost-minutes, or removes a late or wet stop;
   - a feed failed or is older than 15 minutes ("The plan uses NEA from 14:20; NEA hasn't updated since").
3. **Banner** at the top of the panel, and the pill turns `warn`: "Conditions changed since 14:20: rain now forecast over Tampines 13:30–15:30, where stop 7 unloads at 13:51. Re-optimising moves it to 5th and keeps it dry." The actions are **Re-optimise** (secondary; Dispatch stays the one primary) and **Dismiss**. We never re-plan on our own.
4. **Versions.** Re-optimising saves the plan as v2 ("14:35, after the NEA update"). "What the conditions changed" then compares v2 with v1.
5. **Stops still ahead.** We don't track the van yet, so we assume it keeps to the plan: a stop whose unloading has finished by now counts as done. Re-planning starts from the last done stop at the current time, which needs a fixed-prefix mode in the optimiser. "Mark delivered" (already on the roadmap) makes this exact later.
6. **Demo.** Real changes can't be scheduled, so a **Simulated** change (the third data mode in the demo plan, e.g. `?simulate=rain-tampines`) injects a rain cell to show the banner on cue. It is labelled "Simulated".

Recorded mode never changes, so it never warns. A shared view shows the banner without actions.

## 8. What the data can't tell us

| Feed | What we get | Limits | How the console says it |
| --- | --- | --- | --- |
| NEA 2-hour forecast | 47 named areas, issued every 30 min (15:06: 15:00–17:00; 15:36: 15:30–17:30) | Only the next 2 hours. A point per area, not a shape: our 2–2.5 km circles are a drawing. The end of the period is not the end of the rain. | Horizon notice (F4); "After the forecast" (F5); "Plan from now" |
| NEA 24-hour forecast *(not used)* | 5 regions, 6–12 h periods (11 Oct: thundery showers central, north and west until 18:00) | Coarse | Could flag later departures as "regional outlook", never as a cell |
| NEA rainfall readings *(not used)* | Rain gauges every 5 min; 12 stations reporting on 11 Oct 15:45 | Sparse | Could confirm "raining now" near a stop |
| HDB carpark availability | About 2,000 HDB carparks with live car lots (2,005 reporting at 15:27) | HDB only (no malls, hospitals, offices); free lots now, not at arrival; positions are a snapshot | Own bay first (F6); "Lots now, not at arrival" |
| LTA traffic cameras | 8 cameras: Woodlands ×3, Tuas ×3, Sentosa Gateway ×2 | Few and far from most stops; LTA says an image link is valid for about 5 minutes | Context only, never in "What the conditions changed"; "none within 3 km" |
| Traffic | A fixed value per stop: set by hand for the sample, guessed from the place for new stops (`trafficGuess`) | No live speeds: LTA DataMall Traffic Speed Bands needs an AccountKey (roadmap) | "Estimate" label; left out of the comparison |

## 9. Build plan

Small PRs. Each one keeps the recorded plan identical, updates the README screenshots and `roadmap.md`, and is checked in light and dark, at panel widths 340 and 600, and on a 390 px phone.

| PR | Scope | Done when |
| --- | --- | --- |
| 1 | Fixes F1–F6 | No surface contradicts the plan: map, stop card, rows and timeline agree on the weather at unloading. 09:00 Live runs say rain wasn't checked. No stop is scheduled "just after the forecast". Own bays are kept. |
| 2 | "What the conditions changed": `lib/impact.ts` (neutral run, cost of ignoring, causes), Plan card, stop card line, source tags | The recorded morning reads "Tanjong Pagar moved later (5th → 7th)…" and "+4 min exposure if ignored". The three cases above pass as tests (the frontend has no test runner yet: add Vitest, which roadmap 4 needs anyway). |
| 3 | Conditions tab (by stop, then feeds); the pill opens it; the popover goes; phone sheet tab | Every feed reachable from the tab. The draft shows the horizon check. |
| 4 | Map layers: Carparks with lots and walk lines; Cameras layer with the viewer | Layer chips stay in one row at 340 px and on the phone. |
| 5 | Watching: refresh diff, triggers, banner, plan versions, stops still ahead, Simulated change for the demo | The banner shows on a simulated change and stays quiet on refreshes that don't matter. |
| 6 *(optional)* | 24-hour regional outlook for later departures; rain gauges | Labelled as coarse. |

Demo script, step 1:45–2:15 ("Change a condition, re-optimise, see what changed"), would then use PR 5's Simulated change and PR 2's comparison.

## Decisions

Proposed defaults. The team confirms or changes them before PR 1.

| # | Question | Proposal |
| --- | --- | --- |
| 1 | Popover by stop (A) or Conditions tab (B)? | **B** |
| 2 | What are neutral conditions? | No rain, each stop's default parking, traffic unchanged |
| 3 | Own loading bay before HDB lots (F6)? | **Yes.** Changes Live plans only. |
| 4 | Rain after NEA's period (F5)? | Keep the cell 30 min past the period for scoring, then treat as unknown, and say so |
| 5 | When to warn during the run? | The four triggers in section 7, with 10 cost-minutes as the bar |
| 6 | Change the departure to Now when switching to Live? | **No**: offer **Plan from now** in the horizon notice instead |

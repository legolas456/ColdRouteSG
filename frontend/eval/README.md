# Route-quality evaluation

Does ColdRoute's recommended order actually trade a little driving for fewer late
stops, less cargo exposure and less unloading in rain? This compares it with the
shortest route, a by-hand baseline and a planner that only respects booked slots,
on 60 fixed scenarios, using the console's own planning code (`src/lib/optimizer.ts`).

```bash
cd frontend
npm run eval            # about 30 s; writes eval/results/
EVAL_EXACT_MAX=15 EVAL_EXACT_MS=30000 npm run eval   # also checks 15-stop runs against the exact optimum (slower)
```

Needs Node 22 (see `.nvmrc`). It runs offline: the drive times are in
`fixtures/pool-matrix.json`. Delete that file to refetch it from the public OSRM
server (one request).

## Inputs

- **Delivery points (43, `results/pool.csv`).** The ten named stops of the sample
  run and address book, plus a stand-in customer for every mainland NEA forecast
  area: the HDB block nearest the area's label point, within 2 km. Depot: Jurong
  Cold Store, as in the sample. Departure 09:00.
- **Drive times.** One OSRM table for the depot and all 43 points, fetched once and
  saved, so every planner sees identical times. Free-flow, no traffic (factor 1).
- **Scenarios.** 5 types × 3 sizes (5, 10, 15 stops) × 4 seeds = 60. The seed fixes
  everything (`scenarios.ts`, mulberry32):
  - `easy`: open 09:00–18:00, no rain, all chilled. The control: little to trade.
  - `tight`: half the stops get a booked 30–60 min slot, placed on the arrival
    times of a *random* order, so a route with no late stop always exists (the
    script checks that order also reaches every stop by 18:00).
  - `rain`: one heavy cell (two for 10+ stops) over stops' areas, lasting
    60–120 min, starting at a random time in the first half of the run. It is not
    placed where any planner arrives.
  - `mixed`: a third each of Pharma, Frozen and Chilled, all ≥ 8 km from the depot.
  - `combined`: tight + rain + mixed.
  - Every stop: 6–15 min unloading; parking risk from a random 5–80% free lots and
    the real walk to its carpark.

## Plans compared

| Plan | How |
|---|---|
| `shortest` | `optimise().baseline`: exact shortest drive (exhaustive ≤ 8 stops, Held–Karp ≤ 15) |
| `edf` | Earliest deadline first, the order a careful dispatcher might pick by hand. Stops with the same deadline (every stop without a slot closes at 18:00) go nearest first. |
| `slots` | `optimise()` with only the drive and lateness terms (0.5 each): what a general route planner that respects time windows does. The main comparison, since it shows what the rain and cargo terms add. |
| `balanced`, `pharma` | `optimise().recommended` with the profile weights in `src/lib/profiles.ts` |

The weights and reference scales were fixed before this run, and nothing was tuned
on these scenarios. So all 60 are reported, with no development/held-out split.

## Measures (raw, not the objective)

- late minutes and late stops
- cargo exposure: Σ sensitivity × minutes on board
- rain-exposed unloading minutes: the overlap of each unloading interval with rain over that stop's area
- drive minutes, and extra driving versus `shortest`
- planning time

Rain-exposed minutes are measured, while the objective counts a whole unload as wet
once any of it overlaps rain. Lateness, rain and exposure are also terms of the
objective, so this measures how large the trade-off is, not that the weights are
"right". The `easy` control and the `slots` baseline are what keep the comparison fair.

## Extra checks

- **Exact optimum.** Branch and bound over all orders (every cost term is ≥ 0, so a
  prefix's cost bounds every route that starts with it). It is re-scored with
  `simulate()` to check it agrees with the planner. Results: `results/exact-check.csv`.
- **Ablation.** Balanced on the 48 constrained runs with one term switched off and
  the rest renormalised: weather, cargo, parking, lateness.
- **Sensitivity.** Each Balanced weight ×0.8 and ×1.2, renormalised, on all 60 runs.
  Counts how many chosen orders change, and by how much the totals move.

## Outputs

| File | Contents |
|---|---|
| `results/runs.csv` | One row per scenario × plan, with the stop order |
| `results/summary.json` | Per group (`all`, `constrained`, `slotted` = tight + combined, and each type): totals, medians, IQR, worst cases, changes versus `slots`, win/tie/loss versus `shortest` and `slots` (tie < 0.5 min) with a two-sided sign test; targets, timing, exact check, ablation, sensitivity |
| `results/exact-check.csv` | Search cost vs exact cost per run and profile |
| `results/pool.csv` | The delivery points |

## Limits

The stand-in customers are real addresses, not real orders; the slots, cargo mix,
unloading times and rain are generated. There is about one stop per NEA area, so a
rain cell usually covers one or two stops. There's no traffic and one vehicle.
Timing is Node 22 on one laptop, not the planner Lambda.

Drive times: OSRM, © OpenStreetMap contributors (ODbL).

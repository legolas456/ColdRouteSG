# Product design

How ColdRoute SG should look and behave, and why. Feature-level detail of what is built lives in [`../frontend/README.md`](../frontend/README.md). UI rules live in [`../frontend/AGENTS.md`](../frontend/AGENTS.md).

## Positioning

> **Risk-aware dispatch for the cold-chain last mile in Singapore.**
> Tagline: *Plan cold. Arrive on time. Explain every route.*

It is a B2B SaaS product. It should still feel as polished as a consumer app.

## Design principles

1. **Decisions first, data second.** Only show data that changes a decision. Rain appears only where it overlaps an arrival.
2. **Always show the reference.** Every result is compared with the shortest route and shows the difference (−1 late, +8 min).
3. **Every recommendation is explained, and the explanation matches the result.** Explanations come from cost differences, never from templates alone.
4. **Risk is easy to scan.** Same tags, colours and order everywhere. Red is only for real problems.
5. **Be honest about trade-offs and freshness.** Say how many extra minutes we drive. Show when each feed was updated. Label mocked or simulated data.
6. **Fast entry for 5–15 stops.** Search, paste and address book beat long forms.
7. **Close the loop.** Adjust, re-optimise, see what changed, export for the driver.

## The dispatcher flow

One workspace per run, driven by state. No step-by-step wizard. The dispatcher needs to change constraints while looking at the result, and that's how comparable tools (Routific, Onfleet, Circuit for Teams) work.

| State | Left panel | Map | Main action |
| --- | --- | --- | --- |
| Draft | Run settings and stop list, inline editing, checks | Stops as pins, no route | **Optimise** |
| Optimising | Staged progress: conditions, matrix, shortest route, risk search, explanations | Route draws in | Disabled |
| Optimised | KPIs vs shortest route, "Why this route", stop order with reasons | ColdRoute route; shortest route on demand | **Export for driver**, Re-optimise |
| Live *(not built)* | Progress and alerts | Van position, rain | Accept suggestion |
| Completed *(not built)* | Plan vs actual | Actual track | Duplicate run |

## Key screens (built)

- **Workspace.** Resizable left panel and map, timeline below. The panel toggle stays in one place in the top bar.
- **Views.** ColdRoute, Shortest route and Compare.
- **KPIs.** Late deliveries, cold-chain exposure, drive time, distance. Each shows the shortest-route value and the difference.
- **Stop order.** Position change against the shortest route, ETA, window, cargo class, and plain-language watch-outs.
- **Stop card.** Click a stop on the map or in the list: why it's here, and how its risk compares with the shortest route.
- **Timeline.** One row per stop: delivery window, unloading block, lateness, rain periods.
- **Map.** Focused on Singapore. Layers: showers, carparks, traffic, shortest route.
- **Share and export.** A share link opens a read-only view of the sample run. **Export for driver** downloads the plan as a CSV, with no sign-in needed.
- **Phone layout.** Map with a bottom sheet. Light and dark modes follow the system.

## Explanations

Three levels:

1. **Route:** two or three points at the top, e.g. "serve the narrow pharma window first; avoid the 10:30–11:15 showers over the City; 8 extra minutes remove 82 minutes of lateness".
2. **Stop:** one "why here" line per stop.
3. **Factor:** risk breakdown in the stop card.

Rules: compare each stop's position and its T/L/W/P/C cost in both routes. Explain with the one or two factors that changed most. The wording must match the direction of the move. If a stop didn't move, say "Same position as the shortest route" and don't make up a reason.

## Ideas we may still build

Kept from the original plan. Pick from here when there's time, in roughly this order.

| Idea | What it adds |
| --- | --- |
| What-if panel | Simulate rain or congestion, change weights or lock a stop, re-optimise and see "what changed vs v1" |
| Runs list and saved versions | The SaaS shell: history, duplicate a daily run; maps to DynamoDB |
| System page | p50/p95 latency, cost per optimisation, feed health, experiment runner; evidence for the report |
| Driver app (phone, via link or QR) | Next stop, navigate, parking hint, proof of delivery |
| Tracking page (no login) | Receiver ETA, van position, "kept at 2–8°C" status |
| Live playback | Simulated van movement, scripted rain alert, accept a re-plan |
| Landing and pricing | Business model from the proposal: free starter, team, enterprise |

Out of scope: multi-vehicle optimisation, real SMS, payments.

## Demo

**Three data modes**, so the demo works on a sunny day or with a feed down:

| Mode | Source | Use |
| --- | --- | --- |
| Live | NEA forecast and HDB carparks now, LTA cameras for context (built) | Prove the data is real |
| Recorded | The rainy sample morning, Fri 10 Oct 09:05 (built, the default) | Repeat the interesting case reliably |
| Simulated | Manual overrides (not built) | What-if and controlled experiments |

Always show the current mode and snapshot time: the pill in the top bar does this, and opens the Conditions panel with every feed's own update time.

**Suggested three-minute script:**

| Time | Show | Point |
| --- | --- | --- |
| 0:00–0:30 | Draft run, add stops, pins appear | Entry is fast |
| 0:30–1:15 | Optimise, then Compare: late −1, exposure down, drive +8 min | Risk-aware beats shortest |
| 1:15–1:45 | Stop card for MBFC, rain on the timeline | Explainable and credible |
| 1:45–2:15 | Change a condition, re-optimise, see what changed | Reacts rationally to conditions |
| 2:15–2:40 | Share link, export for the driver | A real product |
| 2:40–3:00 | Architecture, latency, cost per optimisation | Cloud computing |

**Demo data:** signed-in user Fiona Lim (Admin), depot Jurong Cold Store, seven real Singapore customer locations. Keep demo names fictional and places real.

## Evaluation built into the product

| Proposal requirement | Product support |
| --- | --- |
| Route quality and risk (8.1) | Every result keeps both routes' metrics; batch experiments over scenarios |
| System performance (8.1) | Responses include real timings; p50/p95 shown; load test scripts |
| Cloud cost (8.1) | Estimated cost per optimisation and per month |
| Usability (8.2) | Tasks T1–T5 map to the UI: create a run, find the highest-risk stop, optimise, explain the difference, change a constraint and re-run. Optional study mode logs task times; SUS survey. |

# Cloud planner

The console's optimiser on AWS Lambda (Node.js 22), behind the signed-in `POST /api/plan` (see [`infra/`](../infra/README.md)). For a signed-in user on Live data, the console sends the run here instead of planning it in the browser, and plans in the browser again if this cannot be reached.

- **The console's own code.** It bundles `frontend/src/lib` and `frontend/src/data`: the conditions, the optimiser and the road tables, so a plan is the same wherever it is made. Only where the inputs come from differs.
- **Inputs** (`src/inputs.ts`): the NEA forecast and HDB lots from data.gov.sg, and from the traffic bucket the URA and mall carparks, the live road-speed grid and typical traffic (only the slots the last nightly build published).
- **Drive times** (`src/roads.ts`): Amazon Location Service in `ROUTING_REGION`, Sydney by default. Its routing data is HERE's, which routes everywhere in Singapore; the Singapore region's GrabMaps data could not route to or from NUH on 29 Oct 2026 and takes no traffic options. Times are free-flowing; live or typical LTA traffic goes on top, as in the console. Each pair is cached by position in DynamoDB for 30 days, and a new stop is measured as its own row and column only. If Location Service fails, OSRM, then the road-factor estimate, as in the console.
- **Road lines**: one Location Service route for each plan's path, both at once. A path whose legs do not match its stops is drawn from OSRM.
- **Time and cost**: each plan writes one log line in CloudWatch's embedded metric format (plan time, routes billed, pairs from the cache), shown on the stack's dashboard. On 29 Oct 2026 the sample run's first plan billed 63 routes in 3.7 s (a cold start), a repeat none in 0.1 to 1.1 s, and a run with one new stop 12 routes in 2.7 s.

```bash
npm ci
npm test            # Vitest, with fake Location Service, DynamoDB and S3 clients
npm run typecheck
npm run build       # dist/index.mjs; terraform apply runs this through infra/build-planner.sh
```

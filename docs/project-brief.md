# Project brief

## In one line

**ColdRoute SG helps cold-chain dispatchers in Singapore plan a delivery run that arrives on time, avoids avoidable risk, and explains every decision.**

## The problem

The shortest route is not always the best one. Heavy rain slows driving and unloading, congestion builds, and parking near some customers is scarce. For cold-chain goods (vaccines, frozen food, chilled catering), every extra minute on the van or on the kerb is exposure. Dispatchers today plan with spreadsheets, map apps and experience.

## Who it is for

| Role | Needs |
| --- | --- |
| **Dispatcher** (main user) at an SME cold-chain distributor: groceries, catering, pharma, healthcare | Plan the morning run quickly, avoid late or spoiled deliveries, explain the plan to the boss and the customer |
| Driver | Know the next stop, where to park, how much time there is |
| Receiving customer | Know when the delivery arrives and that it stayed cold |
| Course assessors and test users | Understand the value quickly; see a credible cloud architecture and evaluation |

Scope for the course: **one depot, one van, about 5–15 stops, in Singapore.**

## What the product does

1. The dispatcher enters the depot, the departure time and the stops: address, time window, unloading time, cargo class.
2. ColdRoute pulls live context: NEA rain forecast, carpark availability, traffic.
3. It plans two routes: the **shortest route** (drive time only) and the **ColdRoute** plan, which minimises

   **Route cost = αT + βL + γW + δP + εC**

   T is travel time, L lateness, W weather risk, P parking risk and C cold-chain exposure. The weights depend on the profile (Pharma, Balanced, Fastest).
4. It shows the two side by side: KPIs, map, timeline, and a plain-language reason for every stop ("Moved later so unloading starts after the rain over the City clears").
5. The dispatcher dispatches the run to the driver or shares it.

The value is the **decision layer**: turning live, messy data into a delivery order you can trust and explain. The map is just how it's shown.

## What exists today

| Part | State |
| --- | --- |
| Frontend (`frontend/`) | New dispatcher console, merged in PR #1. React + TypeScript + Tailwind + MapLibre. Runs without the backend: it calls OneMap, OSRM and data.gov.sg straight from the browser (with a bundled sample run for the demo), and the optimiser can run in the browser (all 5,040 orders of 7 stops). |
| Backend (`backend/`) | Python + FastAPI on AWS Lambda: saved runs, the admin view, LTA road speeds and URA and mall carparks for the console. |
| Cloud planner (`planner/`) | The console's optimiser on AWS Lambda, for signed-in users on Live data, with drive times from Amazon Location Service. |
| Cloud | A serverless AWS stack (Amplify, Cognito, API Gateway + Lambda, DynamoDB, S3, EventBridge, CloudWatch, Amazon Location Service), created and deployed by `terraform apply` in `infra/`. See [deployment.md](deployment.md). |

See [roadmap.md](roadmap.md) for what's next.

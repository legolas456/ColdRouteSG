# Feature inventory and TA feedback map

Checked against remote branches on 23 October 2026. A branch containing code is not evidence that the feature is in the deployed `main` demo. This is a planning inventory, not an acceptance test.

## What `main` currently contains

| Area | Current capability | Boundary to state clearly |
| --- | --- | --- |
| Run setup | One depot, up to 15 stops; OneMap address search; time windows, unloading minutes, cargo class, profile; draft saved locally | Depot is fixed to Jurong on `main`; saved draft is browser local storage |
| Planning | Browser optimiser, recommended and shortest-drive routes; exhaustive search to 8 stops and 2-opt above 8 | Browser and Python backend use different objectives; 2-opt quality above 8 stops has not been evaluated |
| Conditions | Recorded demo plus live NEA 2-hour forecast and HDB carpark availability; OSRM travel matrix; LTA camera images | Cameras are context, not measured traffic speed; HDB spaces are not verified van loading bays; missing/out-of-horizon weather needs clearer treatment |
| Results | Route map, ETAs, KPI comparison, explanations, stop details, timeline, responsive phone layout | Cold-chain exposure is a model proxy, not temperature or spoilage measurement |
| Account/share/dispatch | UI demonstration flows | Account and dispatch are mocks; shared link uses a fixed token and sample snapshot, without enforced access levels |
| Hosting | Amplify frontend and GitHub Actions deployment from `main` | The AWS API/auth/history branch is separate and its end-to-end deployment needs verification |

## Work on separate branches

| Branch | Added work | Integration note |
| --- | --- | --- |
| `feat/depot-picker` | Selectable depot with focused tests | Not on `main`; its tests belong to that branch |
| `feat/route-export` | CSV route export with focused tests | Not on `main`; can support dispatcher handoff and evaluation logging |
| `feat/normalized-objective` | Fixed-scale five-term objective and weight profiles with focused tests | Not on `main`; changes route order and exposure KPI semantics, so remeasure examples before report claims |
| `feat/lianping-admin-dashboard-cognito-dynamodb` | Cognito, API calls, DynamoDB route history, admin metrics, backend priority update and a different frontend | Review as an integration source; do not assume its UI or algorithm matches `main` |
| `test/newcomer-onboarding` | Optimiser regression tests and contributor notes | Bring useful tests into the final chosen planner after resolving overlapping test setup |
| `docs/live-conditions-plan` | Proposal in `docs/live-conditions.md` | Documentation only; its fixes and monitoring features are not implemented by that branch |

## TA feedback: report work and product implications

The TA's five preliminary-report comments ask for evidence and explanation. They are not a list of required new UI features.

| TA comment | Report/evaluation work still needed | Product work that could support it |
| --- | --- | --- |
| Weak background | Name and compare routing SaaS products using sourced, comparable capabilities | Demonstrate one testable ColdRoute distinction, such as showing how local conditions changed a recommendation |
| Pricing and market sizing absent | Agree billing unit and hypothetical SGD price; source a credible eligible-market funnel and cost assumptions | Record the actual prototype workload and AWS usage before claiming viable unit economics |
| No targets, timeline or allocation | Freeze scenario targets, user tasks and acceptance thresholds; put dated deliverables, owners and reviewers in the group plan | Export reproducible route results and automate correctness/performance checks |
| Different detail levels of traffic, weather and parking not explained | State exact spatial/time joins, feed timestamps, validity, fallback and unknown-data rules | Add source/freshness indicators; prevent an unrelated HDB carpark from replacing a known loading bay; integrate measured traffic only if access and map matching are feasible |
| Unnormalised terms and unclear weights | Show the five raw terms, fixed reference scales, initial profile weights and a training/held-out tuning process | `feat/normalized-objective` implements a pilot version in the browser; the backend still needs alignment if it becomes the final planner |

**Report-to-code status (23 October 2026):** `report/main.tex` proposes the fixed-scale five-term objective. The implementation on `feat/normalized-objective` follows that proposal, but this branch is not merged into `main`. The `main` browser optimiser still uses its earlier unnormalised penalties, and both the `main` Python backend and the AWS branch backend use a different unnormalised greedy score. Thus the report's equation is currently a proposal with one matching frontend feature branch, not the verified objective of the final deployed product. Before submission, choose the authoritative planner, align its code and tests with the equation, then update the report's implementation wording and measured results.

## Review of `docs/live-conditions-plan`

The 11 October proposal identifies useful, concrete failures: weather shown for an area can disagree with weather at unloading; a live run outside NEA's forecast horizon can appear dry; the optimiser can treat the forecast's end as the end of rain; and a nearby HDB carpark can replace a stop's own loading bay. Its first proposed phase (F1–F6) addresses consistency before adding a Conditions tab or monitoring.

Recommended order for distinct follow-up branches:

1. **Condition truth and provenance:** weather at unloading, out-of-horizon/unknown state, and own-bay precedence. Test the same scenario across map, stop card and result notice. This overlaps the live-conditions proposal, so coordinate ownership before coding it.
2. **Condition impact explanation:** compare the recommended order with a neutral-conditions order under the same snapshot, and report the actual raw outcome difference. Keep the shortest-drive comparison separately.
3. **Monitoring while driving:** change alerts and re-planning of remaining stops only after delivery state and route versions are reliable. The AWS branch already has a current-location/recalibration flow; inspect it before starting this feature.

The proposal's sample costs (for example 245 versus 279), exposure figures and “10 cost-minutes” alert threshold were calculated under the old objective. They must be rerun and renamed for the normalised objective. Extending forecast rain by 30 minutes is a proposed modelling assumption, not evidence that rain lasts that long; show the post-forecast period as unknown and test any conservative policy separately.

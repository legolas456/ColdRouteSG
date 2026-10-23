# Frontend integration decision (proposal)

Status: proposed for group review, 23 October 2026. This document records a recommendation; it does not claim that the AWS branch is deployed or approved by the team.

## Recommendation

Keep the dispatcher console on `main` as the canonical user interface. Integrate the Cognito sign-in, API Gateway/Lambda calls, DynamoDB route history, and admin view from `feat/lianping-admin-dashboard-cognito-dynamodb` in small changes behind explicit checks. Do not merge its complete `frontend/src/App.tsx` over `main`.

The `main` console is the branch used by the repository's Amplify deployment workflow. It already supports OneMap stops, live/recorded conditions, route comparison, timeline, stop explanations, and phone layout. The AWS branch has valuable backend, authentication, route history, and admin work, but its Ant Design frontend is a different application. Its request/response types and greedy planner differ from the `main` console's route model and optimiser. A wholesale merge would make it hard to tell which features survived and which route objective users are evaluating.

## Integration order

1. **Verify the cloud boundary.** Record the deployed frontend commit, API Gateway URL, Lambda version, JWT authorizer configuration, Cognito driver/admin groups, DynamoDB table and CloudWatch log group. Test an unauthenticated call, a driver call, an admin call, and a cross-user route-history request. Keep identifiers in environment configuration, not the report or committed secrets.
2. **Agree one optimisation contract.** Specify depot, stop window start/end, cargo sensitivity, service duration, condition snapshot and profile weights in a versioned request. Return both recommended and shortest-drive plans, raw metrics, per-stop explanations, data provenance and warnings. The current AWS response returns only one route, uses a different stop shape, and cannot directly populate the `main` comparison view.
3. **Connect the API without replacing the console.** Add an adapter in a separate feature branch, with saved fixtures for success, timeout, missing feeds and an unauthorised response. Keep the existing recorded browser mode available while the cloud path is verified. Make the UI say which engine produced a result.
4. **Add account and history views.** Replace the mock account only after sign-in, sign-out, token expiry and route ownership pass end-to-end tests. Label admin aggregates as *saved planning activity*; the database does not yet contain completed delivery events.
5. **Retire duplicate code deliberately.** Once the API and browser paths produce agreed results on the same fixtures, choose the final path for the demo and report. Remove or archive the unused frontend only after checking feature parity and the mobile view.

## Checks before claiming integration is complete

- The same 5-, 10- and 15-stop fixtures include each stop once and produce reproducible recommended and shortest-drive plans.
- Sign-in and API authorisation are enforced by the deployed gateway; driver A cannot read driver B's history; non-admin users cannot call admin endpoints.
- Failures in OSRM, weather, parking and storage show their actual source/fallback status in the UI.
- The main console still supports its existing plan, comparison, map, timeline, phone and recorded-data flows after integration.
- The report architecture diagram and algorithm equations match the commit used in the final demo.

## Open group decisions

- Who owns the API adapter and who independently reviews auth and route ownership?
- Should optimisation run in the browser, Lambda, or both for the final demo? If both, which implementation is authoritative?
- Which environment and commit will be demonstrated and measured?

Until these are resolved, describe the AWS work as an unmerged implementation branch, not a verified production architecture.

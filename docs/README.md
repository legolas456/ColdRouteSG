# ColdRoute SG docs

Project knowledge for the ColdRoute SG group project (CS5224 Cloud Computing, Group 36). Start here before writing code, documents, slides, images or videos about the project.

## What's here

| File | Read it for |
| --- | --- |
| [contributing.md](contributing.md) | Joining the team: current vs old demo, local setup, real vs mocked features, tests and the branch/PR workflow |
| [project-brief.md](project-brief.md) | One-page summary: problem, users, what the product does, what is built today |
| [preliminary-proposal.md](preliminary-proposal.md) | The preliminary report we submitted (28 Sep 2026): business case, AWS architecture, cost function, evaluation plan |
| [product-design.md](product-design.md) | Product definition and UX: the dispatcher flow, key screens, explanations, and the wider ideas we may still build |
| [brand.md](brand.md) | Name, logo, colours, fonts and tone, for anything visual (slides, posters, images, videos) |
| [roadmap.md](roadmap.md) | Status and to-dos, in priority order |
| [deployment.md](deployment.md) | Where the live demo runs, where the AWS keys are (not in the repo), how to deploy, and the CI to-do |

## Where other knowledge lives

| Topic | Source of truth |
| --- | --- |
| Backend, public data endpoints, optimisation logic | [`../README.md`](../README.md) and `backend/` |
| Frontend features, layouts, screenshots | [`../frontend/README.md`](../frontend/README.md) and `frontend/docs/screenshots/` |
| UI rules (tokens, buttons, switches, copy) | [`../frontend/AGENTS.md`](../frontend/AGENTS.md) |
| Live demo | https://main.daledp6z7ncmz.amplifyapp.com/ (AWS Amplify, redeployed by GitHub Actions on every merge to `main`, see [deployment.md](deployment.md)) |
| Singapore data sources | data.gov.sg (NEA weather, HDB carparks, traffic cameras), LTA DataMall, OneMap, OSRM. Check their official docs before quoting numbers. |

If two sources disagree, the code on `main` wins. Then fix the doc.

## How we work

- **Move fast.** Small changes, small PRs, merge as soon as checks are green. Don't wait for a perfect version.
- **Pull often.** Run `git pull --ff-only origin main` before you start and again before you push. Rebase your branch if `main` has moved.
- **Branch and PR.** Never commit straight to `main`. Name branches by intent (`feat/…`, `fix/…`, `docs/…`). UI PRs include screenshots.
- **Keep docs current.** When a decision changes, update the doc in the same PR. To-dos live in [roadmap.md](roadmap.md).
- **Be honest about mocks.** Say what is real and what is mocked, both in the UI and in the report.
- **Language.** Repo docs, code and UI are in English.

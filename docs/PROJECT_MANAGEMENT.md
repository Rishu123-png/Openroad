# OPENROAD — Project management decisions

Status: final for the 0.1 to 0.4 releases. Review these decisions when the first collaborator joins.

## The three decisions

| Question | Decision |
| --- | --- |
| Who develops OPENROAD? | Solo development initially, collaborators later |
| Repository | A new private GitHub repository: `Rishu123-png/Openroad` |
| Workflow | A combination of manual development with AI assistance and an AI coding agent with manual review |

## 1. Team: solo now, collaborators later

One person owns every decision today. The project is still run as if a second developer could join tomorrow:

- Every major system gets a document in `docs/` (section 18.3 of the master plan).
- Every change reaches `develop` through a pull request, even when the author and the reviewer are the same person. The pull request is the written record of what changed and why.
- Nothing that matters lives only in a chat conversation. Decisions go into `docs/`.
- An asset register (section 21.2) starts with the first imported asset.

When a collaborator joins: turn on branch protection for `main` and `develop`, require one approving review, and add a `CONTRIBUTING.md`.

## 2. Repository

| Property | Value |
| --- | --- |
| Repository | `Rishu123-png/Openroad` |
| Visibility | Private |
| Default branch | `main` |
| Integration branch | `develop`, to be created once the foundation is approved |
| Layout | npm workspaces monorepo: `apps/*` and `packages/*` (Part 10) |

The master plan names the repository `OPENROAD`. The existing repository is named `Openroad`. GitHub can rename it under Settings at any time and redirects the old address, so this is optional.

### Branches

```
main                      stable releases only (0.1, 0.2, ...)
  └── develop             integrated, working code
        ├── feature/...   one branch per piece of work
        └── arena/...     branches created by AI coding agent sessions
```

Rules:

1. Nobody commits directly to `main` or `develop`.
2. A feature branch starts from `develop` and merges back into `develop` through a pull request.
3. `develop` merges into `main` only when a release meets its acceptance test from Part 20. Tag the merge, for example `v0.1.0`.
4. A pull request merges only when `npm run typecheck`, `npm test` and `npm run build` all pass.

### Commit messages

Use a short prefix so the history can be scanned: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `perf:`, `chore:`.

## 3. Workflow: who does what

| Work | Done by | Checked by |
| --- | --- | --- |
| Product and design decisions, scope | You | — |
| Scaffolding, systems code, tests, documentation | AI coding agent, on its own branch | You, in a pull request |
| Small edits, tuning values, experiments | You, with AI assistance in the editor | The automated checks |
| Running the game in Chrome on real hardware | You | — |
| Vehicle handling feel, graphics quality, FPS on the RTX 3050 | You | — |
| 3D assets, sounds, licensing records | You | — |
| Secrets, hosting accounts, anything that costs money | You only | — |

Two limits shape this split:

- The agent cannot see your screen or your GPU. It can prove that code compiles, that tests pass and that the build succeeds. It cannot confirm that the game looks or feels right. Every pull request that changes what the player sees needs a manual run in Chrome before merging.
- The agent must never receive passwords, API keys or database credentials. Those stay in a local `.env` file, which Git ignores.

### How to hand a task to the agent

Give it one milestone-sized task at a time, with:

1. The goal in one sentence.
2. The section of the master plan it implements.
3. The acceptance test: what you will do in Chrome to decide that it works.
4. What is out of scope.

### How to review an agent pull request

1. Read the description, then the diff.
2. Pull the branch and run `npm install`, `npm run typecheck`, `npm test`, `npm run dev`.
3. Perform the acceptance test in Chrome with DevTools open.
4. Merge, or reply with what failed.

### Current state of the branches

| Branch | State |
| --- | --- |
| `main` | Initial commit only. Nothing merges here without explicit approval |
| `develop` | Does not exist yet. The owner creates it from `main` when the foundation is approved |
| `arena/cf0809af-openroad` | The agent's development branch. All OPENROAD 0.1 work so far is here |

An agent session can commit and push only to its own `arena/...` branch. It cannot create `develop` or feature branches, so its work reaches `develop` through a pull request that the owner approves.

### What the agent can and cannot verify

| Check | Agent |
| --- | --- |
| Type check, unit tests, production build | Yes |
| Page loads without console errors; overlay text; keyboard and mouse controls | Yes, in headless Chromium |
| The picture is correct | Yes, from screenshots, with software rendering |
| Frame rate, GPU behaviour, visual quality on real hardware | No |
| Browsers other than Chromium | No |

## Definition of done

From section 16.3. A feature is done when it has:

1. A working implementation.
2. Tests.
3. Documentation.
4. Error handling.
5. Performance checks where relevant.
6. No critical known regressions.

## Session log

| Session | Stage | Output | Status |
| --- | --- | --- | --- |
| [01](sessions/SESSION_01.md) | 1 — Project foundation | Browser-playable 3D application | Verified in headless Chromium; awaiting check on real hardware and approval to merge |
| Visual upgrade | Environment polish | Procedural district; see [World generation](WORLD_GENERATION.md) | Verified in headless Chromium; frame rate on real hardware unmeasured |
| 02 | 2 — Vehicle prototype | One drivable car | Planned |
| 03 | 3 — AI traffic | One AI vehicle following a route | Planned |

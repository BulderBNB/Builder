# BuilderQuiz — Flap App

On-chain version of the "Are You a Real Builder?" quiz (currently at builderbnb.xyz), rebuilt as
a [Flap App](https://docs.utter.cash/en/docs/mini-app-spec): no token required, leaderboard and
XP tracked on-chain via the Flap Shared Indexer (FSI), UI hosted by Flap at
`flap.sh/apps/{slug}`.

## Scope decision: no payouts

XP, levels, and the leaderboard are bragging rights only — completing courses does not mint or
transfer any token. This was a deliberate choice:

- Keeps the contract to a single, simple audit target — likely the 600 USDT deposit floor rather
  than a higher fee driven by multiple contracts.
- No anti-cheat engineering needed, since nothing of value is at stake.
- No regulatory/financial surface to review.

## Contract: `contracts/BuilderQuiz.sol`

- `completeCourse(courseId, correctAnswers, totalQuestions)` — called once per finished quiz
  run. Awards XP only the first time a user clears a given `courseId` (repeat plays can still
  improve their best score, but never farm XP twice).
- `levelOf(address)` — XP ÷ `xpPerLevel`, view-only convenience.
- Owner can tune `xpPerCorrectAnswer` and `xpPerLevel` going forward. No function can move funds
  or rewrite past results.

### FSI mapping

| Data | Template | Namespace | Key |
|---|---|---|---|
| Global XP leaderboard | A | `xp` | address |
| Per-course leaderboard (best score, bps) | B | `course` | round = courseId, account = user |
| Activity feed (every attempt, first or repeat) | G | `attempt` | id = courseId |

### Known trade-off

`completeCourse` trusts the caller's self-reported `correctAnswers`/`totalQuestions` — the quiz
content (questions, correct answers) lives off-chain in the UI, same as the public site today.
Someone could call the contract directly and self-report a perfect score without playing. Since
there's no payout, this was accepted rather than engineered around (see `BuilderQuiz.sol`
NatSpec). Revisit if a payout model is ever added later — that would need real answer
verification, not just a trusted call.

## Status

- Contract: drafted, compiles clean (`solc 0.8.24`).
- Template: confirmed real and public — `github.com/flap-sh/flap-vault-component-template`,
  branch `feat/mini-app-v2`. Scaffold command verified working
  (`node scripts/app-scaffold.mjs from-degen-to-builder` ran successfully and produced a real
  artifact ID).
- UI source (`Component.tsx` / `manifest.json` / `i18n.json`): not yet written.
- Not run from inside Claude's sandbox: `yarn install`, `app:check`, `app:e2e`, `app:package`.
  That sandbox blocks executing scripts from an externally-cloned repo as a safety boundary —
  it isn't something Claude can grant itself access to. **This final stretch has to run on a
  real machine — yours, or any normal dev environment.** The runbook below is exactly how.

## Runbook: from source to a submittable ZIP

### Prerequisites

- Node.js v22+ and Yarn (`corepack enable` gets you `yarn@1.22.22`, the version this repo pins).
- A BNB Chain Testnet wallet (e.g. MetaMask, network added via `chainid.network` or BNB Chain's
  own docs) funded with testnet BNB from a faucet (search "BNB testnet faucet" — several run
  live at any time, so no fixed link here).

### 1. Deploy `BuilderQuiz.sol` to BNB Chain Testnet

Easiest path, no local tooling needed:

1. Open [Remix IDE](https://remix.ethereum.org).
2. Create `FlapSharedIndexerV1.sol` and `BuilderQuiz.sol`, paste in the contents from
   `flap-app/contracts/` in this repo.
3. Compile with the Solidity 0.8.24 compiler.
4. Deploy tab → Environment: "Injected Provider" (MetaMask) → make sure MetaMask is on BNB Chain
   Testnet → Deploy `BuilderQuiz`.
5. Confirm the transaction, copy the deployed contract address. You'll need it for the manifest.

### 2. Set up the template locally

```bash
git clone https://github.com/flap-sh/flap-vault-component-template
cd flap-vault-component-template
git checkout feat/mini-app-v2
yarn install
```

### 3. Scaffold the app and drop in the real source

```bash
yarn app:scaffold from-degen-to-builder
```

This creates `src/vaults/from-degen-to-builder/` with placeholder `Component.tsx`,
`manifest.json`, `VaultABI.ts`, `i18n.json`. Replace all four with the versions Claude writes
(ask for them in this repo under `flap-app/app-source/` once the lesson content for the six
modules is ready) — `manifest.json`'s `walletContracts` needs the testnet address from step 1.

### 4. Run the real checks

```bash
yarn app:check from-degen-to-builder
yarn playwright install chromium   # first run only
yarn app:e2e from-degen-to-builder
yarn app:package from-degen-to-builder
yarn app:verify-package dist/from-degen-to-builder.zip
```

Fix whatever `app:check`/`app:e2e` flag (they return machine-readable JSON with `fixHint` —
paste any failure back to Claude to fix the source) and re-run until all four pass clean.

### 5. Submit

On `flap.sh`, open the Submit App form:

- Telegram, email, GitHub (optional)
- App Overview — mention `BuilderQuiz.sol`, the testnet address, and that it needs an audit
- Upload `dist/from-degen-to-builder.zip`
- Pay the 600 USDT refundable deposit

## Next step

Per Flap's own docs: "talk to us early." This README + `BuilderQuiz.sol` is the concrete
artifact to bring to that conversation before finishing the UI build.

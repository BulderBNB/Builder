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

## Not yet built

- **UI.** Flap Apps require the UI to be built with the `flap-vault-component-template` repo in
  its standalone "Flap App v2" mode (`useFlapSdk`, declared `walletChains`/`walletContracts`, no
  custom wallet logic). Need access to that template before this can be scaffolded — it's a
  different toolchain from the static site in this repo.
- **Testnet deployment.** Should deploy to BNB Chain Testnet and wire the UI against it before
  submitting (`testnet.flap.sh`).
- **Submission.** Flap's "Submit App" flow requires: Telegram, email, an app overview, and the
  ZIP produced by `yarn app:package` — plus a refundable 600 USDT deposit (final audit fee is at
  least 600 USDT, more if the audit covers additional contracts). This is a real payment, so it's
  on you to trigger, not something I can do on your behalf.

## Next step

Per Flap's own docs: "talk to us early." This README + `BuilderQuiz.sol` is the concrete
artifact to bring to that conversation before investing in the UI build.

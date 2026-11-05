# Builder Finder

Standalone gig/bounty board for builders on BNB Chain. Post a job, a builder claims it, does
the work, submits proof. Payment and communication happen off-platform — this product never
holds funds and never hosts chat.

Deliberately **not** part of the `$BUILDER` meme-coin site's nav — separate product, separate
audience, own branding. Lives at `builder-finder/` for now; can move to its own domain/repo
later without anything else in this repo caring.

## Trust model

- **Deadline misses are objective** — `block.timestamp` vs. a stored deadline. Missing one
  auto-strikes the builder; three strikes auto-blacklists them. No human needed.
- **Non-payment is not objective** — we never see money move off-platform, so a report is one
  wallet's claim about another. Logged permanently and publicly, but never auto-blacklists a
  poster; that's a deliberate, owner-reviewed call (`setPosterBlacklisted`).
- **Points require both sides to confirm, not just the poster clicking approve.** Since nothing
  is escrowed, a poster wallet and a "builder" wallet controlled by the same person could
  otherwise post → approve → farm `builderPoints` for free, with zero cost. The fix isn't
  cryptographic (there's no value at stake to gate with a fee or deposit) — it's social: poster
  and builder both confirm the job is actually done in the **Builder Discord**, publicly, before
  the poster calls `approveBounty`. A faked completion between two wallets is now visible and
  callable-out in a public channel, not a quiet on-chain transaction nobody can question.
  **This is a process rule enforced by community/ops, not by the contract** — `approveBounty`
  itself still only checks `msg.sender == poster` and `status == Submitted`. Worth being upfront
  about that gap if Flap (or anyone else) asks "couldn't this still be gamed on-chain" — yes,
  technically; the deterrent is public visibility, same logic as the non-payment reports being
  public but not auto-enforced.

## What exists right now

- `index.html` / `styles.css` / `script.js` — a full static preview of the product: live stat
  strip (open bounties / active builders / completed all-time), filter pills, search, dense
  bounty rows, post form, leaderboard. This is a **design/demo site**, not yet a Flap App.
- `contracts/BuilderBounties.sol` — compiles clean (`solc 0.8.24`). Not deployed anywhere yet.
- `contracts/FlapSharedIndexerV1.sol` — vendored verbatim from Flap's FSI spec (same base used
  by `BuilderQuiz.sol`).
- `data/bounties.json` — empty array. Honest empty state, no fabricated example bounties.

## What's missing before this is an actual Flap App submission

Flap Apps are a `Component.tsx` built inside their `flap-vault-component-template` via
`yarn app:scaffold`, not a static site. None of this is done yet:

- No `manifest.json` / `i18n.json` / `VaultABI.ts`.
- No port of this UI into `Component.tsx` using Flap's controlled image/media components
  (this preview uses plain `<img>`).
- No wallet integration — "Connect Wallet to Post" is currently a no-op. Flap requires
  `useFlapSdk` only, never raw ethers/web3.
- Data here comes from a static JSON file. A real Flap App would read live bounty/leaderboard
  state off `BuilderBounties.sol`'s events via the **FSI query endpoint**, not a static file.
- `BuilderBounties.sol` isn't deployed to testnet yet (same step `BuilderQuiz.sol` needed via
  Remix before a `manifest.json` could reference a real `walletContracts` address).

## Open strategic risk — unresolved with Flap

Every real Flap App we've been shown (StonksPad, ID Agent Curve, CORLA) is token/market-centric.
Flap's own team pointed us toward **Pool Launch** (direct-to-DEX token mechanics) rather than
the no-token mini-app spec. We have not confirmed with Flap that a no-payout utility app (a gig
board with no token, no escrow) even fits their submission program. Don't sink the
`Component.tsx` port effort in before that's actually confirmed — ask first.

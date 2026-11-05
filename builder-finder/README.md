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

## Profiles

Both sides get a profile at `profile.html?addr=0x...` — reachable from any address shown on a
bounty row, the leaderboard, or by pasting a wallet into the lookup widget.

- **Builder view**: points, completed count, strikes, full bounty history claimed by that
  wallet. All derived from existing bounty records — no new contract state needed for this part.
- **Poster view**: bounties posted and their statuses. Same — derived, not stored separately.
- **Open for work / rate / skills**: genuinely new, since it's forward-looking and can't be
  derived from past bounties. Self-set via `setBuilderProfile` on the contract — unverified, same
  trust tier as a bounty's own reward label (a listing, not a guarantee).

## What exists right now

- `index.html` / `styles.css` / `script.js` — live stat strip (open bounties / active builders /
  completed all-time), filter pills, search, dense bounty rows (with poster/claimer links into
  profiles and real Claim / Submit Proof / Approve / Report Non-Payment action buttons), a post
  form, and a leaderboard — all backed by **real wallet-connect and contract calls** (`web3.js`,
  ethers.js), not stubs.
- `profile.html` / `profile.js` — per-wallet profile page, see above, same real wiring: the edit
  form actually calls `setBuilderProfile`.
- `web3.js` — wallet connect (`window.ethereum`) + every contract read/write. `CONFIG.CONTRACT_ADDRESS`
  is empty until the contract is actually deployed; until then every read falls back to
  `data/*.json` and every write button reads "Connect Wallet to Post" exactly as before — flipping
  that one constant after deployment is the only step left to go live, no other code changes.
- `contracts/BuilderBounties.sol` — compiles clean (`solc 0.8.24`). Not deployed to a public
  network yet.
- `contracts/FlapSharedIndexerV1.sol` — vendored verbatim from Flap's FSI spec (same base used
  by `BuilderQuiz.sol`).
- `chain-test/` — local Hardhat-chain integration test harness. Proved the entire lifecycle (post,
  claim, submit proof, approve, non-payment report, profile set, deadline auto-strike,
  auto-blacklist at 3 strikes, owner moderation) against a real EVM, and separately drove the
  actual UI through Playwright with a simulated signing wallet — connect, post, claim, submit
  proof, approve, report, edit profile, all real signed transactions, all state verified on-chain.
  See `chain-test/README.md`.
- `data/bounties.json` / `data/profiles.json` — empty, used only as the pre-deployment fallback.
- `DISCORD_PLAN.md` — the Discord server plan (channels, roles, pinned copy). Live server:
  https://discord.gg/xsQrp3eCx

## What's missing before this is an actual Flap App submission

Flap Apps are a `Component.tsx` built inside their `flap-vault-component-template` via
`yarn app:scaffold`, not a static site. None of this is done yet:

- No `manifest.json` / `i18n.json` / `VaultABI.ts`.
- No port of this UI into `Component.tsx` using Flap's controlled image/media components
  (this preview uses plain `<img>`).
- `web3.js` uses raw ethers.js against `window.ethereum`. Flap requires `useFlapSdk` only — this
  needs re-wiring onto their SDK when the port happens, even though the logic itself is proven.
- Live bounty/leaderboard reads currently hit the contract directly (`bounties(i)` in a loop). A
  real Flap App would read via the **FSI query endpoint** instead, which is cheaper at scale.
- `BuilderBounties.sol` isn't deployed to a public network yet — proven correct against a local
  chain (see `chain-test/`), but the actual testnet deploy still needs Remix + MetaMask on a real
  machine, since this sandbox can't reach BSC testnet RPC.

## Flap fit — confirmed

Previously flagged as an open risk: every real Flap App we'd been shown (StonksPad, ID Agent
Curve, CORLA) was token/market-centric, and we hadn't confirmed a no-payout utility app even fit
their program. **Confirmed directly with Flap — it fits.** Clear to move ahead on the
`Component.tsx` port whenever we're ready to start it.

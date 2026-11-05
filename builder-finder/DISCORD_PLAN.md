# Builder Finder Discord — setup plan

**Invite:** https://discord.gg/xsQrp3eCx

## Channel structure

```
📌 WELCOME
  #rules
  #announcements

🔍 BOUNTY FINDER
  #how-it-works       (pin the site link + the 5 steps)
  #open-bounties       (new posts get dropped/cross-posted here)
  #find-a-builder       (informal "looking for X" before it's posted on-chain)

✅ PROOF & CONFIRMATION   ← the load-bearing category
  #submit-proof         (builder posts the finished-work link, tags the poster)
  #confirm-completion    (both sides react ✅ here — this IS the gate before approveBounty)

⚖️ TRUST
  #non-payment-reports   (public log, mirrors the on-chain report — never deleted)
  #hall-of-builders     (top builders get shouted out here + on X)

💬 SUPPORT
  #general
  #support
```

## Roles

`@Builder`, `@Poster`, `@Top Builder` (hand-granted, matches the leaderboard), `@Team`.
No wallet-gated roles yet — nothing to gate until there's an actual token-holding requirement,
so skip bot-based verification for now.

## #rules — paste this

> Builder Finder is a gig board for builders on BNB Chain. Post work, claim work, get it done —
> payment and chat happen off-platform, always.
> 1. No DMs for payment disputes — keep it in #non-payment-reports, public and timestamped.
> 2. Completion isn't official until **both sides** confirm in #confirm-completion. That's what
>    makes points count.
> 3. Be straight about scope and timelines. Miss your deadline, take the strike — it's automatic,
>    not personal.

## #confirm-completion — pin this

> **Before a poster approves on-chain, both sides confirm here.** Builder posts the proof link in
> #submit-proof and tags the poster → poster reacts ✅ in that thread once they've checked it →
> builder reacts ✅ back confirming the reward's sorted → *then* the poster calls `approveBounty`.
> Public by design — a fake approval between two wallets can't hide in a DM.

## Later, not now

Once there's real bounty volume, a webhook from `BuilderBounties.sol`'s events into
`#open-bounties` is a clean no-bot automation. Not worth building before the contract is deployed
and there's anything to post.

## How-to for the two basic Discord moves

**Create a category:** hover the empty space in the channel sidebar (or right-click it) →
**Create Category** → name it (e.g. `WELCOME`) → Create.

**Add a channel inside it:** hover the category header → click the **+** that appears → **Text
Channel** → type the name lowercase, no `#` (Discord renders that automatically) → Create Channel.

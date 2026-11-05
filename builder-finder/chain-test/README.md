# chain-test

Local integration test harness for `BuilderBounties.sol` — runs the full lifecycle (post, claim,
submit proof, approve, non-payment report, profile set, cancel, deadline auto-strike,
auto-blacklist at 3 strikes, owner moderation) against a real local EVM, with no internet access
needed. This is how the contract and the live frontend (`web3.js`/`script.js`/`profile.js`) were
actually proven to work end-to-end, including real wallet signing — not just "it compiles."

Why local instead of BSC testnet: this sandbox's network policy blocks RPC egress to BSC testnet
(and most non-allowlisted hosts). A local chain needs no internet and comes with pre-funded test
accounts, so it's strictly better for integration testing regardless. The real, public testnet
deployment still has to happen via Remix + MetaMask on a real machine (see `../README.md`).

## Setup

```bash
npm install
cp ../contracts/*.sol contracts/   # BuilderBounties.sol + FlapSharedIndexerV1.sol
node scripts/compile.js             # compiles via the npm solc package -> artifact.json
npx hardhat node --port 8546        # local chain, 20 pre-funded accounts, leave running
```

## Run the contract-only lifecycle test

```bash
node scripts/full-flow-test.js
```

Asserts every rule in the contract: points awarded on approval, non-payment reports logged but
never auto-blacklisting, profile self-set correctly, cancel works, 3 missed deadlines auto-strike
and auto-blacklist a builder, a blacklisted builder can't claim, a blacklisted poster can't post.

## Deploy fresh + test the real frontend

```bash
node scripts/deploy-fresh.js        # prints a contract address
```

Then point the live site at it for a session by setting, in the browser console or via
`page.addInitScript` in a Playwright test, before `web3.js` loads:

```js
window.__BF_TEST_CONFIG__ = {
  CONTRACT_ADDRESS: '<address from deploy-fresh.js>',
  RPC_URL: 'http://127.0.0.1:8546',
  CHAIN_ID: 31337
};
```

`web3.js` picks this up automatically if present (see the top of that file) — it's a no-op for
real users since nothing ever sets `window.__BF_TEST_CONFIG__` in production.

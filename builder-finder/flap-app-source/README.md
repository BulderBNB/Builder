# Builder Finder — Flap App source

The real Flap mini-app source for Builder Finder, written against `flap-sh/flap-vault-component-template`
(`feat/mini-app-v2` branch) per their `AGENTS.md`/`docs/standalone-mini-apps.md`/`docs/mini-app-wallet.md`.
This is the actual submission source — a standalone mini-app (`schemaVersion: 2, mode: "mini-app",
appModel: "standalone"`), not the marketing website. The website (`builder-finder/index.html` etc.) stays
separate; this is the functional tool that runs inside Flap.

## What's here

- `Component.tsx` — one compact card with three tabs (Browse / Post / Profile), matching the template's
  "Submission and Gallery Panel" + "Dashboard Frame" house style (their checker blocks row-heavy stacked
  marketing-style layouts — this is why the component looks tighter than the website).
- `manifest.json` — declares `walletChains: [97]` (BSC Testnet) and `walletContracts` with the exact
  `BuilderBounties.sol` read/write function signatures, per their reviewed-contract-declaration pattern.
  **`address` is still the zero address — this must be replaced with the real deployed contract address
  before submission.**
- `VaultABI.ts` — the same functions wrapped with viem's `parseAbi`, as their checker requires for
  human-readable ABI strings.
- `i18n.json` — all UI copy in English, Chinese, and Korean (their required locale set).

## What's verified vs. not

Verified by hand against the template's actual source (no deps installed, so no real compiler run):

- Every imported component/hook (`Button`, `TxButton`, `Alert`, `StatusBadge`, `Metric`, `Input`,
  `AddressLink`, `Card*`, `DataRow`, `CopyButton`, `useFlapSdk`, `handleTxError`, `ZERO_ADDRESS`) matches
  its real prop/type signature in `src/ui`/`src/sdk`.
- Every `i18n.t("...")` key used in `Component.tsx` exists in all three locales in `i18n.json` — checked
  programmatically, zero missing, zero mismatched.
- No forbidden APIs: no `navigator.clipboard` (uses the required `CopyButton` instead), no raw
  `window.open`/anchor external links, no CommonJS/`eval`/dynamic imports.
- `min-h-screen` on the outer element (required for mini-app mode).
- Wrong-network handling via `wallet.isWrongNetwork` + `wallet.switchChain()` before any write.

**Not verified — needs your machine**, same blocker as `flap-app/README.md`'s quiz contract runbook:
this sandbox cannot run `yarn install` in this externally-cloned repo (blocked by its own safety
classifier), so `yarn app:check`/`app:e2e`/`app:package`/`app:verify-package` have never actually run
against this code. The manual review above is real but is not a substitute for the actual TypeScript
compiler and their checker.

## Finishing it on your machine

```bash
git clone https://github.com/flap-sh/flap-vault-component-template
cd flap-vault-component-template
git checkout feat/mini-app-v2
yarn install

yarn app:scaffold builder-finder   # creates src/vaults/builder-finder with placeholders
```

Then replace the four generated placeholder files with the ones in this folder:

```bash
cp /path/to/Builder/builder-finder/flap-app-source/Component.tsx src/vaults/builder-finder/
cp /path/to/Builder/builder-finder/flap-app-source/manifest.json src/vaults/builder-finder/
cp /path/to/Builder/builder-finder/flap-app-source/VaultABI.ts src/vaults/builder-finder/
cp /path/to/Builder/builder-finder/flap-app-source/i18n.json src/vaults/builder-finder/
```

**Before running the checks**, deploy `BuilderBounties.sol` (see `../README.md` and `../contracts/`) to BSC
Testnet via Remix + MetaMask, and paste the real address into both:
- `manifest.json` → `walletContracts[0].address`
- `Component.tsx` → the `CONTRACT_ADDRESS` constant near the top

Then:

```bash
yarn app:check builder-finder
yarn app:e2e builder-finder
yarn app:package builder-finder
yarn app:verify-package dist/builder-finder.zip
```

Fix whatever `app:check`/`app:e2e` flag (they return machine-readable JSON with `fixHint` — paste any
failure back to Claude to fix the source) and re-run until all four pass clean. Then submit
`dist/builder-finder.zip` via flap.sh's Submit App form.

# $BUILDER

Landing page for **$BUILDER**, a community meme coin on BNB Chain inspired by
the mascot born from BNB Chain's anniversary swag-box drop.

- **Contract:** `0x1b947cb610f3b39b3148b33e8eceded2d7997777`
- **Network:** BNB Chain (BEP-20)
- **X:** [@thebnbmascot](https://x.com/thebnbmascot)

## Stack

Static site — plain HTML/CSS/JS, no build step or dependencies.

- `index.html` — page content
- `styles.css` — styling
- `script.js` — nav toggle + copy-to-clipboard for the contract address
- `assets/` — icons/art

## Running locally

Open `index.html` directly in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

## Deploying with GitHub Pages

1. Repo Settings → Pages
2. Source: Deploy from a branch
3. Branch: this branch (or `main`) / root
4. Save — the site publishes at `https://<org>.github.io/<repo>/`

## Disclaimer

$BUILDER is a community meme token with no intrinsic value or expectation of
financial return. It is not affiliated with, endorsed by, or issued by BNB
Chain, Binance, or any related entity. Nothing on this site is financial
advice — always DYOR before buying any token.

# NIMGA

AI Image Generator powered by Nimiq Wallet.

## Features

- **Wallet Login** — Connect with Nimiq Hub, no emails or passwords
- **Free Generations** — 3 free AI images per wallet
- **Credit Packs** — Purchase credits via Nimiq on-chain payments
- **Community Gallery** — Browse and vote on images created by others
- **Public/Private** — Choose if your images appear in the gallery
- **PWA** — Installable on mobile devices

## Tech Stack

- **Frontend** — Vanilla JS, CSS, HTML
- **Backend** — Node.js, Express
- **Database** — SQLite (sql.js)
- **AI** — Cloudflare Workers AI (Stable Diffusion XL)
- **Auth** — Nimiq Hub (signMessage)
- **Payments** — Nimiq Hub Checkout (on-chain)

## Setup

```bash
# Clone
git clone https://github.com/nazerbarkar/nimga.git
cd nimga

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your keys

# Run
node server.js
```

## Environment Variables

```
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
PORT=5001
RECIPIENT_ADDRESS=your_nimiq_wallet_address
```

## License

MIT

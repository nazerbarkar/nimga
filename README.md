# NIMGA

AI Image & Video Generator powered by Nimiq Wallet.

## Features

- **Text to Image** — Generate images using Cloudflare Workers AI (Flux Schnell)
- **Text to Video** — Generate videos using HuggingFace Wan2.2-TI2V-5B
- **Image to Video** — Animate your images using HuggingFace Wan2.2-I2V-A14B
- **Wallet Login** — Connect with Nimiq Pay Mini App or Nimiq Hub, no emails or passwords
- **Free Generations** — 3 free text-to-image generations per wallet
- **Credit Packs** — Purchase credits via Nimiq on-chain payments (1 credit = 1 image, 10 credits = 1 video)
- **Account History** — View all your generated images and videos
- **Public/Private** — Choose if your creations appear in the gallery
- **PWA** — Installable on mobile devices

## Tech Stack

- **Frontend** — Vanilla JS, CSS, HTML
- **Backend** — Node.js, Express
- **Database** — SQLite (sql.js)
- **Image AI** — Cloudflare Workers AI (Flux Schnell)
- **Video AI** — HuggingFace Inference Providers (Wan2.2 models)
- **Auth** — Nimiq Pay Mini App SDK / Nimiq Hub (signMessage)
- **Payments** — Nimiq on-chain transactions

## Prerequisites

- **Node.js** v16 or higher
- **npm** (comes with Node.js)
- A **Cloudflare** account with Workers AI enabled
- A **HuggingFace** account with API token (free tier available)
- A **Nimiq** wallet address for receiving payments

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/nazerbarkar/nimga.git
cd nimga
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```bash
copy .env.example .env
```

Or create it manually with these values:

```env
# Cloudflare (for text-to-image)
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token

# HuggingFace (for text-to-video and image-to-video)
HF_API_TOKEN=hf_your_huggingface_token

# Server
PORT=5001

# Nimiq wallet address to receive payments
RECIPIENT_ADDRESS=NQ07 0000 0000 0000 0000 0000 0000 0000 0000
```

### 4. Run the server

```bash
node server.js
```

### 5. Open in browser

```
http://127.0.0.1:5001
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Yes | Your Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | Yes | Cloudflare API token with Workers AI permission |
| `HF_API_TOKEN` | Yes | HuggingFace API token (free tier works) |
| `PORT` | No | Server port (default: `5001`) |
| `RECIPIENT_ADDRESS` | Yes | Nimiq wallet address for credit payments |

## How It Works

### Connecting Wallet

1. Click **"Connect wallet"**
2. If running inside Nimiq Pay Mini App, it connects automatically
3. Otherwise, a Nimiq Hub popup opens for signing
4. Sign the message to verify ownership (no gas fees)

### Generating Content

1. Select an agent: **Text to Image**, **Text to Video**, or **Image to Video**
2. For Image to Video, upload an image first
3. Enter your prompt
4. Click **Generate**
5. Wait for AI processing (images: ~2s, videos: ~30-60s)

### Credit System

| Action | Cost | Free Allowance |
|---|---|---|
| Text to Image | 1 credit | 3 free per wallet |
| Text to Video | 10 credits | None |
| Image to Video | 10 credits | None |

### Buying Credits

1. Click your credit balance or **"Add credits"**
2. Select a package (5, 20, or 50 credits)
3. Confirm the payment in your Nimiq wallet
4. Credits are added after blockchain confirmation

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/me` | Get current user info |
| POST | `/api/auth/challenge` | Get signing challenge |
| POST | `/api/auth/verify` | Verify wallet signature |
| POST | `/api/generate` | Generate image (text-to-image) |
| POST | `/api/generate-video` | Generate video (text-to-video) |
| POST | `/api/generate-image-to-video` | Generate video from image |
| GET | `/api/history` | Get user generation history |
| DELETE | `/api/history/:id` | Delete a generation |
| POST | `/api/buy-credits` | Prepare credit purchase |
| POST | `/api/confirm-payment` | Confirm on-chain payment |

## License

MIT

# Birthday Capsule

> An annual ritual page. Cake's always there. Once a year, on May 20, you blow it out — and seal a message for next year's self.

## What it does

- **Daily mode** (any day ≠ May 20): renders a pink 2-tier cake with a "38" candle. Always lit. No camera, no mic.
- **Birthday mode** (May 20 only): asks for camera + mic. Verifies your face (local embedding match — never sent anywhere). Detects you blowing on the candle (mic energy + mouth shape). When the flame goes out, the number flips from 38 → 39 and you can record a capsule (3 prompts + 30s audio) for next year's birthday.
- **Capsule storage**: GitHub Issues with `capsule-YYYY` labels. Next year, you see last year's first.

## Quick run

```bash
npm install
npm run dev          # http://localhost:3020
```

URL params for testing:
- `?dev=1` — treat any day as birthday (skip date gate)
- `?test=blow` — simulate a blow 2s after load (test 38→39 transition)
- `?debug=1` — overlay live mic energy + face match metrics
- `?year=2027` — simulate a future year (test annual rollover)

## Setup (one-time)

Generate your face embedding for the recognition gate:

```bash
# 1. Take a reference selfie
imagesnap me.jpg

# 2. npm run dev, then open http://localhost:3020/setup.html
#    Drop me.jpg → download embedding.json → save to public/embedding.json
```

`me.jpg` is `.gitignored`. The 128-dim float embedding in `public/embedding.json` is committed; it can't be reversed to a face.

## Deploy

```bash
vercel --prod
```

Set env var `VITE_GH_TOKEN` to a fine-grained PAT with `issues:write` for this repo.

## Stack

Vite · TypeScript · `@vladmandic/face-api` · Web Audio API · Canvas 2D · GitHub Issues API

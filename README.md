# HSIN-EE Studio System V3

Vite + React version of the uploaded JSX.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Data storage

V3 keeps the existing `hsin-ee-studio-data-v1` key and supports the original `window.storage` environment when available, with browser `localStorage` as the fallback for normal Vercel/browser deployment.

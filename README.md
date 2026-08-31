# HSIN-EE Studio System V5

Vite + React version prepared for Vercel deployment.

## V5 fixes
- Added the missing browser entry point (`src/main.jsx`).
- Added Vite configuration.
- Changed storage to use `localStorage` when `window.storage` is unavailable, while keeping compatibility with environments that provide `window.storage`.
- Added a React Error Boundary so runtime errors no longer silently appear as a blank page.

## Deploy
1. Upload this folder to GitHub.
2. Import the repository into Vercel.
3. Framework Preset: Vite.
4. Build Command: `npm run build`.
5. Output Directory: `dist`.

No environment variables are required by this current source file.

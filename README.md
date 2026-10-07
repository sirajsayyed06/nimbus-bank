# Nimbus Bank — Demo Banking App

A modern, full-featured demo banking application (React + Vite). This is the exact
app shown in Claude, repackaged as a standalone project so you can run it on your
own machine and deploy it to the web as a real, persistent site.

**This is an educational/demo project.** It does not connect to any real bank.
Data is stored only in your browser's local storage, on your own device.

## Run it locally

Requirements: [Node.js](https://nodejs.org) 18 or newer.

```bash
cd nimbus-bank
npm install
npm run dev
```

Then open the URL it prints (usually `http://localhost:5173`). Changes to the
code hot-reload automatically.

To build an optimized production version:

```bash
npm run build     # outputs static files to dist/
npm run preview   # serve the production build locally to test it
```

## Host it for free (pick one)

All of these take the contents of this folder and serve it as a public URL.
None of them require you to touch a server — `dist/` is just static HTML/JS/CSS.

### Option A — Vercel (easiest, 2 minutes)
1. Create a free account at vercel.com.
2. Install the CLI: `npm i -g vercel`
3. From this folder, run: `vercel`
4. Accept the defaults (Vite is auto-detected). You'll get a live `https://...vercel.app` URL.
5. Run `vercel --prod` to publish the production version.

### Option B — Netlify
1. Create a free account at netlify.com.
2. Run `npm run build` to produce `dist/`.
3. Drag and drop the `dist/` folder onto the Netlify dashboard ("Deploy manually"),
   or connect your GitHub repo and set:
   - Build command: `npm run build`
   - Publish directory: `dist`

### Option C — GitHub Pages
1. Push this folder to a GitHub repository.
2. Add `base: '/your-repo-name/'` to `vite.config.js` inside `defineConfig({...})`.
3. Run `npm run build`, then publish the `dist/` folder to a `gh-pages` branch
   (the `gh-pages` npm package, or GitHub Actions, automates this).

### Option D — Any static host
`npm run build` produces a plain `dist/` folder of HTML/CSS/JS. You can upload
that folder to literally any static web host (S3 + CloudFront, Cloudflare Pages,
Render, your own server, etc.) — there is no backend to configure.

## How data persistence works

The app stores your account and transaction history in the browser's
`localStorage`, scoped to whatever domain it's running on. That means:

- Data survives page refreshes and closing/reopening the browser.
- Data is **per-browser, per-device** — it won't sync between your phone and
  laptop, and clearing site data / using a different browser will reset it
  to the demo account.
- If you want real multi-device sync, you'd need to add a backend (e.g. a
  small API + database) and swap the `loadPersisted`/`persist` functions in
  `src/App.jsx` for network calls — the rest of the app (business logic, UI)
  doesn't need to change, since persistence is already isolated in those two
  functions.

## Project structure

```
nimbus-bank/
├── index.html          Entry HTML page, loads fonts + the app
├── package.json        Dependencies and npm scripts
├── vite.config.js       Build tool configuration
└── src/
    ├── main.jsx         React root — mounts <BankingApp />
    └── App.jsx          The entire application: data model, business logic,
                          persistence, and every screen/component
```

## Making it genuinely "yours"

A few safe, common tweaks:
- **Reset the demo data** any time from Settings → Reset demo data.
- **Change starting balance/transactions**: edit `buildDemoData()` near the
  top of `src/App.jsx`.
- **Change the look**: all styling lives in the `BankStyles` component at the
  bottom of `src/App.jsx` — colors are CSS variables (`--navy-900`, `--accent`,
  `--deposit`, `--withdrawal`, etc.) at the top of that block.

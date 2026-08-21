# Study Map

Local-first desktop app for studying: **unknowns as a map, not debt.**

Capture what you don’t understand, timebox a dig, and repay it with a Check — the core, in your own words. Notes, images, and papers stay on this computer.

macOS app (Tauri + React). UI in Korean, English, Spanish, and Chinese.

## How it works

1. **Capture** — Drop a stuck question into Inbox. `⌘⇧D` opens Quick Capture from anywhere.
2. **Board** — Move cards through Inbox → Cache → RAM → Storage as they heat up or cool down.
3. **Dig** — Start a 15 / 30 / 60 minute timebox. A timer can float above other windows.
4. **Check** — Before you repay, write the key idea. That’s the ticket out.
5. **Map** — Put cards on a graph, link them (named, directed or not), copy a connected group onto another map.
6. **Review** — Spaced review of repaid Checks. Archive holds what’s done or evicted.

Sessions group work by topic. Backup / restore is a zip of the local database and attachments (⋯ menu).

## Run locally

Needs [Node.js](https://nodejs.org/) and [Rust](https://rustup.rs/).

```bash
npm install
npm run dev:app
```

macOS `.app` / `.dmg`:

```bash
npm run dist:mac
```

Data lives in the app’s local SQLite store, not in this repo.

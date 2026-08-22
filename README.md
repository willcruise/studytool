# Study Map

Local-first desktop app for studying: **unknowns as a map, not debt.**

Capture what you don’t understand, timebox a dig, and repay it with a Check — the core, in your own words. The long game is **complete territory**: connected groups on the map that you’ve fully charted. Notes, images, and papers stay on this computer.

macOS app (Tauri + React). UI in Korean, English, Spanish, and Chinese.

## How it works

1. **Capture** — Drop a stuck question into Inbox. `⌘⇧D` opens Quick Capture from anywhere. Capture stays on the board; it does not start an island.
2. **Board** — Move cards through Inbox → Cache → RAM → Storage as they heat up or cool down.
3. **Dig** — Start a 15 / 30 / 60 minute timebox. A timer can float above other windows.
4. **Check** — Before you repay, write the key idea. That’s the ticket out.
5. **Map** — Investigate a card (or add a node) to put it on a graph. Linked cards are an **island**; a lone node is an islet. Repay charts that plot. An island counts as complete territory only when every visible member is repaid. Linking or splitting a new open card onto a charted island reopens it until you repay the new land. Copy/paste moves a whole island between maps.
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

# CORTEX Presence Core

A tiny, dependency-light daemon that holds a persistent Discord Gateway
WebSocket session so the bot shows the green **ONLINE** dot 24/7.

## Why this exists
Interactions (buttons / slash / tickets / welcomes) are handled by the fast
REST pipeline on Vercel (Core #2). This daemon is Core #1: presence only.
No privileged intents, no message handling — a few KB RAM and one socket.

## How it runs
GitHub Actions boots a fresh job every 3 hours (each lives ~5h55m). Jobs
overlap deliberately, so there is always a live gateway session and the
green dot never goes gray. Public repos get unlimited free Actions minutes.

`DISCORD_BOT_TOKEN` is injected as a GitHub Actions **Secret** at runtime.
It is never committed and never readable from the repo.

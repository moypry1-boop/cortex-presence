import WebSocket from 'ws';
import http from 'node:http';

/**
 * CORTEX PRESENCE CORE — Dual-Core Architecture (Core #1: Presence)
 *
 * A micro daemon whose ONLY job is to hold a persistent Discord Gateway
 * WebSocket session so the CORTEX bot shows the green ONLINE dot 24/7.
 * No privileged intents, no message handling, no heavy work — all ticket /
 * welcome / verify actions stay on the Vercel REST core (Core #2).
 *
 * Replacement of the old run-bot daemon at negligible cost (128MB RAM).
 */

const TOKEN = (process.env.DISCORD_BOT_TOKEN || '').trim();
const STATUS_TEXT = process.env.DISCORD_PRESENCE_TEXT || 'PROTECTING THE CORTEX NETWORK';
const STATUS_TYPE = Number(process.env.DISCORD_PRESENCE_TYPE || 0); // 0=PLAYING 2=LISTENING 3=WATCHING
const GUILDS_INTENT = 1 << 0;

if (!TOKEN) {
  console.error('[presence] FATAL: DISCORD_BOT_TOKEN missing');
  process.exit(1);
}

let seq = null;
let sessionId = null;
let resumeUrl = null;
let ws = null;
let heartbeatTimer = null;
let connectedSince = 0;

console.log('==============================================================');
console.log(' CORTEX PRESENCE CORE — green-online daemon booting');
console.log(` presence text: "${STATUS_TEXT}" (type ${STATUS_TYPE})`);
console.log('==============================================================');

function api(path, options = {}) {
  return fetch(`https://discord.com/api/v10${path}`, {
    ...options,
    headers: { Authorization: `Bot ${TOKEN}`, ...(options.headers || {}) },
  });
}

async function getGatewayUrl() {
  if (resumeUrl && sessionId) return `${resumeUrl}?v=10&encoding=json`;
  const res = await api('/gateway/bot');
  if (!res.ok) throw new Error(`gateway fetch ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return data.url;
}

function send(op, d) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ op, d }));
  }
}

function startHeartbeat(interval) {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => send(1, seq), interval);
  setTimeout(() => send(1, seq), Math.floor(Math.random() * interval));
}

function identify() {
  send(2, {
    token: TOKEN,
    intents: GUILDS_INTENT,
    presence: {
      status: 'online',
      since: null,
      afk: false,
      activities: [{ name: STATUS_TEXT, type: STATUS_TYPE }],
    },
    properties: {
      os: 'linux',
      browser: 'CortexPresenceCore',
      device: 'CortexPresenceCore',
    },
  });
}

function resume() {
  send(6, { token: TOKEN, session_id: sessionId, seq });
}

// Resolves when the socket dies (close/error) → supervisor loop reconnects.
function connectOnce() {
  return new Promise((resolve) => {
    (async () => {
      let url;
      try {
        url = await getGatewayUrl();
      } catch (e) {
        console.warn('[presence] gateway fetch failed:', e.message);
        return resolve(false);
      }

      ws = new WebSocket(url);

      ws.on('message', (data) => {
        let pkt;
        try { pkt = JSON.parse(data.toString()); } catch { return; }
        const { op, t, s, d } = pkt;
        if (s) seq = s;

        switch (op) {
          case 10: // Hello
            startHeartbeat(d.heartbeat_interval);
            if (sessionId && seq !== null) resume();
            else identify();
            break;
          case 11: // Heartbeat ACK
            break;
          case 0: // dispatch
            if (t === 'READY') {
              sessionId = d.session_id;
              resumeUrl = d.resume_gateway_url || null;
              connectedSince = Date.now();
              console.log(`[presence] GREEN ONLINE — session ${sessionId} at ${new Date().toISOString()}`);
              console.log(`[presence] bot ${d.user?.username} registered as online.`);
            }
            break;
          case 7: // Discord requests reconnect
            try { ws.terminate(); } catch {}
            break;
          case 9: // Invalid session
            sessionId = null;
            setTimeout(identify, d ? Math.random() * 5000 : 1000);
            break;
          default:
            break;
        }
      });

      ws.on('close', (code) => resolve(`close ${code}`));
      ws.on('error', (e) => resolve(`error ${e.message}`));
    })();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function supervisor() {
  let delay = 3000;
  while (true) {
    const outcome = await connectOnce();
    clearInterval(heartbeatTimer);
    console.log(`[presence] session dropped (${outcome ?? 'unknown'}) — reconnecting in ${Math.round(delay / 1000)}s`);
    await sleep(delay + Math.random() * 1000);
    delay = Math.min(delay * 1.6, 30000);
    if (outcome && outcome.startsWith('close 1000')) delay = 3000; // clean close → fast retry
  }
})();

// Tiny HTTP liveness endpoint for platform health checks / UptimeRobot
const PORT = Number(process.env.PORT || 8787);
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    seconds_online: connectedSince > 0 ? Math.floor((Date.now() - connectedSince) / 1000) : 0,
    session: sessionId ? `${sessionId.slice(0, 8)}…` : null,
  }));
}).listen(PORT, () => console.log(`[presence] health server on :${PORT}`));

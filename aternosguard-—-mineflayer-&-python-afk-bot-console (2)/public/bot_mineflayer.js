/**
 * Aternos 24/7 Continuous All-Time Roaming Mineflayer Bot (Node.js Engine)
 * Target Server: alamincraft.aternos.me:26832
 *
 * HOW TO RUN:
 *   node bot_mineflayer.js
 *
 * RUN WITH CUSTOM USERNAME (Recommended to avoid conflicts):
 *   node bot_mineflayer.js Frank_PC
 *
 * NOTE FOR ATERNOS:
 * Aternos enforces a connection throttle (~10 seconds). This script includes
 * an automatic 15-second throttle delay and 2-second spawn settling to prevent
 * ECONNRESET and connection throttled kicks.
 */

const mineflayer = require('mineflayer');

const cliUsername = process.argv[2];

const CONFIG = {
  host: process.env.MC_HOST || 'alamincraft.aternos.me',
  port: parseInt(process.env.MC_PORT || '26832', 10),
  username: cliUsername || process.env.MC_USERNAME || 'FrankAFK_Guard',
  version: process.env.MC_VERSION || false, // false = auto-detect
  auth: 'offline', // 'offline' or 'microsoft'
  autoWalk: true,
  walkRadiusBlocks: 5.0,
  autoJump: true,
  randomHeadLook: true,
  sneakPulse: true,
  armSwing: true,
  autoReconnect: true,
  reconnectBaseSec: 15, // 15s to bypass Aternos connection throttle
  reconnectMaxSec: 45,
  keepaliveTimeoutMs: 240000,
};

let bot = null;
let roamTimer = null;
let reconnectAttempts = 0;
let spawnAnchor = null;
let currentUsername = CONFIG.username;
let wasThrottled = false;

function startContinuousRoamLoop() {
  if (roamTimer) clearInterval(roamTimer);
  let tick = 0;
  console.log('[ROAM] Continuous roaming loop active.');
  roamTimer = setInterval(() => {
    if (!bot || !bot.entity) return;
    tick += 1;
    const pos = bot.entity.position;
    if (!spawnAnchor) spawnAnchor = { x: pos.x, y: pos.y, z: pos.z };

    const dx = spawnAnchor.x - pos.x;
    const dz = spawnAnchor.z - pos.z;
    const dist = Math.hypot(dx, dz);

    if (dist > Math.max(2.0, CONFIG.walkRadiusBlocks)) {
      // Smoothly look back toward spawn anchor
      Promise.resolve(bot.look(Math.atan2(-dx, -dz) + (Math.random() * 0.4 - 0.2), 0, false)).catch(() => {});
    } else if (CONFIG.randomHeadLook && tick % 5 === 0) {
      // Gentle natural head motion
      Promise.resolve(
        bot.look(bot.entity.yaw + (Math.random() * 0.8 - 0.4), (Math.random() * 2 - 1) * 0.18, false)
      ).catch(() => {});
    }

    bot.setControlState('forward', Boolean(CONFIG.autoWalk));
    bot.setControlState('jump', Boolean(CONFIG.autoJump && tick % 6 === 0));
    if (CONFIG.armSwing && tick % 8 === 0) {
      try { bot.swingArm('right'); } catch {}
    }
    if (CONFIG.sneakPulse && tick % 14 === 0) {
      bot.setControlState('sneak', true);
      setTimeout(() => { if (bot) bot.setControlState('sneak', false); }, 250);
    }
  }, 450);
}

function createBot() {
  console.log(`[CONNECTING] Connecting to ${CONFIG.host}:${CONFIG.port} as ${currentUsername}...`);
  bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: currentUsername,
    version: CONFIG.version || undefined,
    auth: CONFIG.auth,
    checkTimeoutInterval: CONFIG.keepaliveTimeoutMs,
    hideErrors: true,
  });

  if (bot._client) {
    bot._client.on('connect', () => {
      try {
        if (bot._client.socket) {
          bot._client.socket.setKeepAlive(true, 10000);
          bot._client.socket.setNoDelay(true);
        }
      } catch {}
    });
  }

  bot.once('spawn', () => {
    reconnectAttempts = 0;
    wasThrottled = false;
    const p = bot.entity.position;
    spawnAnchor = { x: p.x, y: p.y, z: p.z };
    console.log(`[SPAWN] Successfully joined world at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
    console.log('[SPAWN] Waiting 2 seconds for chunks to stabilize before roaming...');
    setTimeout(() => {
      if (bot && bot.entity) startContinuousRoamLoop();
    }, 2000);
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    console.log(`[CHAT] <${username}> ${message}`);
  });

  bot.on('kicked', (reason) => {
    const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
    if (reasonStr.includes('throttled')) {
      wasThrottled = true;
      console.warn('\n⚠️ [THROTTLED] Aternos connection throttled. Backing off 15s before reconnecting...\n');
    } else if (reasonStr.includes('duplicate_login')) {
      console.warn('\n⚠️ [DUPLICATE LOGIN]');
      console.warn(`Username "${currentUsername}" is already active on the server.`);
      // Switch name so it connects cleanly
      currentUsername = `${CONFIG.username.slice(0, 10)}_${Math.floor(10 + Math.random() * 89)}`;
      console.warn(`Auto-switching username to "${currentUsername}" for next attempt.\n`);
    } else {
      console.log('[KICKED]', reasonStr);
    }
  });

  bot.on('error', (err) => {
    const msg = err?.message || String(err);
    if (msg.includes('ECONNRESET')) {
      console.warn('[NETWORK] Connection reset (ECONNRESET). Reconnecting safely...');
    } else {
      console.error('[ERROR]', msg);
    }
  });

  bot.on('end', () => {
    if (roamTimer) clearInterval(roamTimer);
    if (!CONFIG.autoReconnect) return;
    reconnectAttempts += 1;
    let delaySec = Math.min(CONFIG.reconnectMaxSec, CONFIG.reconnectBaseSec + reconnectAttempts * 2);
    if (wasThrottled) delaySec = Math.max(16, delaySec);
    console.log(`[RECONNECT] Reconnecting in ${delaySec}s (attempt ${reconnectAttempts})...\n`);
    setTimeout(createBot, delaySec * 1000);
  });
}

createBot();

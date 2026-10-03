export type MovementMode =
  | 'continuous_roam'
  | 'anchor_step_return'
  | 'in_place_jump_look'
  | 'bounded_radius';

export interface BotConfig {
  host: string;
  port: number;
  username: string;
  version: string;
  auth: 'offline' | 'microsoft';
  movementMode: MovementMode;
  autoWalk: boolean;
  walkIntervalSec: number;
  walkDurationMs: number;
  walkRadiusBlocks: number;
  autoJump: boolean;
  jumpIntervalSec: number;
  randomHeadLook: boolean;
  sneakPulse: boolean;
  armSwing: boolean;
  humanizeTimingJitterPct: number;
  autoReconnect: boolean;
  reconnectBaseDelaySec: number;
  reconnectMaxDelaySec: number;
  exponentialBackoff: boolean;
  keepaliveTimeoutSec: number;
  chatHeartbeatEnabled: boolean;
  chatHeartbeatIntervalMin: number;
}

export function generatePythonMineflayerGuiScript(cfg: BotConfig): string {
  const pyVersion = !cfg.version || cfg.version.toLowerCase() === 'auto' ? 'False' : `"${cfg.version}"`;
  return `#!/usr/bin/env python3
"""
Aternos 24/7 Mineflayer AFK Bot with Continuous All-Time Roaming & Full Tkinter Movement Controls
Target Server: ${cfg.host}:${cfg.port}
Requires:
  pip install javascript
  npm install mineflayer
"""

import math
import queue
import random
import threading
import time
from datetime import datetime
import tkinter as tk
from tkinter import scrolledtext
from javascript import require, On

mineflayer = require("mineflayer")

CONFIG = {
    "host": "${cfg.host}",
    "port": ${cfg.port},
    "username": "${cfg.username}",
    "version": ${pyVersion},
    "auth": "${cfg.auth}",
    "movement_mode": "${cfg.movementMode}",
    "auto_walk": ${cfg.autoWalk ? 'True' : 'False'},
    "walk_interval_sec": ${cfg.walkIntervalSec},
    "walk_duration_ms": ${cfg.walkDurationMs},
    "walk_radius_blocks": ${cfg.walkRadiusBlocks},
    "auto_jump": ${cfg.autoJump ? 'True' : 'False'},
    "random_head_look": ${cfg.randomHeadLook ? 'True' : 'False'},
    "sneak_pulse": ${cfg.sneakPulse ? 'True' : 'False'},
    "arm_swing": ${cfg.armSwing ? 'True' : 'False'},
    "jitter_pct": ${cfg.humanizeTimingJitterPct},
    "auto_reconnect": ${cfg.autoReconnect ? 'True' : 'False'},
    "reconnect_base_sec": ${cfg.reconnectBaseDelaySec},
    "reconnect_max_sec": ${cfg.reconnectMaxDelaySec},
    "keepalive_timeout_sec": ${Math.max(180, cfg.keepaliveTimeoutSec)},
}


class AternosAFKBotController:
    def __init__(self, ui_queue: queue.Queue):
        self.ui_queue = ui_queue
        self.bot = None
        self.running = False
        self.connected = False
        self.reconnect_attempts = 0
        self.keepalive_count = 0
        self.movement_count = 0
        self.spawn_anchor = None
        self.manual_override_until = 0.0

    def log(self, category: str, message: str):
        ts = datetime.now().strftime("%H:%M:%S")
        self.ui_queue.put(("log", f"[{ts}] [{category:<9}] {message}"))

    def set_manual_control(self, control: str, state: bool):
        if not self.connected or not self.bot:
            return
        self.manual_override_until = time.time() + 5.0
        self.bot.setControlState(control, state)
        self.log("CONTROL", f"Manual {control.upper()} = {state}")

    def rotate_look(self, yaw_delta_deg: float, pitch_delta_deg: float):
        if not self.connected or not self.bot or not self.bot.entity:
            return
        self.manual_override_until = time.time() + 4.0
        new_yaw = self.bot.entity.yaw + math.radians(yaw_delta_deg)
        new_pitch = max(-1.4, min(1.4, self.bot.entity.pitch + math.radians(pitch_delta_deg)))
        self.bot.look(new_yaw, new_pitch, True)

    def start(self):
        if self.running and self.connected:
            return
        self.running = True
        threading.Thread(target=self._supervisor_loop, daemon=True).start()

    def stop(self):
        self.running = False
        self.connected = False
        if self.bot:
            try:
                self.bot.clearControlStates()
                self.bot.quit("Stopped by operator via GUI")
            except Exception:
                pass

    def _create_bot_instance(self):
        self.bot = mineflayer.createBot({
            "host": CONFIG["host"],
            "port": CONFIG["port"],
            "username": CONFIG["username"],
            "version": CONFIG["version"],
            "auth": CONFIG["auth"],
            "checkTimeoutInterval": CONFIG["keepalive_timeout_sec"] * 1000,
        })

        @On(self.bot, "spawn")
        def on_spawn(*args):
            self.connected = True
            self.reconnect_attempts = 0
            pos = self.bot.entity.position
            self.spawn_anchor = (pos.x, pos.y, pos.z)
            self.log("SERVER", f"Spawned at ({pos.x:.1f}, {pos.y:.1f}, {pos.z:.1f}) — Continuous Roaming Active.")

        @On(self.bot._client, "keep_alive")
        def on_keepalive(packet, *args):
            self.keepalive_count += 1
            self.log("KEEPALIVE", f"ACK #{self.keepalive_count}")

        @On(self.bot, "end")
        def on_end(reason, *args):
            self.connected = False
            self.log("NETWORK", f"Connection closed ({reason}).")

    def _supervisor_loop(self):
        while self.running:
            if not self.connected:
                try:
                    self._create_bot_instance()
                except Exception as exc:
                    self.log("ERROR", f"Connect error: {exc}")
                time.sleep(6.0)
                continue

            if time.time() < self.manual_override_until:
                time.sleep(0.4)
                continue

            try:
                pos = self.bot.entity.position
                if self.spawn_anchor is None:
                    self.spawn_anchor = (pos.x, pos.y, pos.z)
                dx = self.spawn_anchor[0] - pos.x
                dz = self.spawn_anchor[2] - pos.z
                dist = math.hypot(dx, dz)

                if dist > max(2.0, CONFIG["walk_radius_blocks"]):
                    self.bot.look(math.atan2(-dx, -dz), 0.0, False)
                elif CONFIG["random_head_look"] and random.random() < 0.35:
                    self.bot.look(self.bot.entity.yaw + random.uniform(-0.5, 0.5), random.uniform(-0.2, 0.2), False)

                if CONFIG["auto_walk"]:
                    self.bot.setControlState("forward", True)
                if CONFIG["auto_jump"] and random.random() < 0.35:
                    self.bot.setControlState("jump", True)
                else:
                    self.bot.setControlState("jump", False)

                if CONFIG["arm_swing"] and random.random() < 0.25:
                    self.bot.swingArm("right")
            except Exception:
                pass

            time.sleep(0.45)


if __name__ == "__main__":
    root = tk.Tk()
    root.title("AternosGuard — Continuous Roam & Gamepad (${cfg.host}:${cfg.port})")
    root.geometry("900x600")
    root.configure(bg="#0F172A")
    q = queue.Queue()
    ctrl = AternosAFKBotController(q)
    ctrl.start()
    root.mainloop()
`;
}

export function generateNodeMineflayerScript(cfg: BotConfig): string {
  const jsVersion = !cfg.version || cfg.version.toLowerCase() === 'auto' ? 'false' : `'${cfg.version}'`;
  return `/**
 * Aternos 24/7 Continuous All-Time Roaming Mineflayer Bot (Node.js Engine)
 * Target Server: ${cfg.host}:${cfg.port}
 * 
 * RUN:
 *   node bot_mineflayer.js
 * Or with custom username:
 *   node bot_mineflayer.js Frank_PC
 */

const mineflayer = require('mineflayer');

const cliUsername = process.argv[2];

const CONFIG = {
  host: process.env.MC_HOST || '${cfg.host}',
  port: parseInt(process.env.MC_PORT || '${cfg.port}', 10),
  username: cliUsername || process.env.MC_USERNAME || '${cfg.username}',
  version: ${jsVersion},
  auth: '${cfg.auth}',
  autoWalk: ${cfg.autoWalk},
  walkRadiusBlocks: ${cfg.walkRadiusBlocks},
  autoJump: ${cfg.autoJump},
  randomHeadLook: ${cfg.randomHeadLook},
  sneakPulse: ${cfg.sneakPulse},
  armSwing: ${cfg.armSwing},
  autoReconnect: ${cfg.autoReconnect},
  reconnectBaseSec: 15,
  reconnectMaxSec: 45,
  keepaliveTimeoutMs: ${Math.max(180, cfg.keepaliveTimeoutSec) * 1000},
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
      Promise.resolve(bot.look(Math.atan2(-dx, -dz) + (Math.random() * 0.4 - 0.2), 0, false)).catch(() => {});
    } else if (CONFIG.randomHeadLook && tick % 5 === 0) {
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
  console.log(\`[CONNECTING] Connecting to \${CONFIG.host}:\${CONFIG.port} as \${currentUsername}...\`);
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
    console.log(\`[SPAWN] Successfully joined world at (\${p.x.toFixed(1)}, \${p.y.toFixed(1)}, \${p.z.toFixed(1)})\`);
    console.log('[SPAWN] Waiting 2 seconds for chunks to stabilize before roaming...');
    setTimeout(() => {
      if (bot && bot.entity) startContinuousRoamLoop();
    }, 2000);
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    console.log(\`[CHAT] <\${username}> \${message}\`);
  });

  bot.on('kicked', (reason) => {
    const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
    if (reasonStr.includes('throttled')) {
      wasThrottled = true;
      console.warn('\\n⚠️ [THROTTLED] Aternos connection throttled. Backing off 15s before reconnecting...\\n');
    } else if (reasonStr.includes('duplicate_login')) {
      console.warn('\\n⚠️ [DUPLICATE LOGIN]');
      console.warn(\`Username "\${currentUsername}" is already active on the server.\`);
      currentUsername = \`\${CONFIG.username.slice(0, 10)}_\${Math.floor(10 + Math.random() * 89)}\`;
      console.warn(\`Auto-switching username to "\${currentUsername}" for next attempt.\\n\`);
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
    console.log(\`[RECONNECT] Reconnecting in \${delaySec}s (attempt \${reconnectAttempts})...\\n\`);
    setTimeout(createBot, delaySec * 1000);
  });
}

createBot();
`;
}


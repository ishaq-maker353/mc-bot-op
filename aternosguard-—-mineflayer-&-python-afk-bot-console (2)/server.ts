import dns from 'dns';
import express from 'express';
import fs from 'fs';
import mineflayer from 'mineflayer';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PERSIST_FILE = path.join(__dirname, '.bot-persistent-state.json');

process.on('uncaughtException', (err) => {
  console.warn('[AternosGuard] Caught non-fatal exception:', err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.warn('[AternosGuard] Caught non-fatal rejection:', reason);
});

export type MovementMode =
  | 'continuous_roam'
  | 'anchor_step_return'
  | 'in_place_jump_look'
  | 'bounded_radius';

export type ControlKey = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'sneak';

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

export interface LogEntry {
  id: string;
  timestamp: string;
  category: 'Keepalive' | 'Movement' | 'Network' | 'Reconnect' | 'Server' | 'Chat';
  level: 'Nominal' | 'Warning' | 'Alert';
  message: string;
  details: string;
  latencyMs?: number;
}

export interface BotPosition {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface VoxelCell {
  dx: number;
  dy: number;
  dz: number;
  name: string;
  kind:
    | 'air'
    | 'grass'
    | 'dirt'
    | 'stone'
    | 'cobble'
    | 'wood'
    | 'planks'
    | 'leaves'
    | 'water'
    | 'lava'
    | 'sand'
    | 'snow'
    | 'ore'
    | 'glass'
    | 'light'
    | 'torch'
    | 'flora'
    | 'flower'
    | 'slab'
    | 'fence'
    | 'solid';
}

export interface NearbyEntityInfo {
  id: number;
  name: string;
  kind: 'player' | 'mob' | 'object';
  dx: number;
  dy: number;
  dz: number;
  yaw: number;
  distance: number;
}

export interface HotbarSlotItem {
  slot: number;
  name: string;
  displayName: string;
  count: number;
}

export interface WorldPreviewSnapshot {
  updatedAt: string;
  timeOfDay: number;
  isDay: boolean;
  blockUnderfoot: string;
  blockAhead: string;
  heldItem: string;
  heldItemDisplayName: string;
  quickBarSlot: number;
  hotbar: Array<HotbarSlotItem | null>;
  activeControls: Record<ControlKey, boolean>;
  manualOverrideActive: boolean;
  voxels: VoxelCell[];
  entities: NearbyEntityInfo[];
}

export interface ServerPingResult {
  online: boolean;
  aternosState: 'Online' | 'Offline / Hibernating' | 'Starting / Queue' | 'Unreachable';
  latencyMs: number;
  versionName: string;
  protocol: number;
  playersOnline: number;
  playersMax: number;
  motd: string;
  checkedAt: string;
  rawError?: string;
}

interface BotRuntimeState {
  running: boolean;
  connectionState: 'Connected' | 'Connecting' | 'Reconnecting' | 'Disconnected';
  connectionMode: string;
  detectedServerVersion: string;
  startedAt: number | null;
  uptimeSeconds: number;
  cumulativeUptimeSeconds: number;
  reconnectAttempts: number;
  totalKeepalivesAcked: number;
  totalMovementsExecuted: number;
  antiKickPulsesSent: number;
  currentAction: string;
  health: number;
  food: number;
  inWater: boolean;
  onlinePlayers: string[];
  position: BotPosition;
  anchorPosition: { x: number; y: number; z: number };
  trail: Array<{ x: number; z: number; action: string; timestamp: string }>;
  lastKeepaliveAt: string | null;
  lastKeepaliveId: string;
  lastDisconnectReason: string | null;
  lastPingResult: ServerPingResult | null;
  nextReconnectInSec: number | null;
  worldPreview: WorldPreviewSnapshot;
  config: BotConfig;
  logs: LogEntry[];
}

const EDIBLE_FOOD_KEYWORDS = [
  'bread',
  'apple',
  'beef',
  'porkchop',
  'chicken',
  'mutton',
  'salmon',
  'cod',
  'carrot',
  'potato',
  'melon_slice',
  'berries',
  'pie',
  'stew',
  'soup',
  'cookie',
  'kelp',
  'chorus_fruit',
];

function classifyBlockKind(name: string): VoxelCell['kind'] {
  if (!name || name === 'air' || name === 'cave_air' || name === 'void_air') return 'air';
  const n = name.toLowerCase();
  if (n.includes('water') || n.includes('bubble') || n.includes('kelp') || n.includes('seagrass')) return 'water';
  if (n.includes('lava') || n.includes('fire') || n.includes('magma') || n.includes('campfire')) return 'lava';
  if (n.includes('torch') || n.includes('lantern') || n.includes('candle') || n.includes('end_rod')) return 'torch';
  if (n.includes('glowstone') || n.includes('shroomlight') || n.includes('sea_lantern') || n.includes('froglight')) return 'light';
  if (n.includes('glass') || n.includes('ice') || n.includes('pane')) return 'glass';
  if (n.includes('flower') || n.includes('dandelion') || n.includes('poppy') || n.includes('tulip') || n.includes('orchid') || n.includes('allium') || n.includes('rose') || n.includes('sunflower') || n.includes('lilac') || n.includes('peony') || n.includes('cornflower') || n.includes('lily')) return 'flower';
  if (n.includes('tall_grass') || n.includes('short_grass') || n === 'grass' || n.includes('fern') || n.includes('dead_bush') || n.includes('sapling') || n.includes('sugar_cane') || n.includes('wheat') || n.includes('carrots') || n.includes('potatoes') || n.includes('Mushroom')) return 'flora';
  if (n.includes('fence') || n.includes('wall') || n.includes('iron_bars') || n.includes('chain')) return 'fence';
  if (n.includes('slab') || n.includes('carpet') || n.includes('pressure_plate') || n.includes('trapdoor') || n.includes('daylight_detector')) return 'slab';
  if (n.includes('grass_block') || n.includes('moss') || n.includes('podzol') || n.includes('mycelium')) return 'grass';
  if (n.includes('dirt') || n.includes('farmland') || n.includes('mud') || n.includes('coarse') || n.includes('rooted') || n.includes('dirt_path')) return 'dirt';
  if (n.includes('leave') || n.includes('vine') || n.includes('azalea') || n.includes('bush') || n.includes('wart_block')) return 'leaves';
  if (n.includes('plank') || n.includes('crafting') || n.includes('chest') || n.includes('barrel') || n.includes('bookshelf') || n.includes('door') || n.includes('stairs')) return 'planks';
  if (n.includes('log') || n.includes('wood') || n.includes('stem') || n.includes('bamboo')) return 'wood';
  if (n.includes('sand') || n.includes('gravel') || n.includes('terracotta') || n.includes('sandstone')) return 'sand';
  if (n.includes('snow') || n.includes('powder_snow')) return 'snow';
  if (n.includes('ore') || n.includes('diamond') || n.includes('gold') || n.includes('iron_block') || n.includes('emerald') || n.includes('amethyst') || n.includes('redstone') || n.includes('lapis') || n.includes('coal')) return 'ore';
  if (n.includes('cobble') || n.includes('mossy_cobble') || n.includes('cobbled')) return 'cobble';
  if (n.includes('stone') || n.includes('deepslate') || n.includes('brick') || n.includes('andesite') || n.includes('diorite') || n.includes('granite') || n.includes('tuff') || n.includes('basalt') || n.includes('obsidian') || n.includes('bedrock')) return 'stone';
  return 'solid';
}

function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let val = value;
  while (true) {
    if ((val & ~0x7f) === 0) {
      bytes.push(val);
      break;
    }
    bytes.push((val & 0x7f) | 0x80);
    val >>>= 7;
  }
  return Buffer.from(bytes);
}

function readVarInt(buffer: Buffer, offset = 0): { value: number; length: number } | null {
  let numRead = 0;
  let result = 0;
  let read: number;
  do {
    if (offset + numRead >= buffer.length) return null;
    read = buffer[offset + numRead];
    const value = read & 0x7f;
    result |= value << (7 * numRead);
    numRead++;
    if (numRead > 5) return null;
  } while ((read & 0x80) !== 0);
  return { value: result, length: numRead };
}

function stripMinecraftFormatting(text: string): string {
  return text.replace(/§[0-9a-fk-or]/gi, '').trim();
}

async function pingMinecraftServer(host: string, port: number, timeoutMs = 4500): Promise<ServerPingResult> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    let responseBuffer = Buffer.alloc(0);

    const finish = (result: ServerPingResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      try {
        const hostBuf = Buffer.from(host, 'utf8');
        const packetId = writeVarInt(0x00);
        const protocolVersion = writeVarInt(765);
        const hostLength = writeVarInt(hostBuf.length);
        const portBuf = Buffer.alloc(2);
        portBuf.writeUInt16BE(port, 0);
        const nextState = writeVarInt(1);

        const handshakeData = Buffer.concat([
          packetId,
          protocolVersion,
          hostLength,
          hostBuf,
          portBuf,
          nextState,
        ]);
        const handshakePacket = Buffer.concat([writeVarInt(handshakeData.length), handshakeData]);
        const statusRequestPacket = Buffer.from([0x01, 0x00]);
        socket.write(Buffer.concat([handshakePacket, statusRequestPacket]));
      } catch (err) {
        finish({
          online: false,
          aternosState: 'Unreachable',
          latencyMs: Date.now() - startTime,
          versionName: 'N/A',
          protocol: 0,
          playersOnline: 0,
          playersMax: 0,
          motd: 'Handshake write failed',
          checkedAt: new Date().toISOString(),
          rawError: err instanceof Error ? err.message : 'Write error',
        });
      }
    });

    socket.on('data', (chunk) => {
      responseBuffer = Buffer.concat([responseBuffer, chunk]);
      const packetLen = readVarInt(responseBuffer, 0);
      if (!packetLen) return;
      if (responseBuffer.length < packetLen.length + packetLen.value) return;

      const packetId = readVarInt(responseBuffer, packetLen.length);
      if (!packetId || packetId.value !== 0x00) return;

      const jsonLenOffset = packetLen.length + packetId.length;
      const jsonLen = readVarInt(responseBuffer, jsonLenOffset);
      if (!jsonLen) return;

      const jsonStart = jsonLenOffset + jsonLen.length;
      const jsonEnd = jsonStart + jsonLen.value;
      if (responseBuffer.length < jsonEnd) return;

      const latencyMs = Date.now() - startTime;
      try {
        const jsonStr = responseBuffer.subarray(jsonStart, jsonEnd).toString('utf8');
        const parsed = JSON.parse(jsonStr);
        const rawMotd =
          typeof parsed.description === 'string'
            ? parsed.description
            : parsed.description?.text ||
              (Array.isArray(parsed.description?.extra)
                ? parsed.description.extra.map((e: { text?: string }) => e.text || '').join('')
                : 'Aternos Minecraft Server');
        const cleanMotd = stripMinecraftFormatting(rawMotd);
        const versionName = stripMinecraftFormatting(parsed.version?.name || 'Auto');
        const lowerMotd = cleanMotd.toLowerCase();
        const lowerVer = versionName.toLowerCase();
        const proto = parsed.version?.protocol ?? 0;

        let aternosState: ServerPingResult['aternosState'] = 'Online';
        let isTrulyOnline = true;

        if (
          lowerMotd.includes('offline') ||
          lowerVer.includes('offline') ||
          proto <= 0
        ) {
          aternosState = 'Offline / Hibernating';
          isTrulyOnline = false;
        } else if (
          lowerMotd.includes('starting') ||
          lowerMotd.includes('loading') ||
          lowerMotd.includes('queue') ||
          lowerMotd.includes('preparing') ||
          lowerVer.includes('starting')
        ) {
          aternosState = 'Starting / Queue';
          isTrulyOnline = false;
        }

        finish({
          online: isTrulyOnline,
          aternosState,
          latencyMs,
          versionName: versionName || 'Auto',
          protocol: proto,
          playersOnline: parsed.players?.online ?? 0,
          playersMax: parsed.players?.max ?? 20,
          motd: cleanMotd || `${host}:${port}`,
          checkedAt: new Date().toISOString(),
        });
      } catch (err) {
        finish({
          online: false,
          aternosState: 'Unreachable',
          latencyMs,
          versionName: 'N/A',
          protocol: 0,
          playersOnline: 0,
          playersMax: 0,
          motd: 'Malformed SLP response from server',
          checkedAt: new Date().toISOString(),
          rawError: err instanceof Error ? err.message : 'Parse error',
        });
      }
    });

    socket.on('timeout', () => {
      finish({
        online: false,
        aternosState: 'Offline / Hibernating',
        latencyMs: Date.now() - startTime,
        versionName: 'Aternos Sleep Mode',
        protocol: 0,
        playersOnline: 0,
        playersMax: 20,
        motd: `Connection timed out contacting ${host}:${port}`,
        checkedAt: new Date().toISOString(),
        rawError: 'ETIMEDOUT',
      });
    });

    socket.on('error', (err: NodeJS.ErrnoException) => {
      finish({
        online: false,
        aternosState: 'Offline / Hibernating',
        latencyMs: Date.now() - startTime,
        versionName: 'Aternos Sleep Mode',
        protocol: 0,
        playersOnline: 0,
        playersMax: 20,
        motd: `TCP probe ${err.code || 'error'} for ${host}:${port}`,
        checkedAt: new Date().toISOString(),
        rawError: err.code || err.message,
      });
    });

    socket.connect(port, host);
  });
}

const botState: BotRuntimeState = {
  running: true,
  connectionState: 'Connecting',
  connectionMode: 'Permanent Anti-Kick Mineflayer + Live Preview',
  detectedServerVersion: 'Auto-Detecting',
  startedAt: null,
  uptimeSeconds: 0,
  cumulativeUptimeSeconds: 0,
  reconnectAttempts: 0,
  totalKeepalivesAcked: 0,
  totalMovementsExecuted: 0,
  antiKickPulsesSent: 0,
  currentAction: 'Initializing continuous Mineflayer session...',
  health: 20.0,
  food: 20.0,
  inWater: false,
  onlinePlayers: [],
  position: {
    x: 10000.5,
    y: 73.0,
    z: 10000.5,
    yaw: 0.0,
    pitch: 0.0,
  },
  anchorPosition: {
    x: 10000.5,
    y: 73.0,
    z: 10000.5,
  },
  trail: [],
  lastKeepaliveAt: null,
  lastKeepaliveId: 'Awaiting packet...',
  lastDisconnectReason: null,
  lastPingResult: null,
  nextReconnectInSec: null,
  worldPreview: {
    updatedAt: new Date().toISOString(),
    timeOfDay: 6000,
    isDay: true,
    blockUnderfoot: 'grass_block',
    blockAhead: 'air',
    heldItem: 'empty_hand',
    heldItemDisplayName: 'Empty Hand',
    quickBarSlot: 0,
    hotbar: [null, null, null, null, null, null, null, null, null],
    activeControls: {
      forward: false,
      back: false,
      left: false,
      right: false,
      jump: false,
      sprint: false,
      sneak: false,
    },
    manualOverrideActive: false,
    voxels: [],
    entities: [],
  },
  config: {
    host: 'alamincraft.aternos.me',
    port: 26832,
    username: 'FrankAFK_Guard',
    version: 'auto',
    auth: 'offline',
    movementMode: 'continuous_roam',
    autoWalk: true,
    walkIntervalSec: 4,
    walkDurationMs: 350,
    walkRadiusBlocks: 5.0,
    autoJump: true,
    jumpIntervalSec: 8,
    randomHeadLook: true,
    sneakPulse: true,
    armSwing: true,
    humanizeTimingJitterPct: 30,
    autoReconnect: true,
    reconnectBaseDelaySec: 5,
    reconnectMaxDelaySec: 30,
    exponentialBackoff: true,
    keepaliveTimeoutSec: 240,
    chatHeartbeatEnabled: false,
    chatHeartbeatIntervalMin: 15,
  },
  logs: [],
};

// Load persistent state from disk if available, protecting against 25565 offline port overwrite
try {
  if (fs.existsSync(PERSIST_FILE)) {
    const saved = JSON.parse(fs.readFileSync(PERSIST_FILE, 'utf8'));
    if (saved.config) {
      const savedPort = Number(saved.config.port);
      const safePort =
        savedPort && savedPort !== 25565
          ? savedPort
          : saved.config.host?.toLowerCase().includes('alamincraft')
            ? 26832
            : 46958;
      botState.config = {
        ...botState.config,
        ...saved.config,
        port: safePort,
        movementMode: saved.config.movementMode || 'continuous_roam',
        walkRadiusBlocks: Math.max(3.5, Number(saved.config.walkRadiusBlocks) || 5.0),
        keepaliveTimeoutSec: Math.max(180, Number(saved.config.keepaliveTimeoutSec) || 240),
      };
    }
    if (typeof saved.cumulativeUptimeSeconds === 'number') {
      botState.cumulativeUptimeSeconds = saved.cumulativeUptimeSeconds;
    }
    if (typeof saved.totalKeepalivesAcked === 'number') {
      botState.totalKeepalivesAcked = saved.totalKeepalivesAcked;
    }
    if (typeof saved.totalMovementsExecuted === 'number') {
      botState.totalMovementsExecuted = saved.totalMovementsExecuted;
    }
    if (typeof saved.antiKickPulsesSent === 'number') {
      botState.antiKickPulsesSent = saved.antiKickPulsesSent;
    }
  }
} catch {
  // Ignore corrupt persist file
}

function savePersistentDiskState() {
  try {
    fs.writeFileSync(
      PERSIST_FILE,
      JSON.stringify(
        {
          config: botState.config,
          cumulativeUptimeSeconds: botState.cumulativeUptimeSeconds,
          totalKeepalivesAcked: botState.totalKeepalivesAcked,
          totalMovementsExecuted: botState.totalMovementsExecuted,
          antiKickPulsesSent: botState.antiKickPulsesSent,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } catch {
    // Ignore write error
  }
}

let activeBot: mineflayer.Bot | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let isCreatingBot = false;
let manualOverrideUntil = 0;
let isEatingFood = false;
let lastExternalOrigin = process.env.APP_URL || '';
let lastVoxelScanAt = 0;
let cachedVoxels: VoxelCell[] = [];

function appendLog(
  category: LogEntry['category'],
  level: LogEntry['level'],
  message: string,
  details: string,
  latencyMs?: number
) {
  const entry: LogEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    category,
    level,
    message,
    details,
    latencyMs,
  };
  botState.logs.unshift(entry);
  if (botState.logs.length > 200) {
    botState.logs.length = 200;
  }
}

function getBlockAtOffset(dx: number, dy: number, dz: number): { name: string; boundingBox: string } {
  try {
    if (!activeBot || !activeBot.entity || !activeBot.entity.position) {
      return { name: 'air', boundingBox: 'empty' };
    }
    const basePos = activeBot.entity.position.floored().offset(dx, dy, dz);
    const blk = activeBot.blockAt(basePos);
    if (!blk) return { name: 'air', boundingBox: 'empty' };
    return {
      name: blk.name || 'air',
      boundingBox: blk.boundingBox || (blk.name === 'air' ? 'empty' : 'block'),
    };
  } catch {
    return { name: 'air', boundingBox: 'empty' };
  }
}

/**
 * Auto-Eat Food in Inventory when Hunger Drops (< 16)
 * Prevents starvation over 1h 20m+ continuous roaming sessions.
 */
async function tryAutoEatFood() {
  if (isEatingFood || !activeBot || !activeBot.entity || botState.connectionState !== 'Connected') {
    return;
  }
  if (typeof activeBot.food === 'number' && activeBot.food >= 16) {
    return;
  }
  try {
    const items = activeBot.inventory?.items() || [];
    const foodItem = items.find((item) => {
      const lower = (item.name || '').toLowerCase();
      return EDIBLE_FOOD_KEYWORDS.some((kw) => lower.includes(kw)) && !lower.includes('rotten') && !lower.includes('spider_eye') && !lower.includes('pufferfish');
    });
    if (!foodItem) return;

    isEatingFood = true;
    await activeBot.equip(foodItem, 'hand');
    await activeBot.consume();
    appendLog(
      'Movement',
      'Nominal',
      `Auto-consumed ${foodItem.name} to restore hunger`,
      `Food level: ${activeBot.food}/20 · Health: ${activeBot.health}/20`
    );
  } catch {
    // Ignore consume interruption
  } finally {
    isEatingFood = false;
  }
}

/**
 * Anti-Kick Activity Pulse (Runs every ~35-50s)
 * Sends genuine player interaction packets (HeldItemChange + ArmAnimation + Sneak Toggle + Block Look)
 * that reset Vanilla `player-idle-timeout`, Spigot/Paper `playerLastActionTime`, and Aternos anti-AFK detectors.
 */
function executeAntiKickActivityPulse() {
  if (!activeBot || !activeBot.entity || botState.connectionState !== 'Connected') return;
  if (Date.now() < manualOverrideUntil) return;

  const bot = activeBot;
  try {
    // 1. Cycle Hotbar Slot (`HeldItemChange` packet resets Paper/Spigot idle timer)
    const currentSlot = bot.quickBarSlot ?? 0;
    const nextSlot = (currentSlot + 1 + Math.floor(Math.random() * 3)) % 9;
    bot.setQuickBarSlot(nextSlot);

    // 2. Swing Right or Left Arm (`ArmAnimation` packet resets Vanilla idle timeout)
    bot.swingArm(Math.random() > 0.25 ? 'right' : 'left');

    // 3. Brief Walk-Pause + Look Shift + Sneak Tap (breaks continuous held-key macro detection)
    bot.setControlState('forward', false);
    bot.setControlState('sprint', false);
    bot.setControlState('sneak', true);

    const yawShift = bot.entity.yaw + (Math.random() * 1.4 - 0.7);
    const pitchShift = (Math.random() * 2 - 1) * 0.35;
    Promise.resolve(bot.look(yawShift, pitchShift, false)).catch(() => {});

    setTimeout(() => {
      try {
        if (activeBot !== bot) return;
        bot.setControlState('sneak', false);
        bot.swingArm('right');
      } catch {}
    }, 320);

    botState.antiKickPulsesSent += 1;
    botState.currentAction = `Anti-Kick Idle Reset #${botState.antiKickPulsesSent} (Slot #${nextSlot + 1} + ArmSwing)`;

    appendLog(
      'Movement',
      'Nominal',
      `Anti-Kick Activity Pulse #${botState.antiKickPulsesSent} (Reset 80m Idle Timer)`,
      `Hotbar -> Slot #${nextSlot + 1} · ArmAnimation + EntityAction + Look packet sent`
    );

    // Also check if the bot needs to eat food
    tryAutoEatFood();
  } catch {}
}

function syncBotTelemetry(forceVoxelScan = false) {
  try {
    if (!activeBot || !activeBot.entity || !activeBot.entity.position) return;
    const pos = activeBot.entity.position;
    const yawDeg = Number((((activeBot.entity.yaw * 180) / Math.PI) % 360 + 360) % 360).toFixed(1);
    const pitchDeg = Number(((activeBot.entity.pitch * 180) / Math.PI).toFixed(1));
    botState.position = {
      x: Number(pos.x.toFixed(2)),
      y: Number(pos.y.toFixed(2)),
      z: Number(pos.z.toFixed(2)),
      yaw: Number(yawDeg),
      pitch: Number(pitchDeg),
    };
    botState.inWater = Boolean((activeBot.entity as unknown as { isInWater?: boolean }).isInWater);
    if (botState.inWater) {
      activeBot.setControlState('jump', true);
    }
    if (typeof activeBot.health === 'number') {
      botState.health = Number(activeBot.health.toFixed(1));
    }
    if (typeof activeBot.food === 'number') {
      botState.food = Number(activeBot.food.toFixed(1));
    }
    if (activeBot.players) {
      botState.onlinePlayers = Object.keys(activeBot.players);
    }

    // Build live 21x10x21 3D voxel chunk around the bot (-10..+10 X/Z, -4..+5 Y) with 600ms throttle
    const now = Date.now();
    let voxels = cachedVoxels;
    if (forceVoxelScan || now - lastVoxelScanAt > 600 || cachedVoxels.length === 0) {
      lastVoxelScanAt = now;
      const rawGrid = new Map<string, { name: string; kind: VoxelCell['kind'] }>();
      for (let dy = -4; dy <= 5; dy++) {
        for (let dz = -10; dz <= 10; dz++) {
          for (let dx = -10; dx <= 10; dx++) {
            const blk = getBlockAtOffset(dx, dy, dz);
            const kind = classifyBlockKind(blk.name);
            rawGrid.set(`${dx},${dy},${dz}`, { name: blk.name, kind });
          }
        }
      }

      const isTransparentKind = (k?: VoxelCell['kind']) =>
        !k ||
        k === 'air' ||
        k === 'water' ||
        k === 'glass' ||
        k === 'leaves' ||
        k === 'light' ||
        k === 'torch' ||
        k === 'flora' ||
        k === 'flower' ||
        k === 'slab' ||
        k === 'fence';

      const freshVoxels: VoxelCell[] = [];
      for (let dy = -4; dy <= 5; dy++) {
        for (let dz = -10; dz <= 10; dz++) {
          for (let dx = -10; dx <= 10; dx++) {
            const cell = rawGrid.get(`${dx},${dy},${dz}`);
            if (!cell || cell.kind === 'air') continue;
            const exposed =
              isTransparentKind(rawGrid.get(`${dx},${dy + 1},${dz}`)?.kind) ||
              isTransparentKind(rawGrid.get(`${dx + 1},${dy},${dz}`)?.kind) ||
              isTransparentKind(rawGrid.get(`${dx - 1},${dy},${dz}`)?.kind) ||
              isTransparentKind(rawGrid.get(`${dx},${dy},${dz + 1}`)?.kind) ||
              isTransparentKind(rawGrid.get(`${dx},${dy},${dz - 1}`)?.kind) ||
              isTransparentKind(rawGrid.get(`${dx},${dy - 1},${dz}`)?.kind);
            if (exposed) {
              freshVoxels.push({ dx, dy, dz, name: cell.name, kind: cell.kind });
            }
          }
        }
      }
      cachedVoxels = freshVoxels;
      voxels = freshVoxels;
    }

    // Collect nearby entities within 22 blocks
    const nearbyEntities: NearbyEntityInfo[] = [];
    if (activeBot.entities) {
      for (const key of Object.keys(activeBot.entities)) {
        const ent = activeBot.entities[Number(key)];
        if (!ent || ent === activeBot.entity || !ent.position) continue;
        const edx = Number((ent.position.x - pos.x).toFixed(2));
        const edy = Number((ent.position.y - pos.y).toFixed(2));
        const edz = Number((ent.position.z - pos.z).toFixed(2));
        const dist = Number(Math.hypot(edx, edz).toFixed(2));
        if (dist <= 22) {
          const entTypeStr = String(ent.type || '');
          const kind: NearbyEntityInfo['kind'] =
            ent.type === 'player' ? 'player' : entTypeStr === 'mob' || entTypeStr === 'hostile' || entTypeStr === 'animal' ? 'mob' : 'object';
          const entYawDeg = typeof ent.yaw === 'number' ? Number((((ent.yaw * 180) / Math.PI) % 360 + 360) % 360) : 0;
          nearbyEntities.push({
            id: ent.id,
            name: ent.username || ent.displayName || ent.name || ent.type || 'Entity',
            kind,
            dx: edx,
            dy: edy,
            dz: edz,
            yaw: entYawDeg,
            distance: dist,
          });
        }
      }
    }

    // Extract all 9 hotbar slots (Minecraft inventory slots 36..44)
    const hotbar: Array<HotbarSlotItem | null> = [];
    const invSlots = activeBot.inventory?.slots || [];
    const quickBarStart = (activeBot.inventory as unknown as { hotbarStart?: number })?.hotbarStart ?? 36;
    for (let i = 0; i < 9; i++) {
      const item = invSlots[quickBarStart + i];
      if (item && item.name) {
        const prettyName =
          item.displayName ||
          item.name
            .split('_')
            .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
        hotbar.push({
          slot: i,
          name: item.name,
          displayName: prettyName,
          count: item.count ?? 1,
        });
      } else {
        hotbar.push(null);
      }
    }

    const yawRad = activeBot.entity.yaw;
    const lookDx = Math.round(-Math.sin(yawRad));
    const lookDz = Math.round(-Math.cos(yawRad));
    const blockUnder = getBlockAtOffset(0, -1, 0).name;
    const blockFront = getBlockAtOffset(lookDx, 0, lookDz).name;

    const cs = (activeBot as unknown as { controlState?: Record<ControlKey, boolean> }).controlState || {
      forward: false,
      back: false,
      left: false,
      right: false,
      jump: false,
      sprint: false,
      sneak: false,
    };

    const timeOfDay = activeBot.time?.timeOfDay ?? 6000;
    const activeSlot = activeBot.quickBarSlot ?? 0;
    const heldSlotItem = hotbar[activeSlot];

    botState.worldPreview = {
      updatedAt: new Date().toISOString(),
      timeOfDay,
      isDay: timeOfDay < 13000 || timeOfDay > 23000,
      blockUnderfoot: blockUnder,
      blockAhead: blockFront,
      heldItem: activeBot.heldItem?.name || heldSlotItem?.name || 'empty_hand',
      heldItemDisplayName:
        activeBot.heldItem?.displayName || heldSlotItem?.displayName || 'Empty Hand',
      quickBarSlot: activeSlot,
      hotbar,
      activeControls: {
        forward: Boolean(cs.forward),
        back: Boolean(cs.back),
        left: Boolean(cs.left),
        right: Boolean(cs.right),
        jump: Boolean(cs.jump),
        sprint: Boolean(cs.sprint),
        sneak: Boolean(cs.sneak),
      },
      manualOverrideActive: Date.now() < manualOverrideUntil,
      voxels,
      entities: nearbyEntities.slice(0, 14),
    };
  } catch {
    // Ignore transient entity state access error
  }
}

function cleanupActiveBot(reason = 'Operator requested stop') {
  if (activeBot) {
    const botToClean = activeBot;
    activeBot = null;
    try {
      botToClean.clearControlStates();
      botToClean.removeAllListeners();
      botToClean.on('error', () => {});
      if (botToClean._client) {
        botToClean._client.removeAllListeners('keep_alive');
        botToClean._client.on('error', () => {});
      }
      botToClean.quit(reason);
    } catch {
      // Ignore cleanup errors
    }
  }
}

function scheduleReconnect(reason: string, customDelaySec?: number) {
  botState.lastDisconnectReason = reason;
  if (!botState.running) {
    botState.connectionState = 'Disconnected';
    botState.currentAction = 'Stopped by Operator';
    return;
  }

  if (!botState.config.autoReconnect) {
    botState.running = false;
    botState.connectionState = 'Disconnected';
    botState.currentAction = `Disconnected (${reason})`;
    appendLog('Reconnect', 'Alert', `Disconnected: ${reason}`, 'Auto-reconnect is disabled.');
    return;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  botState.reconnectAttempts += 1;
  const base = botState.config.reconnectBaseDelaySec;
  const max = botState.config.reconnectMaxDelaySec;
  const rawDelay =
    customDelaySec !== undefined
      ? customDelaySec
      : botState.config.exponentialBackoff
        ? Math.min(max, base * Math.pow(1.35, Math.min(5, botState.reconnectAttempts - 1)))
        : base;
  const delaySec = Math.max(4, Math.round(rawDelay));

  botState.connectionState = 'Reconnecting';
  botState.nextReconnectInSec = delaySec;
  botState.currentAction = `Waiting ${delaySec}s to rejoin (${reason})`;

  appendLog(
    'Reconnect',
    'Warning',
    `${reason} — Auto-rejoining in ${delaySec}s`,
    `24/7 Watchdog active for ${botState.config.host}:${botState.config.port}`
  );
}

/**
 * Resolves the live Aternos SRV port ONLY when the server is online.
 * Never overwrites the user's port with 25565 (which Aternos returns when a server is offline).
 */
async function resolveTrueAternosPort(host: string, fallbackPort: number): Promise<number> {
  try {
    const cleanHost = host.replace(/^_minecraft\._tcp\./i, '').trim();
    const records = await dns.promises.resolveSrv(`_minecraft._tcp.${cleanHost}`);
    if (Array.isArray(records) && records.length > 0 && records[0].port) {
      const srvPort = records[0].port;
      // When Aternos is offline, its SRV record points to 25565 (offline MOTD proxy).
      // Keep the real server port (e.g. 26832 or 46958) instead of overwriting with 25565.
      if (srvPort !== 25565) {
        return srvPort;
      }
    }
  } catch {
    // Fallback to configured port if no SRV record exists
  }
  return fallbackPort;
}

async function connectRealMineflayerBot(forceReconnect = false) {
  if (!forceReconnect && !botState.running) {
    return;
  }
  if (!forceReconnect && (activeBot || isCreatingBot)) {
    return;
  }
  if (isCreatingBot) return;
  isCreatingBot = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (activeBot) {
    cleanupActiveBot('Switching target server configuration');
  }

  const cfg = botState.config;
  const resolvedPort = await resolveTrueAternosPort(cfg.host, cfg.port);
  if (resolvedPort !== cfg.port && resolvedPort !== 25565) {
    appendLog(
      'Network',
      'Nominal',
      `Auto-detected live Aternos SRV port ${resolvedPort} for ${cfg.host}`,
      `Updated port from ${cfg.port} to ${resolvedPort}`
    );
    cfg.port = resolvedPort;
    savePersistentDiskState();
  }

  // Pre-probe the server via SLP before launching Mineflayer so we don't hit protocol -1 when Aternos is hibernating
  const pingCheck = await pingMinecraftServer(cfg.host, cfg.port);
  botState.lastPingResult = pingCheck;

  if (!pingCheck.online && (pingCheck.aternosState === 'Offline / Hibernating' || pingCheck.aternosState === 'Starting / Queue')) {
    isCreatingBot = false;
    const statusMsg =
      pingCheck.aternosState === 'Starting / Queue'
        ? `Aternos server is Starting / Loading (${pingCheck.motd})`
        : `Aternos server is currently Offline (${cfg.host}:${cfg.port}) — Start server on Aternos.org, bot will auto-join`;
    scheduleReconnect(statusMsg, 8);
    return;
  }

  botState.running = true;
  botState.connectionState = 'Connecting';
  botState.nextReconnectInSec = null;
  botState.currentAction = `Connecting to ${cfg.host}:${cfg.port}...`;

  const versionOption: string | boolean =
    !cfg.version || cfg.version.toLowerCase() === 'auto' ? false : cfg.version;

  appendLog(
    'Network',
    'Nominal',
    `Connecting permanent Mineflayer client -> ${cfg.host}:${cfg.port}`,
    `Username: ${cfg.username} · Anti-Kick Idle Reset Active · Keepalive Timeout: ${Math.max(180, cfg.keepaliveTimeoutSec)}s`
  );

  try {
    const bot = mineflayer.createBot({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      auth: cfg.auth,
      version: (typeof versionOption === 'string' ? versionOption : undefined) as string | undefined,
      checkTimeoutInterval: Math.max(240, cfg.keepaliveTimeoutSec) * 1000,
      hideErrors: true,
    });

    activeBot = bot;
    isCreatingBot = false;

    if (bot._client) {
      bot._client.on('connect', () => {
        try {
          const sock = (bot._client as unknown as { socket?: net.Socket }).socket;
          if (sock) {
            sock.setKeepAlive(true, 10000);
            sock.setNoDelay(true);
          }
        } catch {}
      });

      bot._client.on('error', (err: Error) => {
        appendLog(
          'Network',
          'Warning',
          `Protocol client notice: ${err.message}`,
          `Target: ${cfg.host}:${cfg.port}`
        );
      });
    }

    bot.on('login', () => {
      botState.connectionState = 'Connected';
      botState.startedAt = Date.now();
      botState.reconnectAttempts = 0;
      botState.detectedServerVersion = bot.version || 'Auto';
      botState.currentAction = 'Logged in · Awaiting world spawn';

      appendLog(
        'Server',
        'Nominal',
        `Joined ${cfg.host}:${cfg.port} as ${cfg.username} (Anti-Kick Shield Active)`,
        `Server Version: ${bot.version} · Continuous Movement + Idle Reset Ready`
      );
    });

    bot.once('spawn', () => {
      botState.connectionState = 'Connected';
      botState.detectedServerVersion = bot.version || 'Auto';
      syncBotTelemetry();

      botState.anchorPosition = {
        x: botState.position.x,
        y: botState.position.y,
        z: botState.position.z,
      };
      botState.trail = [
        {
          x: botState.position.x,
          z: botState.position.z,
          action: 'World Spawn Anchor Locked',
          timestamp: new Date().toISOString(),
        },
      ];
      botState.currentAction = 'Continuous All-Time Movement + Anti-Kick Active';

      appendLog(
        'Server',
        'Nominal',
        `Spawned at (${botState.position.x}, ${botState.position.y}, ${botState.position.z})`,
        `80m Anti-Kick Protection + Live 3D World Preview Active`
      );
    });

    bot.on('move', () => {
      syncBotTelemetry();
    });

    bot.on('health', () => {
      syncBotTelemetry();
      if (bot.health <= 0) {
        appendLog('Server', 'Warning', 'Bot died in-game — sending instant auto-respawn', `Health: ${bot.health}`);
        try {
          bot.respawn();
        } catch {}
      } else if (typeof bot.food === 'number' && bot.food < 16) {
        tryAutoEatFood();
      }
    });

    bot.on('messagestr', (msg) => {
      const clean = stripMinecraftFormatting(String(msg || ''));
      if (clean) {
        appendLog('Chat', 'Nominal', clean, 'In-game server broadcast');
      }
    });

    if (bot._client) {
      bot._client.on('keep_alive', (packet: { keepAliveId?: unknown }) => {
        botState.totalKeepalivesAcked += 1;
        const kaId =
          packet?.keepAliveId !== undefined ? String(packet.keepAliveId) : `#${botState.totalKeepalivesAcked}`;
        botState.lastKeepaliveAt = new Date().toISOString();
        botState.lastKeepaliveId = kaId;
        const pingLatency = bot.player?.ping ?? botState.lastPingResult?.latencyMs ?? 42;

        appendLog(
          'Keepalive',
          'Nominal',
          `Serverbound keep_alive ACK (#${botState.totalKeepalivesAcked})`,
          `Packet ID: ${kaId} · Ping: ${pingLatency}ms · Anti-Kick Pulses: ${botState.antiKickPulsesSent}`,
          pingLatency
        );
      });
    }

    bot.on('kicked', (reason) => {
      const reasonText =
        typeof reason === 'string' ? stripMinecraftFormatting(reason) : JSON.stringify(reason);
      botState.lastDisconnectReason = `Kicked: ${reasonText}`;
      if (reasonText.includes('duplicate_login')) {
        botState.running = false;
        botState.connectionState = 'Disconnected';
        botState.currentAction = 'Yielded: username already active in another client';
        appendLog(
          'Reconnect',
          'Alert',
          `Duplicate login detected: ${cfg.username} is connected from another client`,
          'Pausing web server bot to prevent conflict so your local bot runs uninterrupted'
        );
        return;
      }
      appendLog(
        'Reconnect',
        'Alert',
        `Kicked by server: ${reasonText}`,
        'Scheduling auto-reconnect'
      );
    });

    bot.on('error', (err) => {
      appendLog(
        'Network',
        'Warning',
        `Mineflayer socket notice: ${err.message}`,
        `Target: ${cfg.host}:${cfg.port}`
      );
    });

    bot.on('end', (reason) => {
      if (activeBot === bot) {
        activeBot = null;
        scheduleReconnect(reason || 'Server closed socket', 4);
      }
    });
  } catch (err) {
    isCreatingBot = false;
    const msg = err instanceof Error ? err.message : String(err);
    appendLog('Network', 'Alert', `Failed to initialize Mineflayer: ${msg}`, `${cfg.host}:${cfg.port}`);
    scheduleReconnect(msg, 6);
  }
}

/**
 * Continuous 400ms All-Time Movement + Humanized Anti-Kick Loop
 * Uses humanized walk-pause-strafe cadence so anti-AFK plugins never flag static held keys,
 * and conserves hunger by jumping only on 1-block ledges, in water, or every ~16s.
 */
let roamTick = 0;
setInterval(() => {
  if (!botState.running || !activeBot || !activeBot.entity || botState.connectionState !== 'Connected') {
    return;
  }

  // If operator is actively using manual controls, do not overwrite their control states
  if (Date.now() < manualOverrideUntil || isEatingFood) {
    syncBotTelemetry();
    return;
  }

  const cfg = botState.config;
  if (cfg.movementMode !== 'continuous_roam') {
    return;
  }

  roamTick += 1;
  const bot = activeBot;
  const pos = bot.entity.position;
  const dx = botState.anchorPosition.x - pos.x;
  const dz = botState.anchorPosition.z - pos.z;
  const distFromAnchor = Math.hypot(dx, dz);

  try {
    // 1. Check if we reached the patrol radius boundary or if there is a drop/hazard ahead
    const yawRad = bot.entity.yaw;
    const lookDx = Math.round(-Math.sin(yawRad));
    const lookDz = Math.round(-Math.cos(yawRad));

    const blockFeetAhead = getBlockAtOffset(lookDx, 0, lookDz);
    const blockHeadAhead = getBlockAtOffset(lookDx, 1, lookDz);
    const blockGroundAhead = getBlockAtOffset(lookDx, -1, lookDz);
    const blockDeepAhead = getBlockAtOffset(lookDx, -2, lookDz);

    const isHazardAhead =
      classifyBlockKind(blockFeetAhead.name) === 'lava' ||
      classifyBlockKind(blockGroundAhead.name) === 'lava' ||
      (blockGroundAhead.name === 'air' && blockDeepAhead.name === 'air');

    const isWallAhead = blockHeadAhead.boundingBox === 'block';
    const needJumpUp = blockFeetAhead.boundingBox === 'block' && blockHeadAhead.name === 'air';

    if (distFromAnchor > Math.max(2.0, cfg.walkRadiusBlocks) || isHazardAhead || isWallAhead) {
      // Smoothly steer back toward safe anchor center + slight random angle
      const targetYaw = Math.atan2(-dx, -dz) + (Math.random() * 0.5 - 0.25);
      Promise.resolve(bot.look(targetYaw, (Math.random() * 2 - 1) * 0.18, false)).catch(() => {});
    } else if (cfg.randomHeadLook && roamTick % 4 === 0) {
      // Gentle continuous yaw/pitch exploration while walking
      const nextYaw = bot.entity.yaw + (Math.random() * 1.1 - 0.55);
      const nextPitch = (Math.random() * 2 - 1) * 0.26;
      Promise.resolve(bot.look(nextYaw, nextPitch, false)).catch(() => {});
    }

    // 2. Humanized Walk / Micro-Pause Cadence (Releases forward key every 12th tick so anti-cheat sees fresh key-down packets)
    const isMicroPauseTick = roamTick % 12 === 0;
    if (cfg.autoWalk && !isMicroPauseTick) {
      bot.setControlState('forward', true);
      bot.setControlState('back', false);
      // Occasional strafe weave for natural movement
      if (roamTick % 7 === 0) {
        const strafeLeft = Math.random() > 0.5;
        bot.setControlState('left', strafeLeft);
        bot.setControlState('right', !strafeLeft);
      } else if (roamTick % 7 === 2) {
        bot.setControlState('left', false);
        bot.setControlState('right', false);
      }
    } else {
      bot.setControlState('forward', false);
      bot.setControlState('left', false);
      bot.setControlState('right', false);
    }

    // 3. Smart Jump (auto hop 1-block ledges, float in water, or periodic anti-AFK jump every ~16s to conserve food)
    const canAffordPeriodicJump = botState.food > 6;
    if (botState.inWater || needJumpUp || (cfg.autoJump && canAffordPeriodicJump && roamTick % 40 === 0)) {
      bot.setControlState('jump', true);
    } else {
      bot.setControlState('jump', false);
    }

    // 4. Intermittent arm swing & sneak pulse
    if (cfg.armSwing && roamTick % 9 === 0) {
      try {
        bot.swingArm('right');
      } catch {}
    }

    if (cfg.sneakPulse && roamTick % 16 === 0) {
      bot.setControlState('sneak', true);
    } else if (roamTick % 16 === 2) {
      bot.setControlState('sneak', false);
    }

    botState.currentAction = needJumpUp
      ? 'Continuous Walk + Auto-Step Jump'
      : `Continuous All-Time Roam (Anchor Dist ${distFromAnchor.toFixed(1)}m)`;

    syncBotTelemetry();

    if (roamTick % 8 === 0) {
      botState.totalMovementsExecuted += 1;
      botState.trail.push({
        x: botState.position.x,
        z: botState.position.z,
        action: botState.currentAction,
        timestamp: new Date().toISOString(),
      });
      if (botState.trail.length > 32) {
        botState.trail.shift();
      }
    }
  } catch {}
}, 400);

function executeRealAntiAfkStep(manualAction?: string) {
  const cfg = botState.config;
  const jitterMultiplier =
    1 + ((Math.random() * 2 - 1) * cfg.humanizeTimingJitterPct) / 100;

  if (!activeBot || !activeBot.entity || botState.connectionState !== 'Connected') {
    return;
  }

  const bot = activeBot;
  const pos = bot.entity.position;

  if (botState.inWater) {
    bot.setControlState('jump', true);
  }

  const dx = botState.anchorPosition.x - pos.x;
  const dz = botState.anchorPosition.z - pos.z;
  const distFromAnchor = Math.hypot(dx, dz);

  const mode = cfg.movementMode || 'continuous_roam';
  const stepMs = Math.min(350, Math.max(160, Math.round(cfg.walkDurationMs * jitterMultiplier)));

  try {
    if (mode === 'in_place_jump_look' && !manualAction?.includes('Walk')) {
      bot.setControlState('forward', false);
      bot.setControlState('back', false);
      bot.setControlState('left', false);
      bot.setControlState('right', false);
      if (cfg.randomHeadLook) {
        const yaw = (Math.random() * 2 - 1) * Math.PI;
        const pitch = (Math.random() * 2 - 1) * 0.28;
        Promise.resolve(bot.look(yaw, pitch, false)).catch(() => {});
      }
      if (cfg.autoJump || manualAction?.includes('Jump')) {
        bot.setControlState('jump', true);
        setTimeout(() => {
          try {
            if (activeBot === bot && !botState.inWater) bot.setControlState('jump', false);
          } catch {}
        }, 250);
      }
      if (cfg.armSwing) {
        try {
          bot.swingArm('right');
        } catch {}
      }
      botState.currentAction = 'In-Place Jump + Look + Arm Swing';
    } else if (mode === 'anchor_step_return') {
      if (distFromAnchor > Math.max(0.5, cfg.walkRadiusBlocks)) {
        const returnYaw = Math.atan2(-dx, -dz);
        Promise.resolve(bot.look(returnYaw, 0, true)).catch(() => {});
        bot.setControlState('forward', true);
        setTimeout(() => {
          try {
            if (activeBot === bot) bot.setControlState('forward', false);
          } catch {}
        }, stepMs);
        botState.currentAction = `Returning to Safe Anchor (Dist ${distFromAnchor.toFixed(2)}m)`;
      } else {
        if (cfg.randomHeadLook) {
          const yaw = (Math.random() * 2 - 1) * Math.PI;
          const pitch = (Math.random() * 2 - 1) * 0.25;
          Promise.resolve(bot.look(yaw, pitch, false)).catch(() => {});
        }
        if (cfg.autoWalk || manualAction?.includes('Walk')) {
          bot.setControlState('forward', true);
          setTimeout(() => {
            try {
              if (activeBot !== bot) return;
              bot.setControlState('forward', false);
              bot.setControlState('back', true);
              setTimeout(() => {
                try {
                  if (activeBot === bot) bot.setControlState('back', false);
                } catch {}
              }, stepMs);
            } catch {}
          }, stepMs);
        }
        if (cfg.autoJump || manualAction?.includes('Jump')) {
          bot.setControlState('jump', true);
          setTimeout(() => {
            try {
              if (activeBot === bot && !botState.inWater) bot.setControlState('jump', false);
            } catch {}
          }, 240);
        }
        botState.currentAction = `Safe Step-and-Return (${stepMs}ms) + Jump + Look`;
      }
    }

    setTimeout(() => {
      try {
        if (activeBot !== bot || !bot.entity) return;
        syncBotTelemetry();
        botState.totalMovementsExecuted += 1;
        const pingMs = bot.player?.ping ?? botState.lastPingResult?.latencyMs ?? 40;
        appendLog(
          'Movement',
          'Nominal',
          botState.currentAction,
          `Pos: (${botState.position.x}, ${botState.position.y}, ${botState.position.z}) · Anchor Drift: ${distFromAnchor.toFixed(2)}m · Players: ${botState.onlinePlayers.length}`,
          pingMs
        );
      } catch {}
    }, stepMs + 80);
  } catch {}
}

let tickCount = 0;
setInterval(() => {
  tickCount += 1;

  // Cloud Run External Self-Keepalive every 25s so the container never idles out after 1h 20m
  if (tickCount % 25 === 0 && lastExternalOrigin && lastExternalOrigin.startsWith('http')) {
    fetch(`${lastExternalOrigin.replace(/\/$/, '')}/api/bot/healthcheck`).catch(() => {});
  }

  if (!botState.running) {
    botState.currentAction = 'Bot Paused by Operator';
    return;
  }

  if (botState.connectionState === 'Reconnecting') {
    if (botState.nextReconnectInSec !== null && botState.nextReconnectInSec > 0) {
      botState.nextReconnectInSec -= 1;
      botState.currentAction = `Waiting ${botState.nextReconnectInSec}s before reconnect attempt #${botState.reconnectAttempts}`;
      if (botState.nextReconnectInSec <= 0) {
        botState.nextReconnectInSec = null;
        connectRealMineflayerBot(true);
      }
    }
    return;
  }

  if (botState.connectionState === 'Connected') {
    botState.uptimeSeconds += 1;
    botState.cumulativeUptimeSeconds += 1;
    syncBotTelemetry();

    const interval = Math.max(3, botState.config.walkIntervalSec);
    if (tickCount % interval === 0 && Date.now() >= manualOverrideUntil) {
      executeRealAntiAfkStep();
    }

    // Every 42 seconds, send a full Anti-Kick Activity Pulse (Hotbar Slot + ArmSwing + Sneak + Auto-Eat)
    if (tickCount % 42 === 0 && Date.now() >= manualOverrideUntil) {
      executeAntiKickActivityPulse();
    }

    if (tickCount % 15 === 0) {
      savePersistentDiskState();
    }
  }
}, 1000);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Enable CORS for Netlify, Vercel, and remote frontend dashboards
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Capture external Cloud Run host header for self-keepalive loop
  app.use((req, _res, next) => {
    const forwardedHost = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    if (forwardedHost && typeof forwardedHost === 'string' && !forwardedHost.includes('localhost')) {
      lastExternalOrigin = `${proto}://${forwardedHost}`;
    }
    next();
  });

  app.get('/api/bot/healthcheck', (_req, res) => {
    res.json({
      ok: true,
      state: botState.connectionState,
      uptime: botState.uptimeSeconds,
      antiKickPulses: botState.antiKickPulsesSent,
    });
  });

  app.get('/api/bot/state', (_req, res) => {
    syncBotTelemetry();
    res.json(botState);
  });

  // Full Live Movement & Action Controller Endpoint
  app.post('/api/bot/control', async (req, res) => {
    const { type, control, value, yawDelta, pitchDelta, yaw, pitch, action, slot } = req.body || {};

    if (!activeBot || !activeBot.entity || botState.connectionState !== 'Connected') {
      return res.json(botState);
    }

    const bot = activeBot;

    try {
      if (type === 'state' && control) {
        const validKeys: ControlKey[] = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'];
        if (validKeys.includes(control)) {
          manualOverrideUntil = Date.now() + (value ? 8000 : 2500);
          bot.setControlState(control, Boolean(value));
          botState.currentAction = `Manual Control: ${control.toUpperCase()} = ${Boolean(value) ? 'ON' : 'OFF'}`;
        }
      } else if (type === 'stop_all') {
        manualOverrideUntil = Date.now() + 3000;
        bot.clearControlStates();
        botState.currentAction = 'Manual Control: Stopped All Movement';
      } else if (type === 'look') {
        manualOverrideUntil = Date.now() + 3500;
        let nextYaw = bot.entity.yaw;
        let nextPitch = bot.entity.pitch;
        if (typeof yaw === 'number') {
          nextYaw = (yaw * Math.PI) / 180;
        } else if (typeof yawDelta === 'number') {
          nextYaw += (yawDelta * Math.PI) / 180;
        }
        if (typeof pitch === 'number') {
          nextPitch = (pitch * Math.PI) / 180;
        } else if (typeof pitchDelta === 'number') {
          nextPitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, nextPitch + (pitchDelta * Math.PI) / 180));
        }
        await bot.look(nextYaw, nextPitch, true);
        botState.currentAction = `Manual Camera Look (Yaw ${botState.position.yaw}°)`;
      } else if (type === 'hotbar' && typeof slot === 'number') {
        const safeSlot = Math.max(0, Math.min(8, Math.floor(slot)));
        bot.setQuickBarSlot(safeSlot);
        botState.currentAction = `Switched Hotbar to Slot #${safeSlot + 1}`;
      } else if (type === 'action' && action) {
        manualOverrideUntil = Date.now() + 2500;
        if (action === 'swing') {
          bot.swingArm('right');
          botState.currentAction = 'Manual Action: Right-Arm Swing';
        } else if (action === 'attack') {
          const target = bot.nearestEntity((e) => e !== bot.entity && e.position.distanceTo(bot.entity.position) < 4.5);
          if (target) {
            bot.attack(target);
            botState.currentAction = `Attacked nearest entity (${target.name || target.type})`;
          } else {
            bot.swingArm('right');
            botState.currentAction = 'Swung Arm (No entity within 4.5m)';
          }
        } else if (action === 'use') {
          bot.activateItem();
          setTimeout(() => {
            try {
              if (activeBot === bot) bot.deactivateItem();
            } catch {}
          }, 250);
          botState.currentAction = 'Manual Action: Activated Held Item (Right-Click)';
        } else if (action === 'drop') {
          if (bot.heldItem) {
            await bot.tossStack(bot.heldItem);
            botState.currentAction = `Dropped Held Item (${bot.heldItem.name})`;
          } else {
            botState.currentAction = 'Drop Ignored (Hand is empty)';
          }
        } else if (action === 'jump_once') {
          bot.setControlState('jump', true);
          setTimeout(() => {
            try {
              if (activeBot === bot) bot.setControlState('jump', false);
            } catch {}
          }, 300);
          botState.currentAction = 'Manual Action: Single Jump';
        } else if (action === 'respawn') {
          bot.respawn();
          botState.currentAction = 'Manual Action: Sent Respawn Packet';
        } else if (action === 'anti_kick_pulse') {
          executeAntiKickActivityPulse();
        }
      }
    } catch {}

    syncBotTelemetry();
    res.json(botState);
  });

  app.post('/api/server-ping', async (req, res) => {
    const host = (req.body?.host || botState.config.host).trim();
    const port = Number(req.body?.port || botState.config.port) || 26832;

    const result = await pingMinecraftServer(host, port);
    botState.lastPingResult = result;

    appendLog(
      'Network',
      result.online ? 'Nominal' : 'Warning',
      `Live TCP SLP Ping to ${host}:${port} -> ${result.aternosState}`,
      `MOTD: "${result.motd}" · Players: ${result.playersOnline}/${result.playersMax} · Version: ${result.versionName}`,
      result.latencyMs
    );

    if (result.online && botState.running && botState.connectionState !== 'Connected') {
      connectRealMineflayerBot(true);
    }

    res.json({ ping: result, state: botState });
  });

  app.post('/api/bot/start', (_req, res) => {
    botState.running = true;
    botState.reconnectAttempts = 0;
    connectRealMineflayerBot(true);
    savePersistentDiskState();
    res.json(botState);
  });

  app.post('/api/bot/stop', (_req, res) => {
    botState.running = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    cleanupActiveBot('Operator clicked Disconnect in console');
    botState.connectionState = 'Disconnected';
    botState.nextReconnectInSec = null;
    botState.currentAction = 'Disconnected by Operator';
    savePersistentDiskState();

    appendLog(
      'Server',
      'Warning',
      'Bot paused by operator',
      `Disconnected from ${botState.config.host}:${botState.config.port}`
    );

    res.json(botState);
  });

  app.post('/api/bot/lock-anchor', (_req, res) => {
    syncBotTelemetry();
    botState.anchorPosition = {
      x: botState.position.x,
      y: botState.position.y,
      z: botState.position.z,
    };
    appendLog(
      'Movement',
      'Nominal',
      `Locked new Safe Anchor at (${botState.anchorPosition.x}, ${botState.anchorPosition.y}, ${botState.anchorPosition.z})`,
      `Bot will now patrol within ±${botState.config.walkRadiusBlocks}m of this coordinate`
    );
    res.json(botState);
  });

  app.post('/api/bot/trigger-action', (req, res) => {
    const actionType: string = req.body?.action || 'Walk + Jump Impulse';
    if (!botState.running || (!activeBot && botState.connectionState !== 'Connecting')) {
      botState.running = true;
      connectRealMineflayerBot(true);
    } else if (actionType === 'Anti-Kick Pulse') {
      executeAntiKickActivityPulse();
    } else {
      executeRealAntiAfkStep(actionType);
    }
    res.json(botState);
  });

  app.post('/api/bot/chat', (req, res) => {
    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }
    if (activeBot && botState.connectionState === 'Connected') {
      try {
        activeBot.chat(message);
        appendLog('Chat', 'Nominal', `Sent in-game chat: "${message}"`, `As ${botState.config.username}`);
      } catch (err) {
        appendLog('Chat', 'Warning', `Failed to send chat: ${err instanceof Error ? err.message : String(err)}`, '');
      }
    } else {
      appendLog('Chat', 'Warning', 'Cannot send chat while bot is not connected', '');
    }
    res.json(botState);
  });

  app.post('/api/bot/config', (req, res) => {
    const incoming = req.body as Partial<BotConfig>;
    const prevHost = botState.config.host;
    const prevPort = botState.config.port;
    const prevUsername = botState.config.username;
    const prevAuth = botState.config.auth;

    botState.config = {
      ...botState.config,
      ...incoming,
      port: Number(incoming.port ?? botState.config.port) || 26832,
      walkIntervalSec: Math.max(2, Number(incoming.walkIntervalSec ?? botState.config.walkIntervalSec)),
      walkDurationMs: Math.max(150, Number(incoming.walkDurationMs ?? botState.config.walkDurationMs)),
      walkRadiusBlocks: Math.max(0, Number(incoming.walkRadiusBlocks ?? botState.config.walkRadiusBlocks)),
      jumpIntervalSec: Math.max(2, Number(incoming.jumpIntervalSec ?? botState.config.jumpIntervalSec)),
      humanizeTimingJitterPct: Math.max(0, Math.min(60, Number(incoming.humanizeTimingJitterPct ?? botState.config.humanizeTimingJitterPct))),
      reconnectBaseDelaySec: Math.max(2, Number(incoming.reconnectBaseDelaySec ?? botState.config.reconnectBaseDelaySec)),
      reconnectMaxDelaySec: Math.max(10, Number(incoming.reconnectMaxDelaySec ?? botState.config.reconnectMaxDelaySec)),
    };

    if (botState.config.movementMode !== 'continuous_roam' && activeBot) {
      try {
        activeBot.clearControlStates();
      } catch {}
    }

    savePersistentDiskState();

    const endpointChanged =
      prevHost !== botState.config.host ||
      prevPort !== botState.config.port ||
      prevUsername !== botState.config.username ||
      prevAuth !== botState.config.auth;

    appendLog(
      'Server',
      'Nominal',
      'Updated configuration without leaving server',
      `Mode: ${botState.config.movementMode} · Radius: ±${botState.config.walkRadiusBlocks}m`
    );

    if (endpointChanged && botState.running) {
      connectRealMineflayerBot(true);
    }

    res.json(botState);
  });

  app.post('/api/bot/clear-logs', (_req, res) => {
    botState.logs = [];
    appendLog(
      'Server',
      'Nominal',
      'Keepalive and telemetry log buffer cleared',
      `Monitoring active for ${botState.config.host}:${botState.config.port}`
    );
    res.json(botState);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AternosGuard permanent Mineflayer server running on http://0.0.0.0:${PORT}`);
    savePersistentDiskState();
    connectRealMineflayerBot(false);
  });
}

startServer();

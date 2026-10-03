import { BotConfig } from './scriptGenerator';
import { VoxelCell } from '../components/LiveWorldPreviewController';

export const LOCAL_STORAGE_API_KEY = 'aternos_bot_api_url';
export const LOCAL_STORAGE_CONFIG_KEY = 'aternos_bot_config';

/**
 * Gets configured Bot Backend API Base URL.
 * Returns empty string for same-origin (relative /api/...) by default.
 */
export function getApiBaseUrl(): string {
  try {
    const custom = localStorage.getItem(LOCAL_STORAGE_API_KEY);
    if (custom && custom.trim()) {
      return custom.trim().replace(/\/+$/, '');
    }
  } catch {}
  return '';
}

export function setApiBaseUrl(url: string): void {
  try {
    const clean = url.trim().replace(/\/+$/, '');
    if (clean) {
      localStorage.setItem(LOCAL_STORAGE_API_KEY, clean);
    } else {
      localStorage.removeItem(LOCAL_STORAGE_API_KEY);
    }
  } catch {}
}

/**
 * Returns true if running on Netlify or custom static frontend
 */
export function isNetlifyEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return host.includes('netlify.app') || host.includes('vercel.app') || host.includes('github.io');
}

/**
 * Generates an authentic interactive simulated snapshot for Netlify demo mode
 * when no remote Node.js backend is connected yet.
 */
export function createSimulatedBotState(config: BotConfig, tick = 0) {
  const isMoving = config.movementMode === 'continuous_roam' || config.autoWalk;
  const t = tick * 0.4;
  const yaw = Math.round(((t * 30) % 360));
  const dx = isMoving ? Math.sin(t * 0.5) * 2.2 : 0;
  const dz = isMoving ? Math.cos(t * 0.5) * 2.2 : 0;

  // Build a realistic 17x8x17 3D voxel chunk for the preview
  const voxels: VoxelCell[] = [];
  for (let x = -7; x <= 7; x++) {
    for (let z = -7; z <= 7; z++) {
      const dist = Math.hypot(x, z);
      if (dist <= 7.2) {
        voxels.push({ dx: x, dy: -1, dz: z, name: 'grass_block', kind: 'grass' });
        voxels.push({ dx: x, dy: -2, dz: z, name: 'dirt', kind: 'dirt' });
        voxels.push({ dx: x, dy: -3, dz: z, name: 'stone', kind: 'stone' });
      }
    }
  }

  // Add surrounding trees and ores
  voxels.push({ dx: 4, dy: 0, dz: 4, name: 'oak_log', kind: 'wood' });
  voxels.push({ dx: 4, dy: 1, dz: 4, name: 'oak_log', kind: 'wood' });
  voxels.push({ dx: 4, dy: 2, dz: 4, name: 'oak_leaves', kind: 'leaves' });
  voxels.push({ dx: -4, dy: 0, dz: -3, name: 'torch', kind: 'torch' });
  voxels.push({ dx: 2, dy: 0, dz: -4, name: 'poppy', kind: 'flower' });

  return {
    running: true,
    connectionState: 'Connected' as const,
    connectionMode: 'Netlify Standalone / Simulator Mode',
    detectedServerVersion: '1.20.4',
    startedAt: Date.now() - tick * 1000,
    uptimeSeconds: tick,
    cumulativeUptimeSeconds: tick,
    reconnectAttempts: 0,
    totalKeepalivesAcked: Math.floor(tick / 20) + 1,
    totalMovementsExecuted: Math.floor(tick * 2.5),
    antiKickPulsesSent: Math.floor(tick / 12) + 1,
    currentAction: isMoving ? 'Anti-AFK Continuous Roam Active' : 'Standby Guard',
    health: 20,
    food: 20,
    inWater: false,
    onlinePlayers: [config.username, 'Player_Guard'],
    position: {
      x: Number((10000.5 + dx).toFixed(2)),
      y: 73,
      z: Number((10000.5 + dz).toFixed(2)),
      yaw,
      pitch: -3,
    },
    anchorPosition: { x: 10000.5, y: 73, z: 10000.5 },
    trail: [
      { x: 10000.5, z: 10000.5, action: 'start', timestamp: new Date().toISOString() },
      { x: 10000.5 + dx, z: 10000.5 + dz, action: 'roam', timestamp: new Date().toISOString() },
    ],
    lastKeepaliveAt: new Date().toISOString(),
    lastKeepaliveId: `sim_ka_${tick}`,
    lastDisconnectReason: null,
    lastPingResult: {
      online: true,
      aternosState: 'Online' as const,
      latencyMs: 38,
      versionName: 'Paper 1.20.4',
      protocol: 765,
      playersOnline: 2,
      playersMax: 20,
      motd: `§a${config.host} §7Aternos Server Online`,
      checkedAt: new Date().toISOString(),
    },
    nextReconnectInSec: null,
    worldPreview: {
      updatedAt: new Date().toISOString(),
      timeOfDay: 6000,
      isDay: true,
      blockUnderfoot: 'grass_block',
      blockAhead: 'air',
      heldItem: 'diamond_sword',
      heldItemDisplayName: 'Diamond Sword',
      quickBarSlot: 0,
      hotbar: [
        { slot: 0, name: 'diamond_sword', displayName: 'Diamond Sword', count: 1 },
        { slot: 1, name: 'cooked_beef', displayName: 'Steak', count: 64 },
        { slot: 2, name: 'golden_apple', displayName: 'Golden Apple', count: 16 },
        { slot: 3, name: 'diamond_pickaxe', displayName: 'Diamond Pickaxe', count: 1 },
        { slot: 4, name: 'torch', displayName: 'Torch', count: 32 },
        { slot: 5, name: 'oak_planks', displayName: 'Oak Planks', count: 64 },
        { slot: 6, name: 'water_bucket', displayName: 'Water Bucket', count: 1 },
        { slot: 7, name: 'shield', displayName: 'Shield', count: 1 },
        { slot: 8, name: 'compass', displayName: 'Compass', count: 1 },
      ],
      activeControls: {
        forward: isMoving,
        back: false,
        left: false,
        right: false,
        jump: tick % 8 === 0,
        sprint: false,
        sneak: false,
      },
      manualOverrideActive: false,
      voxels,
      entities: [
        { id: 101, name: 'Wandering Villager', kind: 'mob' as const, dx: 3.5, dy: 0, dz: 2.1, distance: 4.1 },
        { id: 102, name: 'Cow', kind: 'mob' as const, dx: -4.2, dy: 0, dz: 3.8, distance: 5.6 },
      ],
    },
    config,
    logs: [
      {
        id: 'log_init',
        timestamp: new Date().toLocaleTimeString(),
        category: 'Server' as const,
        level: 'Nominal' as const,
        message: `Netlify Standalone Console Initialized for ${config.host}:${config.port}`,
        details: 'Connect a Node.js daemon (Render/VPS) or run python aternos_afk_bot_gui.py locally for 24/7 Minecraft socket connection.',
      },
    ],
  };
}

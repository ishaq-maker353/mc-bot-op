import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import {
  Eye,
  Gamepad2,
  Compass,
  Lock,
  Hand,
  Sword,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Octagon,
  Maximize,
  Minimize,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sparkles,
  Layers,
  Heart,
  Beef,
} from 'lucide-react';
import { MovementMode } from '../utils/scriptGenerator';
import { getApiBaseUrl } from '../utils/api';

export type ControlKey = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'sneak';

export type VoxelKind =
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

export interface VoxelCell {
  dx: number;
  dy: number;
  dz: number;
  name: string;
  kind: VoxelKind;
}

export interface NearbyEntityInfo {
  id: number;
  name: string;
  kind: 'player' | 'mob' | 'object';
  dx: number;
  dy: number;
  dz: number;
  yaw?: number;
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
  heldItemDisplayName?: string;
  quickBarSlot: number;
  hotbar?: Array<HotbarSlotItem | null>;
  activeControls: Record<ControlKey, boolean>;
  manualOverrideActive: boolean;
  voxels: VoxelCell[];
  entities: NearbyEntityInfo[];
}

interface LiveWorldPreviewControllerProps {
  position: { x: number; y: number; z: number; yaw: number; pitch: number };
  anchorPosition: { x: number; y: number; z: number };
  trail: Array<{ x: number; z: number; action: string; timestamp: string }>;
  worldPreview?: WorldPreviewSnapshot;
  health?: number;
  food?: number;
  movementMode: MovementMode;
  walkRadiusBlocks: number;
  onChangeMovementMode: (mode: MovementMode) => void;
  onLockAnchor: () => void;
  onStateUpdated: (newState: unknown) => void;
}

/**
 * Creates authentic 16x16 pixel-art Minecraft textures with NearestFilter
 */
function createPixelTexture(
  baseHex: string,
  noiseColors: string[],
  pattern?: 'grass_side' | 'planks' | 'log_side' | 'cobble' | 'ore' | 'glass' | 'water' | 'leaves'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 16, 16);

  let seed = baseHex.split('').reduce((acc, c) => acc + c.charCodeAt(0), 19);
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (rand() < 0.4 && noiseColors.length > 0) {
        ctx.fillStyle = noiseColors[Math.floor(rand() * noiseColors.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  if (pattern === 'grass_side') {
    const greens = ['#22C55E', '#16A34A', '#15803D', '#4ADE80'];
    for (let x = 0; x < 16; x++) {
      const depth = 2 + Math.floor(rand() * 3);
      for (let y = 0; y < depth; y++) {
        ctx.fillStyle = greens[Math.floor(rand() * greens.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  } else if (pattern === 'planks') {
    ctx.fillStyle = '#5C3A21';
    for (let y = 3; y < 16; y += 4) ctx.fillRect(0, y, 16, 1);
    ctx.fillRect(7, 0, 1, 4);
    ctx.fillRect(12, 4, 1, 4);
    ctx.fillRect(4, 8, 1, 4);
    ctx.fillRect(10, 12, 1, 4);
  } else if (pattern === 'log_side') {
    ctx.fillStyle = '#3E2723';
    for (let x = 0; x < 16; x += 3) ctx.fillRect(x, 0, 1, 16);
  } else if (pattern === 'cobble') {
    ctx.fillStyle = '#334155';
    for (let y = 0; y < 16; y += 4) ctx.fillRect(0, y, 16, 1);
  } else if (pattern === 'ore') {
    const flecks = ['#38BDF8', '#7DD3FC', '#FACC15', '#34D399'];
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = flecks[i % flecks.length];
      ctx.fillRect(2 + Math.floor(rand() * 12), 2 + Math.floor(rand() * 12), 2, 2);
    }
  } else if (pattern === 'glass') {
    ctx.clearRect(1, 1, 14, 14);
    ctx.fillStyle = 'rgba(186, 230, 253, 0.22)';
    ctx.fillRect(1, 1, 14, 14);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(2, 2, 3, 1);
    ctx.fillRect(2, 3, 1, 2);
  } else if (pattern === 'leaves') {
    // Semi-transparent cutout leaves
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (rand() < 0.18) {
          ctx.clearRect(x, y, 1, 1);
        }
      }
    }
  }

  // Subtle bevel stroke
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, 15, 15);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Creates 3D text sprites for floating nameplates
 */
function createNameplateSprite(name: string, isBot = false): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.roundRect(16, 12, 224, 40, 8);
  ctx.fill();

  ctx.font = 'bold 22px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isBot ? '#34D399' : '#38BDF8';
  ctx.fillText(name.slice(0, 16), 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(2.2, 0.55, 1);
  return sprite;
}

function getItemCategoryIcon(name: string): string {
  const n = (name || '').toLowerCase();
  if (n.includes('sword')) return '⚔️';
  if (n.includes('pickaxe')) return '⛏️';
  if (n.includes('axe')) return '🪓';
  if (n.includes('shovel')) return '🥄';
  if (n.includes('hoe')) return '🌾';
  if (n.includes('bow') || n.includes('crossbow')) return '🏹';
  if (n.includes('shield')) return '🛡️';
  if (n.includes('torch') || n.includes('lantern')) return '🔥';
  if (n.includes('beef') || n.includes('steak') || n.includes('pork') || n.includes('mutton') || n.includes('chicken') || n.includes('salmon')) return '🥩';
  if (n.includes('bread') || n.includes('wheat') || n.includes('cookie') || n.includes('pie')) return '🍞';
  if (n.includes('apple')) return '🍎';
  if (n.includes('carrot') || n.includes('potato') || n.includes('berries')) return '🥕';
  if (n.includes('potion') || n.includes('bottle')) return '🧪';
  if (n.includes('compass')) return '🧭';
  if (n.includes('clock')) return '⏰';
  if (n.includes('book')) return '📖';
  if (n.includes('diamond')) return '💎';
  if (n.includes('ingot')) return '🪙';
  if (n.includes('helmet') || n.includes('chestplate') || n.includes('leggings') || n.includes('boots')) return '🦺';
  if (n.includes('log') || n.includes('wood') || n.includes('plank')) return '🪵';
  if (n.includes('stone') || n.includes('cobble')) return '🪨';
  if (n.includes('bucket')) return '🪣';
  return '📦';
}

export const LiveWorldPreviewController: React.FC<LiveWorldPreviewControllerProps> = ({
  position,
  anchorPosition,
  trail,
  worldPreview,
  health = 20,
  food = 20,
  movementMode,
  walkRadiusBlocks,
  onChangeMovementMode,
  onLockAnchor,
  onStateUpdated,
}) => {
  const [viewMode, setViewMode] = useState<'orbit3d' | 'chase3d' | 'firstperson' | 'radar2d'>('orbit3d');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showFullscreenPad, setShowFullscreenPad] = useState<boolean>(false);
  const [latchMode, setLatchMode] = useState<boolean>(false);
  const [keyboardEnabled, setKeyboardEnabled] = useState<boolean>(true);
  const [showControlsDock, setShowControlsDock] = useState<boolean>(true);
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const orbitRef = useRef<{ theta: number; phi: number; distance: number }>({
    theta: Math.PI * 0.25,
    phi: 1.05,
    distance: 12.5,
  });
  const isDraggingRef = useRef<boolean>(false);
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const latestPosRef = useRef(position);
  const latestAnchorRef = useRef(anchorPosition);
  const latestPreviewRef = useRef(worldPreview);
  const latestViewModeRef = useRef(viewMode);
  const latestWalkRadiusRef = useRef(walkRadiusBlocks);

  useEffect(() => {
    latestPosRef.current = position;
  }, [position]);
  useEffect(() => {
    latestAnchorRef.current = anchorPosition;
  }, [anchorPosition]);
  useEffect(() => {
    latestPreviewRef.current = worldPreview;
  }, [worldPreview]);
  useEffect(() => {
    latestViewModeRef.current = viewMode;
  }, [viewMode]);
  useEffect(() => {
    latestWalkRadiusRef.current = walkRadiusBlocks;
  }, [walkRadiusBlocks]);

  const sendControlCommand = useCallback(
    async (payload: Record<string, unknown>) => {
      try {
        const base = getApiBaseUrl();
        const res = await fetch(`${base}/api/bot/control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = await res.json();
          onStateUpdated(data);
        }
      } catch {}
    },
    [onStateUpdated]
  );

  const handleControlPress = (control: ControlKey) => {
    const currentlyActive = Boolean(worldPreview?.activeControls?.[control]);
    if (latchMode) {
      sendControlCommand({ type: 'state', control, value: !currentlyActive });
    } else {
      sendControlCommand({ type: 'state', control, value: true });
    }
  };

  const handleControlRelease = (control: ControlKey) => {
    if (!latchMode) {
      sendControlCommand({ type: 'state', control, value: false });
    }
  };

  // Live Keyboard WASD Controller + Hotbar 1-9 & Fullscreen toggle
  useEffect(() => {
    if (!keyboardEnabled) return;

    const mapKeyToControl = (code: string): ControlKey | null => {
      switch (code) {
        case 'KeyW':
          return 'forward';
        case 'KeyS':
          return 'back';
        case 'KeyA':
          return 'left';
        case 'KeyD':
          return 'right';
        case 'Space':
          return 'jump';
        case 'ShiftLeft':
        case 'ShiftRight':
          return 'sneak';
        case 'KeyR':
          return 'sprint';
        default:
          return null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) {
        // Toggle Fullscreen on 'F' key
        e.preventDefault();
        setIsFullscreen((v) => !v);
        return;
      }
      if (e.code === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
        return;
      }
      if (e.repeat) return;

      const ctrl = mapKeyToControl(e.code);
      if (ctrl) {
        e.preventDefault();
        sendControlCommand({ type: 'state', control: ctrl, value: true });
        return;
      }

      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        sendControlCommand({ type: 'look', yawDelta: 22 });
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        sendControlCommand({ type: 'look', yawDelta: -22 });
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        sendControlCommand({ type: 'look', pitchDelta: 12 });
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        sendControlCommand({ type: 'look', pitchDelta: -12 });
      } else if (e.code === 'KeyE') {
        e.preventDefault();
        sendControlCommand({ type: 'action', action: 'use' });
      } else if (e.code === 'KeyQ') {
        e.preventDefault();
        sendControlCommand({ type: 'action', action: 'drop' });
      } else if (e.code.startsWith('Digit')) {
        const num = Number(e.code.replace('Digit', ''));
        if (num >= 1 && num <= 9) {
          sendControlCommand({ type: 'hotbar', slot: num - 1 });
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      const ctrl = mapKeyToControl(e.code);
      if (ctrl) {
        e.preventDefault();
        sendControlCommand({ type: 'state', control: ctrl, value: false });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [keyboardEnabled, isFullscreen, sendControlCommand]);

  // Sync fullscreen state with document.fullscreenElement
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, []);

  // Fullscreen trigger with graceful fallback
  const handleToggleFullscreen = () => {
    if (!isFullscreen) {
      if (containerRef.current?.requestFullscreen) {
        containerRef.current.requestFullscreen().catch(() => {
          setIsFullscreen(true);
        });
      } else {
        setIsFullscreen(true);
      }
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setIsFullscreen(false);
    }
  };

  // WebGL 3D World Scene
  const sceneRefs = useRef<{
    voxelGroup: THREE.Group;
    entityGroup: THREE.Group;
    patrolRing: THREE.Mesh;
    botHeldMesh: THREE.Group;
    fpHeldMesh: THREE.Group;
  } | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container || viewMode === 'radar2d') return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0A1424');
    scene.fog = new THREE.FogExp2('#0A1424', 0.026);

    const camera = new THREE.PerspectiveCamera(
      65,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      140
    );

    // Dynamic Lighting
    const hemiLight = new THREE.HemisphereLight('#BAE6FD', '#1E293B', 1.05);
    hemiLight.position.set(0, 30, 0);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight('#FFFBEB', 1.4);
    sunLight.position.set(16, 26, 14);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight('#38BDF8', 0.45);
    rimLight.position.set(-14, 12, -16);
    scene.add(rimLight);

    // Drifting Blocky Minecraft Clouds
    const cloudGroup = new THREE.Group();
    cloudGroup.position.set(0, 16, 0);
    const cloudMat = new THREE.MeshBasicMaterial({
      color: '#FFFFFF',
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 14; i++) {
      const cw = 4 + (i % 3) * 3;
      const cd = 3 + (i % 4) * 2;
      const cmesh = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.45, cd), cloudMat);
      cmesh.position.set(((i * 7) % 36) - 18, (i % 2) * 0.5, ((i * 11) % 36) - 18);
      cloudGroup.add(cmesh);
    }
    scene.add(cloudGroup);

    // Voxel & Entity Groups
    const voxelGroup = new THREE.Group();
    scene.add(voxelGroup);

    const entityGroup = new THREE.Group();
    scene.add(entityGroup);

    // Safe Patrol Anchor Ring
    const ringGeo = new THREE.RingGeometry(4.85, 5.05, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#10B981',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
    });
    const patrolRing = new THREE.Mesh(ringGeo, ringMat);
    patrolRing.position.set(0, -0.48, 0);
    scene.add(patrolRing);

    // Articulated 3D Minecraft Character (Steve / FrankAFK_Guard)
    const botRoot = new THREE.Group();
    scene.add(botRoot);

    const skinMat = new THREE.MeshStandardMaterial({ color: '#10B981', roughness: 0.5 });
    const visorMat = new THREE.MeshStandardMaterial({
      color: '#A7F3D0',
      emissive: new THREE.Color('#34D399'),
      emissiveIntensity: 0.8,
    });
    const armorMat = new THREE.MeshStandardMaterial({ color: '#0F172A', roughness: 0.4, metalness: 0.3 });
    const limbMat = new THREE.MeshStandardMaterial({ color: '#059669', roughness: 0.6 });
    const bootMat = new THREE.MeshStandardMaterial({ color: '#1E293B', roughness: 0.7 });

    // Floating Nameplate above bot
    const botNameplate = createNameplateSprite(latestPreviewRef.current?.heldItemDisplayName ? 'FrankAFK_Guard' : 'FrankAFK_Guard', true);
    botNameplate.position.set(0, 1.85, 0);
    botRoot.add(botNameplate);

    // Head
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.95, 0);
    botRoot.add(headPivot);

    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skinMat);
    headMesh.position.set(0, 0.25, 0);
    headMesh.castShadow = true;
    headPivot.add(headMesh);

    const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.05), visorMat);
    visorMesh.position.set(0, 0.26, -0.24);
    headPivot.add(visorMesh);

    // Direction Beam
    const beamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.25, -0.25),
      new THREE.Vector3(0, 0.25, -2.5),
    ]);
    const beamMat = new THREE.LineBasicMaterial({ color: '#34D399', transparent: true, opacity: 0.75 });
    headPivot.add(new THREE.Line(beamGeo, beamMat));

    // Torso
    const torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.28), armorMat);
    torsoMesh.position.set(0, 0.6, 0);
    torsoMesh.castShadow = true;
    botRoot.add(torsoMesh);

    // Left Arm
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.38, 0.92, 0);
    const leftArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.68, 0.24), limbMat);
    leftArmMesh.position.set(0, -0.28, 0);
    leftArmMesh.castShadow = true;
    leftArmPivot.add(leftArmMesh);
    botRoot.add(leftArmPivot);

    // Right Arm (holds the weapon/item)
    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.38, 0.92, 0);
    const rightArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.68, 0.24), limbMat);
    rightArmMesh.position.set(0, -0.28, 0);
    rightArmMesh.castShadow = true;
    rightArmPivot.add(rightArmMesh);

    // 3D Item in Right Hand
    const botHeldMesh = new THREE.Group();
    botHeldMesh.position.set(0, -0.6, -0.15);
    rightArmPivot.add(botHeldMesh);
    botRoot.add(rightArmPivot);

    // Legs
    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.13, 0.25, 0);
    const leftLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.72, 0.24), bootMat);
    leftLegMesh.position.set(0, -0.36, 0);
    leftLegMesh.castShadow = true;
    leftLegPivot.add(leftLegMesh);
    botRoot.add(leftLegPivot);

    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.13, 0.25, 0);
    const rightLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.72, 0.24), bootMat);
    rightLegMesh.position.set(0, -0.36, 0);
    rightLegMesh.castShadow = true;
    rightLegPivot.add(rightLegMesh);
    botRoot.add(rightLegPivot);

    // First-Person Camera Hand & Held Item
    const fpHeldMesh = new THREE.Group();
    fpHeldMesh.position.set(0.42, -0.32, -0.6);
    fpHeldMesh.rotation.set(0.25, -0.2, 0);

    const fpHandBase = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.52), limbMat);
    fpHeldMesh.add(fpHandBase);

    const fpItemSlot = new THREE.Group();
    fpItemSlot.position.set(0, 0.1, -0.3);
    fpHeldMesh.add(fpItemSlot);

    camera.add(fpHeldMesh);
    scene.add(camera);

    sceneRefs.current = {
      voxelGroup,
      entityGroup,
      patrolRing,
      botHeldMesh,
      fpHeldMesh: fpItemSlot,
    };

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    let frameId = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      const pos = latestPosRef.current;
      const anchor = latestAnchorRef.current;
      const preview = latestPreviewRef.current;
      const mode = latestViewModeRef.current;
      const radius = Math.max(1, latestWalkRadiusRef.current);

      // Cloud drift
      cloudGroup.position.x = Math.sin(elapsed * 0.05) * 6;

      // Day/Night transition
      const isDay = preview?.isDay ?? true;
      const targetSky = isDay ? new THREE.Color('#0F2642') : new THREE.Color('#050811');
      (scene.background as THREE.Color).lerp(targetSky, 0.05);
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.color.lerp(targetSky, 0.05);
      }
      sunLight.intensity = isDay ? 1.4 : 0.4;

      // Patrol Ring update
      const anchorDx = anchor.x - pos.x;
      const anchorDz = anchor.z - pos.z;
      patrolRing.position.set(anchorDx, -0.48, anchorDz);
      const scaleFactor = radius / 5.0;
      patrolRing.scale.set(scaleFactor, 1, scaleFactor);

      // Articulated Bot Walking/Jumping animation
      const yawRad = (pos.yaw * Math.PI) / 180;
      const pitchRad = (pos.pitch * Math.PI) / 180;
      const controls = preview?.activeControls;
      const isMoving = Boolean(controls?.forward || controls?.back || controls?.left || controls?.right);
      const isSneaking = Boolean(controls?.sneak);
      const isJumping = Boolean(controls?.jump);

      botRoot.rotation.y = yawRad;
      botRoot.position.y = isJumping ? Math.abs(Math.sin(elapsed * 10)) * 0.35 : isSneaking ? -0.12 : 0;
      torsoMesh.rotation.x = isSneaking ? 0.28 : 0;
      headPivot.rotation.x = pitchRad;

      if (isMoving) {
        const swing = Math.sin(elapsed * 10) * 0.7;
        leftLegPivot.rotation.x = swing;
        rightLegPivot.rotation.x = -swing;
        leftArmPivot.rotation.x = -swing * 0.85;
        rightArmPivot.rotation.x = swing * 0.85;
      } else {
        leftLegPivot.rotation.x *= 0.85;
        rightLegPivot.rotation.x *= 0.85;
        leftArmPivot.rotation.x = Math.sin(elapsed * 2) * 0.05;
        rightArmPivot.rotation.x = -Math.sin(elapsed * 2) * 0.05;
      }

      // Camera views
      if (mode === 'firstperson') {
        botRoot.visible = false;
        fpHeldMesh.visible = true;
        fpHeldMesh.position.y = -0.32 + (isMoving ? Math.sin(elapsed * 12) * 0.04 : Math.sin(elapsed * 2.5) * 0.01);
        camera.position.set(0, 1.38 + (isSneaking ? -0.15 : 0), 0);
        const lookDir = new THREE.Vector3(
          -Math.sin(yawRad) * Math.cos(pitchRad),
          Math.sin(pitchRad),
          -Math.cos(yawRad) * Math.cos(pitchRad)
        );
        camera.lookAt(camera.position.clone().add(lookDir));
      } else if (mode === 'chase3d') {
        botRoot.visible = true;
        fpHeldMesh.visible = false;
        const chaseDist = 5.2;
        const targetCamX = Math.sin(yawRad) * chaseDist;
        const targetCamZ = Math.cos(yawRad) * chaseDist;
        const targetCamY = 3.1 - Math.sin(pitchRad) * 1.6;
        camera.position.lerp(new THREE.Vector3(targetCamX, targetCamY, targetCamZ), 0.12);
        camera.lookAt(
          -Math.sin(yawRad) * 2.5,
          1.1 + Math.sin(pitchRad) * 1.2,
          -Math.cos(yawRad) * 2.5
        );
      } else {
        botRoot.visible = true;
        fpHeldMesh.visible = false;
        const { theta, phi, distance } = orbitRef.current;
        const cx = distance * Math.sin(phi) * Math.sin(theta);
        const cy = distance * Math.cos(phi);
        const cz = distance * Math.sin(phi) * Math.cos(theta);
        camera.position.lerp(new THREE.Vector3(cx, cy, cz), 0.18);
        camera.lookAt(0, 0.6, 0);
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.dispose();
      sceneRefs.current = null;
    };
  }, [viewMode]);

  // Synchronize 3D Voxel Meshes & Held Item in Hand
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs || viewMode === 'radar2d') return;

    const { voxelGroup, entityGroup, botHeldMesh, fpHeldMesh } = refs;

    // Clear and rebuild held item meshes
    while (botHeldMesh.children.length > 0) botHeldMesh.remove(botHeldMesh.children[0]);
    while (fpHeldMesh.children.length > 0) fpHeldMesh.remove(fpHeldMesh.children[0]);

    const heldItemName = (worldPreview?.heldItem || '').toLowerCase();
    if (heldItemName && heldItemName !== 'empty_hand' && heldItemName !== 'air') {
      const buildItemModel = (scale = 1) => {
        const itemRoot = new THREE.Group();
        if (heldItemName.includes('sword')) {
          // 3D Sword
          const blade = new THREE.Mesh(
            new THREE.BoxGeometry(0.1 * scale, 0.8 * scale, 0.05 * scale),
            new THREE.MeshStandardMaterial({
              color: heldItemName.includes('diamond') ? '#38BDF8' : '#F1F5F9',
              roughness: 0.3,
              metalness: 0.6,
            })
          );
          blade.position.set(0, 0.35 * scale, 0);
          itemRoot.add(blade);

          const hilt = new THREE.Mesh(
            new THREE.BoxGeometry(0.28 * scale, 0.07 * scale, 0.08 * scale),
            new THREE.MeshStandardMaterial({ color: '#A16207' })
          );
          hilt.position.set(0, -0.05 * scale, 0);
          itemRoot.add(hilt);
        } else if (heldItemName.includes('pickaxe') || heldItemName.includes('axe')) {
          // Tool Handle + Head
          const handle = new THREE.Mesh(
            new THREE.BoxGeometry(0.08 * scale, 0.75 * scale, 0.08 * scale),
            new THREE.MeshStandardMaterial({ color: '#78350F' })
          );
          itemRoot.add(handle);

          const head = new THREE.Mesh(
            new THREE.BoxGeometry(0.4 * scale, 0.16 * scale, 0.1 * scale),
            new THREE.MeshStandardMaterial({ color: '#38BDF8', roughness: 0.4 })
          );
          head.position.set(0, 0.32 * scale, 0);
          itemRoot.add(head);
        } else if (heldItemName.includes('torch')) {
          // Torch with glowing tip
          const stick = new THREE.Mesh(
            new THREE.BoxGeometry(0.1 * scale, 0.5 * scale, 0.1 * scale),
            new THREE.MeshStandardMaterial({ color: '#5D4037' })
          );
          itemRoot.add(stick);
          const flame = new THREE.Mesh(
            new THREE.BoxGeometry(0.14 * scale, 0.14 * scale, 0.14 * scale),
            new THREE.MeshBasicMaterial({ color: '#FBBF24' })
          );
          flame.position.set(0, 0.28 * scale, 0);
          itemRoot.add(flame);
        } else {
          // Mini Block Cube
          const cube = new THREE.Mesh(
            new THREE.BoxGeometry(0.35 * scale, 0.35 * scale, 0.35 * scale),
            new THREE.MeshStandardMaterial({ color: '#22C55E', roughness: 0.6 })
          );
          itemRoot.add(cube);
        }
        return itemRoot;
      };

      const botItem = buildItemModel(1);
      botItem.rotation.x = Math.PI / 4;
      botHeldMesh.add(botItem);

      const fpItem = buildItemModel(1.2);
      fpItem.rotation.set(-0.3, 0.3, 0.1);
      fpHeldMesh.add(fpItem);
    }

    // Rebuild Voxels with Detailed Geometries
    while (voxelGroup.children.length > 0) voxelGroup.remove(voxelGroup.children[0]);

    const voxels = worldPreview?.voxels || [];
    const blockMaterials = buildBlockMaterials();

    const standardBoxGeo = new THREE.BoxGeometry(1, 1, 1);
    const slabGeo = new THREE.BoxGeometry(1, 0.5, 1);
    const fenceGeo = new THREE.BoxGeometry(0.35, 1.0, 0.35);
    const torchGeo = new THREE.BoxGeometry(0.12, 0.65, 0.12);

    for (const v of voxels) {
      if (v.kind === 'air') continue;

      let mesh: THREE.Mesh;
      if (v.kind === 'slab') {
        mesh = new THREE.Mesh(slabGeo, blockMaterials.planks);
        mesh.position.set(v.dx, v.dy - 0.25, v.dz);
      } else if (v.kind === 'fence') {
        mesh = new THREE.Mesh(fenceGeo, blockMaterials.wood);
        mesh.position.set(v.dx, v.dy, v.dz);
      } else if (v.kind === 'torch') {
        const torchRoot = new THREE.Group();
        const stick = new THREE.Mesh(
          torchGeo,
          new THREE.MeshStandardMaterial({ color: '#5D4037' })
        );
        torchRoot.add(stick);
        const flame = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 0.18, 0.18),
          new THREE.MeshBasicMaterial({ color: '#FBBF24' })
        );
        flame.position.set(0, 0.34, 0);
        torchRoot.add(flame);
        torchRoot.position.set(v.dx, v.dy - 0.15, v.dz);
        voxelGroup.add(torchRoot);
        continue;
      } else if (v.kind === 'flower' || v.kind === 'flora') {
        // Detailed cross-quad flora
        const floraRoot = new THREE.Group();
        const stemMat = new THREE.MeshStandardMaterial({
          color: v.kind === 'flower' ? '#EF4444' : '#22C55E',
          roughness: 0.8,
        });
        const quad1 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.04), stemMat);
        quad1.rotation.y = Math.PI / 4;
        quad1.position.y = -0.1;
        const quad2 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.04), stemMat);
        quad2.rotation.y = -Math.PI / 4;
        quad2.position.y = -0.1;
        floraRoot.add(quad1, quad2);
        floraRoot.position.set(v.dx, v.dy, v.dz);
        voxelGroup.add(floraRoot);
        continue;
      } else if (v.kind === 'water') {
        mesh = new THREE.Mesh(standardBoxGeo, blockMaterials.water);
        mesh.scale.set(1, 0.88, 1);
        mesh.position.set(v.dx, v.dy - 0.06, v.dz);
      } else {
        const mat = blockMaterials[v.kind] || blockMaterials.solid;
        mesh = new THREE.Mesh(standardBoxGeo, mat);
        mesh.position.set(v.dx, v.dy, v.dz);
        mesh.receiveShadow = true;
        if (v.dy >= 0) mesh.castShadow = true;
      }
      voxelGroup.add(mesh);
    }

    // Rebuild Nearby Entities with Floating 3D Nameplates
    while (entityGroup.children.length > 0) entityGroup.remove(entityGroup.children[0]);

    if (worldPreview?.entities) {
      for (const ent of worldPreview.entities) {
        if (Math.abs(ent.dx) > 14 || Math.abs(ent.dz) > 14) continue;
        const entNode = new THREE.Group();
        entNode.position.set(ent.dx, ent.dy, ent.dz);
        if (typeof ent.yaw === 'number') {
          entNode.rotation.y = (ent.yaw * Math.PI) / 180;
        }

        const isPlayer = ent.kind === 'player';
        const bodyMat = new THREE.MeshStandardMaterial({
          color: isPlayer ? '#38BDF8' : '#F43F5E',
          roughness: 0.5,
        });
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.3, 0.35), bodyMat);
        body.position.set(0, 0.45, 0);
        body.castShadow = true;
        entNode.add(body);

        const head = new THREE.Mesh(
          new THREE.BoxGeometry(0.46, 0.46, 0.46),
          new THREE.MeshStandardMaterial({ color: isPlayer ? '#F8FAFC' : '#991B1B' })
        );
        head.position.set(0, 1.35, 0);
        entNode.add(head);

        // 3D Floating Nameplate
        const plate = createNameplateSprite(ent.name || 'Player', false);
        plate.position.set(0, 1.85, 0);
        entNode.add(plate);

        entityGroup.add(entNode);
      }
    }
  }, [worldPreview, viewMode]);

  // Pointer drag Orbit / Look
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = true;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastPointerRef.current.x;
    const dy = e.clientY - lastPointerRef.current.y;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };

    if (viewMode === 'orbit3d') {
      orbitRef.current.theta -= dx * 0.011;
      orbitRef.current.phi = Math.max(0.2, Math.min(1.5, orbitRef.current.phi - dy * 0.009));
    } else if ((viewMode === 'firstperson' || viewMode === 'chase3d') && Math.abs(dx) + Math.abs(dy) > 2) {
      sendControlCommand({
        type: 'look',
        yawDelta: -dx * 0.45,
        pitchDelta: -dy * 0.35,
      });
    }
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  const handleZoom = (delta: number) => {
    orbitRef.current.distance = Math.max(4.0, Math.min(28, orbitRef.current.distance + delta));
  };

  const activeControls = worldPreview?.activeControls || {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false,
  };

  const hotbarSlots: Array<HotbarSlotItem | null> =
    worldPreview?.hotbar && worldPreview.hotbar.length === 9
      ? worldPreview.hotbar
      : Array.from({ length: 9 }, (_, i) =>
          i === (worldPreview?.quickBarSlot ?? 0) && worldPreview?.heldItem
            ? {
                slot: i,
                name: worldPreview.heldItem,
                displayName: worldPreview.heldItemDisplayName || worldPreview.heldItem,
                count: 1,
              }
            : null
        );

  const activeSlotIdx = worldPreview?.quickBarSlot ?? 0;
  const activeHeldDisplayName =
    worldPreview?.heldItemDisplayName ||
    hotbarSlots[activeSlotIdx]?.displayName ||
    (worldPreview?.heldItem ? worldPreview.heldItem.replace(/_/g, ' ') : 'Empty Hand');

  return (
    <div
      ref={containerRef}
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 w-screen h-screen bg-[#090D16] overflow-hidden select-none'
          : 'relative border border-slate-800 rounded-xl bg-[#1E293B]/40 p-4 space-y-3 select-none'
      }
    >
      {/* Top Header Bar */}
      <div
        className={
          isFullscreen
            ? 'absolute top-3 left-4 right-4 z-30 pointer-events-auto flex items-center justify-between bg-black/75 backdrop-blur-md px-3.5 py-2 rounded-xl border border-white/10 shadow-2xl'
            : 'flex flex-wrap items-center justify-between gap-2'
        }
      >
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-emerald-400 shrink-0" />
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
            <span>Live 3D World</span>
            <span className="text-xs text-slate-400 font-mono font-normal">
              ({worldPreview?.voxels?.length ?? 0} blocks · {worldPreview?.entities?.length ?? 0} entities)
            </span>
          </h2>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Camera Modes */}
          <div className="flex items-center gap-0.5 p-0.5 bg-[#090D16]/90 backdrop-blur-sm border border-slate-800 rounded-lg">
            {(
              [
                ['orbit3d', '3D Orbit'],
                ['chase3d', '3rd-Person'],
                ['firstperson', '1st-Person POV'],
                ['radar2d', '2D Radar'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setViewMode(key)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  viewMode === key
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Fullscreen Floating Controls Toggle Button */}
          {isFullscreen && (
            <button
              onClick={() => setShowFullscreenPad((v) => !v)}
              title="Toggle On-Screen Movement Controls"
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1.5 cursor-pointer ${
                showFullscreenPad
                  ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50'
                  : 'bg-[#090D16] text-slate-300 hover:text-white border-slate-800'
              }`}
            >
              <Gamepad2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{showFullscreenPad ? 'Hide Pad' : 'Pad'}</span>
            </button>
          )}

          {/* Full Screen Toggle Button */}
          <button
            onClick={handleToggleFullscreen}
            title={isFullscreen ? 'Exit Full Screen (Esc / F)' : 'Enter Full Screen (F)'}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1.5 cursor-pointer ${
              isFullscreen
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                : 'bg-[#090D16] text-slate-200 hover:text-white border-slate-800'
            }`}
          >
            {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isFullscreen ? 'Exit Full' : 'Full Screen'}</span>
          </button>
        </div>
      </div>

      {/* In-Fullscreen Floating Movement Controls */}
      {isFullscreen && showFullscreenPad && (
        <div className="absolute top-16 right-4 z-30 pointer-events-auto bg-black/85 backdrop-blur-md p-3 rounded-xl border border-white/10 shadow-2xl space-y-2.5 w-60">
          <div className="flex items-center justify-between text-[11px] text-slate-300 pb-1.5 border-b border-white/10">
            <span className="font-semibold flex items-center gap-1.5 text-emerald-400">
              <Gamepad2 className="w-3.5 h-3.5" />
              On-Screen Controls
            </span>
            <button
              onClick={() => sendControlCommand({ type: 'stop_all' })}
              className="text-red-400 hover:text-red-300 text-[10px] font-medium cursor-pointer"
            >
              Stop All
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1">
            <div />
            <button
              onMouseDown={() => handleControlPress('forward')}
              onMouseUp={() => handleControlRelease('forward')}
              className={`py-1.5 text-xs font-bold rounded border flex items-center justify-center transition-colors cursor-pointer ${
                activeControls.forward ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-200'
              }`}
            >
              W
            </button>
            <div />

            <button
              onMouseDown={() => handleControlPress('left')}
              onMouseUp={() => handleControlRelease('left')}
              className={`py-1.5 text-xs font-bold rounded border flex items-center justify-center transition-colors cursor-pointer ${
                activeControls.left ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-200'
              }`}
            >
              A
            </button>
            <button
              onMouseDown={() => handleControlPress('back')}
              onMouseUp={() => handleControlRelease('back')}
              className={`py-1.5 text-xs font-bold rounded border flex items-center justify-center transition-colors cursor-pointer ${
                activeControls.back ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-200'
              }`}
            >
              S
            </button>
            <button
              onMouseDown={() => handleControlPress('right')}
              onMouseUp={() => handleControlRelease('right')}
              className={`py-1.5 text-xs font-bold rounded border flex items-center justify-center transition-colors cursor-pointer ${
                activeControls.right ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-200'
              }`}
            >
              D
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1 pt-0.5">
            <button
              onMouseDown={() => handleControlPress('jump')}
              onMouseUp={() => handleControlRelease('jump')}
              className={`py-1 text-[11px] font-semibold rounded border transition-colors cursor-pointer ${
                activeControls.jump ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-200'
              }`}
            >
              Jump
            </button>
            <button
              onMouseDown={() => handleControlPress('sprint')}
              onMouseUp={() => handleControlRelease('sprint')}
              className={`py-1 text-[11px] font-semibold rounded border transition-colors cursor-pointer ${
                activeControls.sprint ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-200'
              }`}
            >
              Sprint
            </button>
            <button
              onMouseDown={() => handleControlPress('sneak')}
              onMouseUp={() => handleControlRelease('sneak')}
              className={`py-1 text-[11px] font-semibold rounded border transition-colors cursor-pointer ${
                activeControls.sneak ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-200'
              }`}
            >
              Sneak
            </button>
          </div>

          <div className="flex items-center justify-between gap-1 pt-1">
            <button
              onClick={() => sendControlCommand({ type: 'action', action: 'attack' })}
              className="flex-1 py-1 text-[10px] font-medium rounded bg-red-950/70 border border-red-700 text-red-200 hover:bg-red-900 cursor-pointer"
            >
              Attack
            </button>
            <button
              onClick={() => sendControlCommand({ type: 'action', action: 'use' })}
              className="flex-1 py-1 text-[10px] font-medium rounded bg-indigo-950/70 border border-indigo-700 text-indigo-200 hover:bg-indigo-900 cursor-pointer"
            >
              Use Item
            </button>
            <button
              onClick={() => sendControlCommand({ type: 'action', action: 'drop' })}
              className="flex-1 py-1 text-[10px] font-medium rounded bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
            >
              Drop Q
            </button>
          </div>
        </div>
      )}

      {/* 3D WebGL Viewport Container */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={(e) => {
          if (viewMode === 'orbit3d') handleZoom(e.deltaY * 0.01);
        }}
        className={
          isFullscreen
            ? 'w-full h-full absolute inset-0 z-0 bg-[#090D16] cursor-grab active:cursor-grabbing overflow-hidden'
            : 'relative w-full h-[400px] sm:h-[470px] bg-[#090D16] border border-slate-800 rounded-lg overflow-hidden cursor-grab active:cursor-grabbing'
        }
      >
        {viewMode !== 'radar2d' ? (
          <div ref={mountRef} className="w-full h-full" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="-100 -100 200 200" className="w-full h-full max-w-[340px]">
              <line x1="-100" y1="0" x2="100" y2="0" stroke="#1E293B" strokeWidth="1" />
              <line x1="0" y1="-100" x2="0" y2="100" stroke="#1E293B" strokeWidth="1" />
              <circle cx="0" cy="0" r="68" fill="rgba(16, 185, 129, 0.05)" stroke="#059669" strokeWidth="1" strokeDasharray="4 3" />
              {trail.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#10B981"
                  strokeOpacity="0.5"
                  strokeWidth="1.75"
                  points={trail
                    .map((pt) => {
                      const scale = 68 / Math.max(1, walkRadiusBlocks);
                      const dx = Math.max(-92, Math.min(92, (pt.x - anchorPosition.x) * scale));
                      const dz = Math.max(-92, Math.min(92, (pt.z - anchorPosition.z) * scale));
                      return `${dx.toFixed(1)},${dz.toFixed(1)}`;
                    })
                    .join(' ')}
                />
              )}
              <circle cx="0" cy="0" r="3" fill="#64748B" />
              {(() => {
                const scale = 68 / Math.max(1, walkRadiusBlocks);
                const bx = Math.max(-90, Math.min(90, (position.x - anchorPosition.x) * scale));
                const bz = Math.max(-90, Math.min(90, (position.z - anchorPosition.z) * scale));
                const rad = (position.yaw * Math.PI) / 180;
                return (
                  <g>
                    <line x1={bx} y1={bz} x2={bx - Math.sin(rad) * 18} y2={bz - Math.cos(rad) * 18} stroke="#34D399" strokeWidth="2" />
                    <circle cx={bx} cy={bz} r="5" fill="#10B981" />
                  </g>
                );
              })()}
            </svg>
          </div>
        )}

        {/* 1st-Person Crosshair */}
        {viewMode === 'firstperson' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-4 h-4 relative">
              <div className="absolute top-1/2 left-0 w-full h-[1.5px] -translate-y-1/2 bg-white/80" />
              <div className="absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 bg-white/80" />
            </div>
          </div>
        )}

        {/* Top-Left Telemetry HUD */}
        <div className="absolute top-3 left-3 z-10 text-[11px] font-mono tabular-nums text-slate-200 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 pointer-events-none space-y-0.5">
          <div>
            XYZ: <span className="text-emerald-400 font-semibold">{position.x.toFixed(1)}, {position.y.toFixed(1)}, {position.z.toFixed(1)}</span>
            {' · '}Yaw: <span className="text-slate-300">{position.yaw.toFixed(0)}°</span>
          </div>
          <div className="text-[10px] text-slate-400">
            Under: <span className="text-amber-300">{worldPreview?.blockUnderfoot || 'grass'}</span> · Ahead: <span className="text-sky-300">{worldPreview?.blockAhead || 'air'}</span>
          </div>
        </div>

        {/* Zoom quick-buttons */}
        {viewMode === 'orbit3d' && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-black/60 backdrop-blur-md p-1 rounded-lg border border-white/10">
            <button
              type="button"
              onClick={() => handleZoom(-2.5)}
              title="Zoom In"
              className="p-1 text-slate-300 hover:text-white cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleZoom(2.5)}
              title="Zoom Out"
              className="p-1 text-slate-300 hover:text-white cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                orbitRef.current = { theta: Math.PI * 0.25, phi: 1.05, distance: 12.5 };
              }}
              title="Reset View"
              className="p-1 text-slate-300 hover:text-white cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Bottom Minecraft HUD: Health Hearts, Food Shanks, & Item Hotbar */}
        <div className="absolute bottom-3 left-0 right-0 z-30 flex flex-col items-center gap-1.5 pointer-events-auto select-none px-2">
          {/* Active Tooltip above Hotbar */}
          <div className="text-xs font-mono font-medium text-slate-100 bg-black/85 backdrop-blur-md px-3.5 py-1 rounded-md border border-white/15 shadow-xl animate-fade-in flex items-center gap-2">
            <span>
              {hoveredSlot !== null && hotbarSlots[hoveredSlot]
                ? `${hotbarSlots[hoveredSlot]!.displayName} (Slot ${hoveredSlot + 1})`
                : activeHeldDisplayName}
            </span>
            <span className="text-[10px] text-emerald-400 font-sans">
              [Slot {activeSlotIdx + 1} Active]
            </span>
          </div>

          {/* Health & Hunger Bars */}
          <div className="flex items-center justify-between w-full max-w-[380px] px-2 text-[11px] font-mono text-slate-200 bg-black/50 backdrop-blur-sm rounded-md py-0.5">
            <div className="flex items-center gap-1">
              <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500" />
              <span>{health}/20 HP</span>
            </div>
            <div className="flex items-center gap-1">
              <span>{food}/20 Food</span>
              <Beef className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
            </div>
          </div>

          {/* Authentic 9-Slot Minecraft Item Hotbar */}
          <div className="flex items-center gap-1.5 p-1.5 bg-black/85 backdrop-blur-md border-2 border-slate-600 rounded-xl shadow-2xl overflow-x-auto max-w-full">
            {hotbarSlots.map((item, idx) => {
              const isSelected = activeSlotIdx === idx;
              return (
                <button
                  key={idx}
                  onClick={() => sendControlCommand({ type: 'hotbar', slot: idx })}
                  onMouseEnter={() => setHoveredSlot(idx)}
                  onMouseLeave={() => setHoveredSlot(null)}
                  title={item ? `${item.displayName} (Slot ${idx + 1}) - Count: ${item.count}` : `Slot ${idx + 1} (Empty)`}
                  className={`relative w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-700/90 border-2 border-white scale-105 shadow-[0_0_12px_rgba(255,255,255,0.5)] z-10'
                      : 'bg-slate-900/90 border border-slate-700 hover:border-slate-500 hover:bg-slate-800'
                  }`}
                >
                  {/* Slot Number Badge */}
                  <span className={`absolute top-0.5 left-1 text-[9px] font-mono pointer-events-none ${isSelected ? 'text-white font-bold' : 'text-slate-400'}`}>
                    {idx + 1}
                  </span>

                  {/* Item Icon */}
                  {item ? (
                    <span className="text-xl leading-none filter drop-shadow select-none">
                      {getItemCategoryIcon(item.name)}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-600 select-none">·</span>
                  )}

                  {/* Stack Count Badge */}
                  {item && item.count > 1 && (
                    <span className="absolute bottom-0.5 right-1 text-[11px] font-mono font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,1)] bg-black/60 px-1 rounded-sm leading-tight">
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Mode Switcher & Gamepad Dock Controls */}
      <div className={`flex flex-wrap items-center justify-between gap-2 pt-1 ${isFullscreen ? 'hidden' : ''}`}>
        <div className="flex flex-wrap items-center gap-1">
          <Compass className="w-3.5 h-3.5 text-emerald-400 mr-1" />
          {(
            [
              ['continuous_roam', 'All-Time Move'],
              ['anchor_step_return', 'Safe Step'],
              ['in_place_jump_look', 'Jump Only'],
            ] as const
          ).map(([modeKey, label]) => (
            <button
              key={modeKey}
              onClick={() => onChangeMovementMode(modeKey)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                movementMode === modeKey
                  ? 'bg-emerald-600 border-emerald-500 text-white'
                  : 'bg-[#090D16] border-slate-800 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setKeyboardEnabled((v) => !v)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
              keyboardEnabled
                ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                : 'bg-[#090D16] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {keyboardEnabled ? 'WASD Keys: ON' : 'WASD Keys'}
          </button>

          <button
            onClick={() => setLatchMode((v) => !v)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
              latchMode
                ? 'bg-amber-950/60 border-amber-700 text-amber-200'
                : 'bg-[#090D16] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {latchMode ? 'Latch: ON' : 'Hold Mode'}
          </button>

          <button
            onClick={() => setShowControlsDock((v) => !v)}
            className="px-2.5 py-1 text-[11px] font-medium rounded-md border bg-[#090D16] border-slate-800 text-slate-300 hover:bg-slate-800 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Gamepad2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>{showControlsDock ? 'Hide Pad' : 'Show Pad'}</span>
          </button>
        </div>
      </div>

      {/* Collapsible Gamepad Controls */}
      {showControlsDock && !isFullscreen && (
        <div className="pt-2 border-t border-slate-800/80 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* WASD D-Pad */}
            <div className="bg-[#090D16] border border-slate-800 rounded-lg p-2.5 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Movement Pad</span>
                <button
                  onClick={() => sendControlCommand({ type: 'stop_all' })}
                  className="text-red-400 hover:text-red-300 font-medium flex items-center gap-1 cursor-pointer"
                >
                  <Octagon className="w-3 h-3" />
                  <span>Stop</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <div />
                <button
                  onMouseDown={() => handleControlPress('forward')}
                  onMouseUp={() => handleControlRelease('forward')}
                  onMouseLeave={() => !latchMode && activeControls.forward && handleControlRelease('forward')}
                  className={`py-1.5 text-xs font-semibold rounded border flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                    activeControls.forward
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200'
                  }`}
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                  <span>W</span>
                </button>
                <div />

                <button
                  onMouseDown={() => handleControlPress('left')}
                  onMouseUp={() => handleControlRelease('left')}
                  onMouseLeave={() => !latchMode && activeControls.left && handleControlRelease('left')}
                  className={`py-1.5 text-xs font-semibold rounded border flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                    activeControls.left
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200'
                  }`}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>A</span>
                </button>

                <button
                  onMouseDown={() => handleControlPress('back')}
                  onMouseUp={() => handleControlRelease('back')}
                  onMouseLeave={() => !latchMode && activeControls.back && handleControlRelease('back')}
                  className={`py-1.5 text-xs font-semibold rounded border flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                    activeControls.back
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200'
                  }`}
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                  <span>S</span>
                </button>

                <button
                  onMouseDown={() => handleControlPress('right')}
                  onMouseUp={() => handleControlRelease('right')}
                  onMouseLeave={() => !latchMode && activeControls.right && handleControlRelease('right')}
                  className={`py-1.5 text-xs font-semibold rounded border flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                    activeControls.right
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200'
                  }`}
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>D</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <button
                  onMouseDown={() => handleControlPress('jump')}
                  onMouseUp={() => handleControlRelease('jump')}
                  className={`py-1 text-[11px] font-medium rounded border transition-colors cursor-pointer ${
                    activeControls.jump
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
                  }`}
                >
                  Jump
                </button>
                <button
                  onClick={() =>
                    sendControlCommand({ type: 'state', control: 'sprint', value: !activeControls.sprint })
                  }
                  className={`py-1 text-[11px] font-medium rounded border transition-colors cursor-pointer ${
                    activeControls.sprint
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
                  }`}
                >
                  Sprint
                </button>
                <button
                  onClick={() =>
                    sendControlCommand({ type: 'state', control: 'sneak', value: !activeControls.sneak })
                  }
                  className={`py-1 text-[11px] font-medium rounded border transition-colors cursor-pointer ${
                    activeControls.sneak
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
                  }`}
                >
                  Sneak
                </button>
              </div>
            </div>

            {/* Look & Actions */}
            <div className="bg-[#090D16] border border-slate-800 rounded-lg p-2.5 space-y-2 flex flex-col justify-between">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Look & Hand Actions</span>
                <span className="font-mono tabular-nums">
                  {position.yaw.toFixed(0)}° / {position.pitch.toFixed(0)}°
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <button
                  onClick={() => sendControlCommand({ type: 'look', yawDelta: 30 })}
                  className="py-1.5 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-200 cursor-pointer"
                >
                  ← Left
                </button>
                <button
                  onClick={() => sendControlCommand({ type: 'look', pitchDelta: 15 })}
                  className="py-1.5 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-200 cursor-pointer"
                >
                  ↑ Up
                </button>
                <button
                  onClick={() => sendControlCommand({ type: 'look', yawDelta: -30 })}
                  className="py-1.5 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-200 cursor-pointer"
                >
                  Right →
                </button>

                <button
                  onClick={() => sendControlCommand({ type: 'look', yawDelta: 180 })}
                  className="py-1.5 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-300 cursor-pointer"
                >
                  180°
                </button>
                <button
                  onClick={() => sendControlCommand({ type: 'look', pitchDelta: -15 })}
                  className="py-1.5 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-200 cursor-pointer"
                >
                  ↓ Down
                </button>
                <button
                  onClick={onLockAnchor}
                  className="py-1.5 text-[11px] font-medium bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-800/60 rounded text-emerald-300 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Lock className="w-3 h-3" />
                  <span>Anchor</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <button
                  onClick={() => sendControlCommand({ type: 'action', action: 'attack' })}
                  className="py-1 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-200 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Sword className="w-3 h-3 text-emerald-400" />
                  <span>Attack</span>
                </button>
                <button
                  onClick={() => sendControlCommand({ type: 'action', action: 'use' })}
                  className="py-1 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-200 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Hand className="w-3 h-3 text-sky-400" />
                  <span>Use</span>
                </button>
                <button
                  onClick={() => sendControlCommand({ type: 'action', action: 'drop' })}
                  className="py-1 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-300 cursor-pointer"
                >
                  Drop
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function buildBlockMaterials(): Record<VoxelKind, THREE.Material | THREE.Material[]> {
  const grassTop = new THREE.MeshStandardMaterial({
    map: createPixelTexture('#22C55E', ['#16A34A', '#15803D', '#4ADE80']),
    roughness: 0.85,
  });
  const dirtMat = new THREE.MeshStandardMaterial({
    map: createPixelTexture('#854D0E', ['#713F12', '#A16207', '#5C3A21']),
    roughness: 0.92,
  });
  const grassSide = new THREE.MeshStandardMaterial({
    map: createPixelTexture('#854D0E', ['#713F12', '#A16207'], 'grass_side'),
    roughness: 0.88,
  });

  const logSide = new THREE.MeshStandardMaterial({
    map: createPixelTexture('#5D4037', ['#4E342E', '#3E2723', '#6D4C41'], 'log_side'),
    roughness: 0.85,
  });
  const logTop = new THREE.MeshStandardMaterial({
    map: createPixelTexture('#A1887F', ['#8D6E63', '#5D4037']),
    roughness: 0.85,
  });

  return {
    air: new THREE.MeshBasicMaterial({ visible: false }),
    grass: [grassSide, grassSide, grassTop, dirtMat, grassSide, grassSide],
    dirt: dirtMat,
    stone: new THREE.MeshStandardMaterial({
      map: createPixelTexture('#64748B', ['#475569', '#94A3B8', '#334155']),
      roughness: 0.8,
    }),
    cobble: new THREE.MeshStandardMaterial({
      map: createPixelTexture('#475569', ['#334155', '#64748B', '#1E293B'], 'cobble'),
      roughness: 0.85,
    }),
    wood: [logSide, logSide, logTop, logTop, logSide, logSide],
    planks: new THREE.MeshStandardMaterial({
      map: createPixelTexture('#B45309', ['#92400E', '#D97706', '#78350F'], 'planks'),
      roughness: 0.8,
    }),
    leaves: new THREE.MeshStandardMaterial({
      map: createPixelTexture('#15803D', ['#14532D', '#166534', '#22C55E'], 'leaves'),
      roughness: 0.9,
      transparent: true,
      alphaTest: 0.1,
    }),
    sand: new THREE.MeshStandardMaterial({
      map: createPixelTexture('#FDE047', ['#FACC15', '#FEF08A', '#EAB308']),
      roughness: 0.88,
    }),
    snow: new THREE.MeshStandardMaterial({
      map: createPixelTexture('#F8FAFC', ['#E2E8F0', '#FFFFFF', '#CBD5E1']),
      roughness: 0.6,
    }),
    ore: new THREE.MeshStandardMaterial({
      map: createPixelTexture('#64748B', ['#475569', '#334155'], 'ore'),
      roughness: 0.5,
      metalness: 0.25,
    }),
    water: new THREE.MeshStandardMaterial({
      map: createPixelTexture('#0284C7', ['#0369A1', '#38BDF8', '#0EA5E9'], 'water'),
      transparent: true,
      opacity: 0.74,
      roughness: 0.2,
      metalness: 0.1,
    }),
    lava: new THREE.MeshStandardMaterial({
      map: createPixelTexture('#EA580C', ['#F97316', '#DC2626', '#FACC15']),
      emissive: new THREE.Color('#EA580C'),
      emissiveIntensity: 0.85,
      roughness: 0.4,
    }),
    glass: new THREE.MeshStandardMaterial({
      map: createPixelTexture('#BAE6FD', ['#E0F2FE'], 'glass'),
      transparent: true,
      opacity: 0.45,
      roughness: 0.15,
    }),
    light: new THREE.MeshStandardMaterial({
      map: createPixelTexture('#FDE047', ['#FEF08A', '#F59E0B', '#FFFFFF']),
      emissive: new THREE.Color('#FBBF24'),
      emissiveIntensity: 1.1,
    }),
    torch: new THREE.MeshBasicMaterial({ color: '#FBBF24' }),
    flora: new THREE.MeshStandardMaterial({ color: '#22C55E' }),
    flower: new THREE.MeshStandardMaterial({ color: '#EF4444' }),
    slab: new THREE.MeshStandardMaterial({ color: '#B45309' }),
    fence: new THREE.MeshStandardMaterial({ color: '#78350F' }),
    solid: new THREE.MeshStandardMaterial({
      map: createPixelTexture('#94A3B8', ['#64748B', '#CBD5E1', '#475569']),
      roughness: 0.75,
    }),
  };
}

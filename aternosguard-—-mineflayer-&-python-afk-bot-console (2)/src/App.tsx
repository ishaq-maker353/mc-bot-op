import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  Play,
  Square,
  RefreshCw,
  Download,
  Copy,
  Check,
  Search,
  Trash2,
  Terminal,
  Compass,
  RotateCcw,
  Send,
  ShieldCheck,
  Globe,
  Server,
  AlertCircle,
  ExternalLink,
  Settings,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';
import {
  BotConfig,
  MovementMode,
  generatePythonMineflayerGuiScript,
  generateNodeMineflayerScript,
} from './utils/scriptGenerator';
import {
  getApiBaseUrl,
  setApiBaseUrl,
  isNetlifyEnvironment,
  createSimulatedBotState,
} from './utils/api';
import {
  LiveWorldPreviewController,
  WorldPreviewSnapshot,
} from './components/LiveWorldPreviewController';

interface LogEntry {
  id: string;
  timestamp: string;
  category: 'Keepalive' | 'Movement' | 'Network' | 'Reconnect' | 'Server' | 'Chat';
  level: 'Nominal' | 'Warning' | 'Alert';
  message: string;
  details: string;
  latencyMs?: number;
}

interface BotPosition {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

interface ServerPingResult {
  online: boolean;
  aternosState: 'Online' | 'Offline / Hibernating' | 'Starting / Queue' | 'Unreachable';
  latencyMs: string | number;
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
  antiKickPulsesSent?: number;
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
  worldPreview?: WorldPreviewSnapshot;
  config: BotConfig;
  logs: LogEntry[];
}

type ActiveSection = 'console' | 'antiafk' | 'reconnect' | 'code';
type LogFilter = 'All' | 'Keepalive' | 'Movement' | 'Chat' | 'Network' | 'Reconnect';

function formatUptime(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${String(hrs).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
}

function formatTimeOnly(isoString: string | null): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '—';
  }
}

export default function App() {
  const [state, setState] = useState<BotRuntimeState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [pinging, setPinging] = useState<boolean>(false);
  const [activeSection, setActiveSection] = useState<ActiveSection>('console');
  const [logFilter, setLogFilter] = useState<LogFilter>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [draftConfig, setDraftConfig] = useState<BotConfig | null>(() => {
    try {
      const saved = localStorage.getItem('aternos_bot_config');
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });
  const [configSavedNotice, setConfigSavedNotice] = useState<boolean>(false);
  const [codeTab, setCodeTab] = useState<'python' | 'node' | 'deploy' | 'setup'>('python');
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [chatMessage, setChatMessage] = useState<string>('');
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);

  const [apiBaseUrl, setApiBaseUrlState] = useState<string>(() => getApiBaseUrl());
  const [isSimulatorMode, setIsSimulatorMode] = useState<boolean>(() => isNetlifyEnvironment() && !getApiBaseUrl());
  const [showBackendModal, setShowBackendModal] = useState<boolean>(false);
  const [inputBackendUrl, setInputBackendUrl] = useState<string>(() => getApiBaseUrl());
  const [backendConnectStatus, setBackendConnectStatus] = useState<string | null>(null);
  const simTickRef = useRef<number>(1);

  const fetchBotState = async () => {
    const base = getApiBaseUrl();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`${base}/api/bot/state`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data: BotRuntimeState = await res.json();
        setState(data);
        setIsSimulatorMode(false);
        setDraftConfig((prev) => {
          if (prev) return prev;
          try {
            const saved = localStorage.getItem('aternos_bot_config');
            if (saved) return JSON.parse(saved);
          } catch {}
          return data.config;
        });
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch {
      // Backend unreachable or on static Netlify CDN
      if (isNetlifyEnvironment() || !base || isSimulatorMode) {
        setIsSimulatorMode(true);
        simTickRef.current += 1;
        const currentCfg: BotConfig = draftConfig || {
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
        };
        setState((prev) => {
          const sim = createSimulatedBotState(currentCfg, simTickRef.current);
          return {
            ...sim,
            anchorPosition: prev?.anchorPosition || sim.anchorPosition,
            config: currentCfg,
          };
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // Background Web Worker + Screen Wake Lock
  useEffect(() => {
    fetchBotState();
    const interval = setInterval(fetchBotState, 650);

    let worker: Worker | null = null;
    let workerUrl = '';
    try {
      const base = getApiBaseUrl();
      const workerCode = `
        setInterval(() => {
          fetch('${base}/api/bot/healthcheck').catch(() => {});
          postMessage('tick');
        }, 8000);
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      workerUrl = URL.createObjectURL(blob);
      worker = new Worker(workerUrl);
      worker.onmessage = () => {
        fetchBotState();
      };
    } catch {}

    let wakeLockSentinel: { release?: () => Promise<void> } | null = null;
    const requestWakeLock = async () => {
      try {
        const nav = navigator as unknown as {
          wakeLock?: { request: (type: string) => Promise<{ release?: () => Promise<void> }> };
        };
        if (nav.wakeLock) {
          wakeLockSentinel = await nav.wakeLock.request('screen');
          setWakeLockActive(true);
        }
      } catch {
        setWakeLockActive(false);
      }
    };

    requestWakeLock();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
        fetchBotState();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (worker) worker.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      if (wakeLockSentinel?.release) {
        wakeLockSentinel.release().catch(() => {});
      }
    };
  }, []);

  const handlePingServer = async () => {
    setPinging(true);
    const base = getApiBaseUrl();
    const host = draftConfig?.host || state?.config.host || 'alamincraft.aternos.me';
    const port = draftConfig?.port || state?.config.port || 26832;
    try {
      const res = await fetch(`${base}/api/server-ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port }),
      });
      if (res.ok) {
        const data = await res.json();
        setState(data.state);
        return;
      }

      // Simulated response for Netlify static host
      if (isSimulatorMode || isNetlifyEnvironment()) {
        await new Promise((r) => setTimeout(r, 450));
        setState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            lastPingResult: {
              online: true,
              aternosState: 'Online',
              latencyMs: Math.floor(Math.random() * 20) + 32,
              versionName: 'Paper 1.20.4',
              protocol: 765,
              playersOnline: prev.onlinePlayers.length,
              playersMax: 20,
              motd: `§a${host} §7Aternos Server Online`,
              checkedAt: new Date().toISOString(),
            },
          };
        });
      }
    } catch {
      if (isSimulatorMode || isNetlifyEnvironment()) {
        setState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            lastPingResult: {
              online: true,
              aternosState: 'Online',
              latencyMs: Math.floor(Math.random() * 20) + 32,
              versionName: 'Paper 1.20.4',
              protocol: 765,
              playersOnline: prev.onlinePlayers.length,
              playersMax: 20,
              motd: `§a${host} §7Aternos Server Online`,
              checkedAt: new Date().toISOString(),
            },
          };
        });
      }
    } finally {
      setPinging(false);
    }
  };

  const handleToggleBot = async () => {
    if (!state) return;
    if (isSimulatorMode) {
      setState((prev) =>
        prev
          ? {
              ...prev,
              running: !prev.running,
              connectionState: !prev.running ? 'Connected' : 'Disconnected',
              currentAction: !prev.running ? 'Anti-AFK Continuous Roam Active' : 'Bot Paused (Simulator)',
            }
          : prev
      );
      return;
    }
    const base = getApiBaseUrl();
    const endpoint = state.running ? `${base}/api/bot/stop` : `${base}/api/bot/start`;
    const res = await fetch(endpoint, { method: 'POST' });
    if (res.ok) {
      const updated = await res.json();
      setState(updated);
    }
  };

  const handleLockAnchor = async () => {
    if (isSimulatorMode && state) {
      setState({
        ...state,
        anchorPosition: { x: state.position.x, y: state.position.y, z: state.position.z },
      });
      return;
    }
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/bot/lock-anchor`, { method: 'POST' });
    if (res.ok) {
      const updated = await res.json();
      setState(updated);
    }
  };

  const handleTriggerAction = async (action: string) => {
    if (isSimulatorMode && state) {
      setState((prev) =>
        prev
          ? {
              ...prev,
              antiKickPulsesSent: (prev.antiKickPulsesSent || 0) + 1,
              currentAction: `Manual Trigger: ${action}`,
            }
          : prev
      );
      return;
    }
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/bot/trigger-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      const updated = await res.json();
      setState(updated);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    const msg = chatMessage.trim();
    setChatMessage('');

    if (isSimulatorMode && state) {
      const newLog: LogEntry = {
        id: `sim_chat_${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        category: 'Chat',
        level: 'Nominal',
        message: `<${activeConfig.username}> ${msg}`,
        details: 'Sent via Netlify Standalone Controller',
      };
      setState({ ...state, logs: [newLog, ...state.logs] });
      return;
    }
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/bot/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    });
    if (res.ok) {
      const updated = await res.json();
      setState(updated);
    }
  };

  const handleSaveConfig = async (newCfg: BotConfig) => {
    setDraftConfig(newCfg);
    try {
      localStorage.setItem('aternos_bot_config', JSON.stringify(newCfg));
    } catch {}
    if (isSimulatorMode) {
      setConfigSavedNotice(true);
      setTimeout(() => setConfigSavedNotice(false), 2000);
      return;
    }
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/bot/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCfg),
    });
    if (res.ok) {
      const updated = await res.json();
      setState(updated);
      setConfigSavedNotice(true);
      setTimeout(() => setConfigSavedNotice(false), 2000);
    }
  };

  const handleClearLogs = async () => {
    if (isSimulatorMode && state) {
      setState({ ...state, logs: [] });
      return;
    }
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/bot/clear-logs`, { method: 'POST' });
    if (res.ok) {
      const updated = await res.json();
      setState(updated);
    }
  };

  const handleSaveBackendUrl = async (urlToSave: string) => {
    setBackendConnectStatus('Testing connection...');
    const clean = urlToSave.trim().replace(/\/+$/, '');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${clean}/api/bot/healthcheck`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        setApiBaseUrl(clean);
        setApiBaseUrlState(clean);
        setBackendConnectStatus('Connected successfully! Loading bot telemetry...');
        setIsSimulatorMode(false);
        setTimeout(() => {
          setShowBackendModal(false);
          setBackendConnectStatus(null);
          fetchBotState();
        }, 1200);
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      setBackendConnectStatus(`Failed to connect to ${clean || 'server'}: ${err}. Ensure your bot server is running and CORS is enabled.`);
    }
  };

  const handleResetToSimulator = () => {
    setApiBaseUrl('');
    setApiBaseUrlState('');
    setInputBackendUrl('');
    setIsSimulatorMode(true);
    setBackendConnectStatus('Switched to Standalone Simulator mode.');
    setTimeout(() => {
      setShowBackendModal(false);
      setBackendConnectStatus(null);
    }, 1000);
  };

  const filteredLogs = useMemo(() => {
    if (!state) return [];
    return state.logs.filter((entry) => {
      const matchesCategory = logFilter === 'All' || entry.category === logFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        entry.message.toLowerCase().includes(q) ||
        entry.details.toLowerCase().includes(q) ||
        entry.category.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [state, logFilter, searchQuery]);

  const activeConfig: BotConfig = draftConfig || state?.config || {
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
  };

  const pythonScript = useMemo(() => generatePythonMineflayerGuiScript(activeConfig), [activeConfig]);
  const nodeScript = useMemo(() => generateNodeMineflayerScript(activeConfig), [activeConfig]);
  const setupInstructions = useMemo(
    () => `# 1. Install Node.js (>= 18) and Python (>= 3.9)
# 2. Install the Mineflayer package and Python-to-JS bridge:
npm install mineflayer
pip install javascript

# 3. Launch the Python + Mineflayer Desktop GUI Monitor for ${activeConfig.host}:${activeConfig.port}:
python aternos_afk_bot_gui.py

# Or run the headless 24/7 Node.js daemon:
node bot_mineflayer.js`,
    [activeConfig]
  );

  const deployInstructions = useMemo(
    () => `# =========================================================
# HOW TO RUN YOUR 24/7 MINECRAFT BOT (FREE 24/7 HOSTING GUIDE)
# =========================================================

# 1. OPTION A: 24/7 CLOUD HOST ON RAILWAY (RAILWAY.APP)
# ---------------------------------------------------------
# Step 1: Push this project codebase to a GitHub repository.
# Step 2: Open https://railway.app and click "New Project".
# Step 3: Choose "Deploy from GitHub repo" and select your repository.
# Step 4: Railway automatically detects the included "railway.json" and "Dockerfile".
# Step 5: After deploying, click your service -> "Settings" -> "Networking" -> click "Generate Domain".
#         (You will get a URL like: https://aternosguard-production.up.railway.app)
# Step 6: Open your Netlify website, click "Connect Bot Server" (top-right), paste your Railway URL and click Connect!
#         Your Netlify dashboard will now be 100% connected to your 24/7 Railway bot!

# 2. OPTION B: FREE 24/7 CLOUD HOST ON RENDER (RENDER.COM)
# ---------------------------------------------------------
# Step 1: Open https://dashboard.render.com and click "New" -> "Web Service".
# Step 2: Connect your GitHub repository.
# Step 3: Render automatically detects the included "render.yaml" blueprint!
# Step 4: Copy your live Render URL (e.g. https://aternos-guard-bot.onrender.com).
# Step 5: In Netlify, click "Connect Bot Server" and paste your Render URL.

# 3. OPTION C: RUN LOCALLY ON WINDOWS / MAC / LINUX
# ---------------------------------------------------------
npm install mineflayer
node bot_mineflayer.js

# 4. OPTION D: RUN 24/7 ON ANDROID (TERMUX)
# ---------------------------------------------------------
pkg update && pkg install nodejs
npm install mineflayer
node bot_mineflayer.js
`,
    []
  );

  const displayedCode =
    codeTab === 'python'
      ? pythonScript
      : codeTab === 'node'
        ? nodeScript
        : codeTab === 'deploy'
          ? deployInstructions
          : setupInstructions;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(displayedCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {}
  };

  const handleDownloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportLogsCsv = () => {
    if (!state) return;
    const header = 'Timestamp,Category,Level,Message,Details,LatencyMs\n';
    const rows = state.logs
      .map(
        (l) =>
          `"${l.timestamp}","${l.category}","${l.level}","${l.message.replace(/"/g, '""')}","${l.details.replace(/"/g, '""')}",${l.latencyMs ?? ''}`
      )
      .join('\n');
    handleDownloadFile(`aternos_keepalive_logs_${Date.now()}.csv`, header + rows);
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-100 flex flex-col">
      {/* Top Header Bar */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-[#0F172A] sticky top-0 z-30">
        <a
          href="#console"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('console');
          }}
          className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap flex items-center gap-2"
        >
          <span>AternosGuard</span>
          <span className="text-[11px] font-mono font-normal text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-2 py-0.5 rounded">
            {isSimulatorMode ? 'Netlify Standalone' : 'Connected'}
          </span>
        </a>

        {/* Navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-400">
          <a
            href="#console"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('console');
            }}
            className={`transition-colors whitespace-nowrap pb-0.5 ${
              activeSection === 'console'
                ? 'text-slate-100 border-b-2 border-emerald-500'
                : 'hover:text-slate-200'
            }`}
          >
            3D World & Hotbar
          </a>
          <a
            href="#antiafk"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('antiafk');
            }}
            className={`transition-colors whitespace-nowrap pb-0.5 ${
              activeSection === 'antiafk'
                ? 'text-slate-100 border-b-2 border-emerald-500'
                : 'hover:text-slate-200'
            }`}
          >
            Movement Settings
          </a>
          <a
            href="#reconnect"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('reconnect');
            }}
            className={`transition-colors whitespace-nowrap pb-0.5 ${
              activeSection === 'reconnect'
                ? 'text-slate-100 border-b-2 border-emerald-500'
                : 'hover:text-slate-200'
            }`}
          >
            Server & Watchdog
          </a>
          <a
            href="#code"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('code');
            }}
            className={`transition-colors whitespace-nowrap pb-0.5 ${
              activeSection === 'code'
                ? 'text-slate-100 border-b-2 border-emerald-500'
                : 'hover:text-slate-200'
            }`}
          >
            Python & JS Code
          </a>
        </nav>

        {/* Start / Pause Bot Button & Netlify / Server Connect */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBackendModal(true)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              isSimulatorMode
                ? 'bg-amber-950/60 border-amber-700/80 text-amber-300 hover:bg-amber-900/60'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
            title="Configure Bot Backend Server"
          >
            <Server className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">
              {isSimulatorMode ? 'Connect Bot Server' : 'Backend: Connected'}
            </span>
          </button>

          <button
            onClick={handleToggleBot}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              state?.running
                ? 'bg-slate-800 hover:bg-red-950/80 text-slate-200 hover:text-red-200 border border-slate-700'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {state?.running ? (
              <>
                <Square className="w-3 h-3 fill-current" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 fill-current" />
                <span>Start Bot</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Netlify Static Mode Banner */}
      {isSimulatorMode && (
        <div className="bg-amber-950/40 border-b border-amber-800/60 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2 text-amber-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Netlify Static Hosting Detected:</strong> Netlify hosts the web UI. For a 24/7 Minecraft socket bot on Aternos, connect a free Node.js daemon (Render/Railway) or run the Python GUI locally.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBackendModal(true)}
              className="px-2.5 py-1 text-[11px] font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-md cursor-pointer transition-colors"
            >
              Connect Server
            </button>
            <button
              onClick={() => {
                setActiveSection('code');
                setCodeTab('deploy');
              }}
              className="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-md cursor-pointer transition-colors"
            >
              Hosting Guide
            </button>
          </div>
        </div>
      )}

      {/* Backend Server Connection Modal */}
      {showBackendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#1E293B] border border-slate-700 rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700/80 pb-3">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-slate-100">Bot Backend & Netlify Setup</h3>
              </div>
              <button
                onClick={() => {
                  setShowBackendModal(false);
                  setBackendConnectStatus(null);
                }}
                className="text-slate-400 hover:text-white text-lg font-mono cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-2 leading-relaxed">
              <p>
                <strong>Why Netlify needs a Bot Backend:</strong> Netlify is a static website host and does not run persistent Node.js background processes or raw TCP Minecraft sockets to Aternos servers.
              </p>
              <p className="text-slate-400">
                You can connect this dashboard to any live bot server (e.g. Render, Railway, VPS, or localhost), or run the bot script locally on your PC / phone.
              </p>
            </div>

            <div className="space-y-3 bg-[#090D16] p-3.5 rounded-lg border border-slate-800">
              <label className="block text-xs font-semibold text-slate-200">
                Bot Server URL (Render, Railway, VPS, or localhost)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="https://my-bot-server.onrender.com or http://localhost:3000"
                  value={inputBackendUrl}
                  onChange={(e) => setInputBackendUrl(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs font-mono bg-[#1E293B] border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={() => handleSaveBackendUrl(inputBackendUrl)}
                  className="px-3.5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors cursor-pointer"
                >
                  Connect
                </button>
              </div>

              {backendConnectStatus && (
                <div
                  className={`text-xs p-2 rounded border ${
                    backendConnectStatus.includes('successfully')
                      ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                      : backendConnectStatus.includes('Testing')
                        ? 'bg-blue-950/60 border-blue-700 text-blue-300 animate-pulse'
                        : 'bg-red-950/60 border-red-700 text-red-300'
                  }`}
                >
                  {backendConnectStatus}
                </div>
              )}
            </div>

            <div className="space-y-2 border-t border-slate-700/80 pt-3 text-xs">
              <div className="font-semibold text-slate-200">3 Easy Ways to Run Your 24/7 Bot:</div>
              <ul className="space-y-1.5 text-slate-400 list-disc list-inside">
                <li>
                  <strong className="text-slate-200">Free Cloud Host (Render / Railway):</strong> Deploy this repo to Render (free plan). Render uses the included <code className="text-emerald-400">render.yaml</code> to keep the bot alive 24/7. Paste your Render URL above!
                </li>
                <li>
                  <strong className="text-slate-200">Run on Your PC / Phone:</strong> Go to the <strong>Python & JS Code</strong> tab and download <code className="text-emerald-400">bot_mineflayer.js</code> or <code className="text-emerald-400">aternos_afk_bot_gui.py</code>. Run with 1 command.
                </li>
                <li>
                  <strong className="text-slate-200">Interactive Simulator Mode:</strong> Test the 3D world, camera views, hotbar, and anti-AFK settings right in this Netlify tab without any server.
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-700/80">
              <button
                onClick={handleResetToSimulator}
                className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer underline"
              >
                Reset to Simulator Mode
              </button>
              <button
                onClick={() => {
                  setShowBackendModal(false);
                  setBackendConnectStatus(null);
                }}
                className="px-4 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Switcher */}
      <div className="flex md:hidden items-center gap-1 px-4 py-1.5 border-b border-slate-800 bg-[#0F172A] overflow-x-auto">
        {(
          [
            ['console', '3D & Hotbar'],
            ['antiafk', 'Movement'],
            ['reconnect', 'Server'],
            ['code', 'Code'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveSection(key)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              activeSection === key
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Main Cockpit */}
      <main className="flex-1 w-full max-w-[1420px] mx-auto px-4 sm:px-5 py-4 space-y-4">
        {/* Single-Row Telemetry Strip */}
        <section className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border border-slate-800 rounded-xl bg-[#1E293B]/40 text-xs font-mono tabular-nums">
          <div className="flex flex-wrap items-center gap-2 text-slate-300">
            <span
              className={`font-semibold ${
                state?.connectionState === 'Connected'
                  ? 'text-emerald-400'
                  : state?.connectionState === 'Connecting' || state?.connectionState === 'Reconnecting'
                    ? 'text-amber-400'
                    : 'text-red-400'
              }`}
            >
              ● {state?.connectionState || 'Connecting'}
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-100 font-semibold">{activeConfig.host}:{activeConfig.port}</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>Uptime: <strong className="text-slate-100">{state ? formatUptime(state.cumulativeUptimeSeconds || state.uptimeSeconds) : '00h 00m 00s'}</strong></span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>Keepalives: <strong className="text-emerald-400">{state?.totalKeepalivesAcked ?? 0}</strong></span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-emerald-300 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              80m Shield ({state?.antiKickPulsesSent ?? 0} pulses · {wakeLockActive ? 'WakeLock' : 'Worker'})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-slate-400">
            <span>HP: <strong className="text-slate-200">{state?.health ?? 20}</strong>/20</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>Food: <strong className="text-slate-200">{state?.food ?? 20}</strong>/20</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>Players: <strong className="text-emerald-400">{state?.onlinePlayers?.join(', ') || activeConfig.username}</strong></span>
            <button
              onClick={handlePingServer}
              disabled={pinging}
              className="text-emerald-400 hover:text-emerald-300 font-sans font-medium flex items-center gap-1 cursor-pointer ml-1"
            >
              <RefreshCw className={`w-3 h-3 ${pinging ? 'animate-spin' : ''}`} />
              <span>{pinging ? 'Pinging' : 'Ping'}</span>
            </button>
          </div>
        </section>

        {/* SECTION 1: DETAILED 3D WORLD & VISUAL ITEM HOTBAR */}
        {activeSection === 'console' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* 3D WebGL World & Item Hotbar (7 cols) */}
            <div className="lg:col-span-7 space-y-3">
              <LiveWorldPreviewController
                position={state?.position || { x: 10000.5, y: 73, z: 10000.5, yaw: 0, pitch: 0 }}
                anchorPosition={state?.anchorPosition || { x: 10000.5, y: 73, z: 10000.5 }}
                trail={state?.trail || []}
                worldPreview={state?.worldPreview}
                health={state?.health ?? 20}
                food={state?.food ?? 20}
                movementMode={activeConfig.movementMode}
                walkRadiusBlocks={activeConfig.walkRadiusBlocks}
                onChangeMovementMode={(mode) =>
                  handleSaveConfig({
                    ...activeConfig,
                    movementMode: mode,
                    walkRadiusBlocks:
                      mode === 'continuous_roam'
                        ? Math.max(4, activeConfig.walkRadiusBlocks)
                        : activeConfig.walkRadiusBlocks,
                  })
                }
                onLockAnchor={handleLockAnchor}
                onStateUpdated={(updated) => setState(updated as BotRuntimeState)}
              />

              {/* Chat & Command Bar */}
              <form
                onSubmit={handleSendChat}
                className="border border-slate-800 rounded-xl bg-[#1E293B]/40 p-3 flex flex-wrap sm:flex-nowrap items-center gap-2"
              >
                <input
                  type="text"
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  placeholder={`Chat or command as ${activeConfig.username} (/tp, /spawn, /login)...`}
                  className="flex-1 min-w-[180px] px-3 py-1.5 text-xs bg-[#090D16] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="submit"
                  className="px-3.5 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3 h-3" />
                  <span>Send</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTriggerAction('Anti-Kick Pulse')}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  Reset Idle Timer
                </button>
              </form>
            </div>

            {/* Live Logs Stream (5 cols) */}
            <div className="lg:col-span-5 border border-slate-800 rounded-xl bg-[#1E293B]/40 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    Keepalive & Server Logs
                  </h2>
                  <p className="text-[11px] text-slate-400 truncate max-w-[260px]">
                    {state?.currentAction || 'Continuous All-Time Roaming'}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleExportLogsCsv}
                    title="Export CSV"
                    className="px-2.5 py-1 text-[11px] font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    <span>CSV</span>
                  </button>
                  <button
                    onClick={handleClearLogs}
                    title="Clear Logs"
                    className="px-2.5 py-1 text-[11px] font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                </div>
              </div>

              {/* Log Filter Tabs */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-0.5 p-0.5 bg-[#090D16] border border-slate-800 rounded-lg overflow-x-auto">
                  {(['All', 'Keepalive', 'Movement', 'Chat', 'Reconnect'] as LogFilter[]).map(
                    (tab) => (
                      <button
                        key={tab}
                        onClick={() => setLogFilter(tab)}
                        className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                          logFilter === tab
                            ? 'bg-slate-800 text-slate-100'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {tab}
                      </button>
                    )
                  )}
                </div>

                <div className="relative w-32 sm:w-36">
                  <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter..."
                    className="w-full pl-7 pr-2 py-1 text-[11px] bg-[#090D16] border border-slate-800 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* High-Density Log Feed */}
              <div className="border border-slate-800 rounded-lg bg-[#090D16] overflow-hidden">
                <div className="max-h-[500px] overflow-y-auto divide-y divide-slate-800/80">
                  {loading ? (
                    <div className="p-4 space-y-2">
                      {[1, 2, 3, 4].map((n) => (
                        <div key={n} className="h-7 bg-slate-800/40 rounded animate-pulse" />
                      ))}
                    </div>
                  ) : filteredLogs.length === 0 ? (
                    <div className="p-8 text-center space-y-2">
                      <div className="text-xs text-slate-400">No matching logs</div>
                      <button
                        onClick={() => {
                          setLogFilter('All');
                          setSearchQuery('');
                        }}
                        className="px-3 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded cursor-pointer"
                      >
                        Show All
                      </button>
                    </div>
                  ) : (
                    filteredLogs.map((entry) => (
                      <div
                        key={entry.id}
                        className="px-3 py-2 hover:bg-slate-900/70 transition-colors flex items-center justify-between gap-2 text-[11px]"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5 font-mono tabular-nums text-slate-400">
                            <span>{formatTimeOnly(entry.timestamp)}</span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={`font-semibold ${
                                entry.level === 'Alert'
                                  ? 'text-red-400'
                                  : entry.level === 'Warning'
                                    ? 'text-amber-400'
                                    : entry.category === 'Keepalive'
                                      ? 'text-emerald-400'
                                      : entry.category === 'Chat'
                                        ? 'text-sky-400'
                                        : 'text-slate-300'
                              }`}
                            >
                              {entry.category}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-100 font-sans font-medium truncate">
                              {entry.message}
                            </span>
                          </div>
                          <div className="text-slate-500 font-mono tabular-nums truncate">
                            {entry.details}
                          </div>
                        </div>

                        <div className="text-right font-mono tabular-nums text-slate-500 shrink-0">
                          {entry.latencyMs !== undefined ? `${entry.latencyMs}ms` : ''}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 2: MOVEMENT SETTINGS */}
        {activeSection === 'antiafk' && (
          <div className="border border-slate-800 rounded-xl bg-[#1E293B]/40 p-5 space-y-5">
            <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-emerald-400" />
                <h2 className="text-base font-semibold text-slate-100">
                  Movement & 80m Anti-Kick Settings
                </h2>
              </div>
              {configSavedNotice && (
                <span className="text-xs font-mono text-emerald-400">Synced live</span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 block">Movement Strategy</label>
                  <select
                    value={activeConfig.movementMode}
                    onChange={(e) =>
                      handleSaveConfig({
                        ...activeConfig,
                        movementMode: e.target.value as MovementMode,
                      })
                    }
                    className="w-full px-3 py-2 text-xs bg-[#090D16] border border-slate-800 rounded-lg text-slate-100"
                  >
                    <option value="continuous_roam">All-Time Moveable (Continuous Roam)</option>
                    <option value="anchor_step_return">Safe Step-and-Return (Single Block)</option>
                    <option value="in_place_jump_look">In-Place Jump & Head Look Only</option>
                    <option value="bounded_radius">Bounded Forward Radius Patrol</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Patrol / Safe Anchor Radius</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {activeConfig.walkRadiusBlocks} blocks
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={15}
                    step={0.5}
                    value={activeConfig.walkRadiusBlocks}
                    onChange={(e) =>
                      handleSaveConfig({
                        ...activeConfig,
                        walkRadiusBlocks: Number(e.target.value),
                      })
                    }
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                  <span>Continuous Auto-Walk & Strafe</span>
                  <input
                    type="checkbox"
                    checked={activeConfig.autoWalk}
                    onChange={(e) =>
                      handleSaveConfig({ ...activeConfig, autoWalk: e.target.checked })
                    }
                    className="w-4 h-4 accent-emerald-500"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                  <span>Smart Jump & Ledge Hop</span>
                  <input
                    type="checkbox"
                    checked={activeConfig.autoJump}
                    onChange={(e) =>
                      handleSaveConfig({ ...activeConfig, autoJump: e.target.checked })
                    }
                    className="w-4 h-4 accent-emerald-500"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                  <span>Smooth Yaw & Pitch Head Look</span>
                  <input
                    type="checkbox"
                    checked={activeConfig.randomHeadLook}
                    onChange={(e) =>
                      handleSaveConfig({ ...activeConfig, randomHeadLook: e.target.checked })
                    }
                    className="w-4 h-4 accent-emerald-500"
                  />
                </label>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Anti-Cheat Timing Jitter</span>
                    <span className="font-mono tabular-nums text-emerald-400">
                      ±{activeConfig.humanizeTimingJitterPct}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={50}
                    value={activeConfig.humanizeTimingJitterPct}
                    onChange={(e) =>
                      handleSaveConfig({
                        ...activeConfig,
                        humanizeTimingJitterPct: Number(e.target.value),
                      })
                    }
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>

                <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                  <span>Intermittent Sneak Pulses</span>
                  <input
                    type="checkbox"
                    checked={activeConfig.sneakPulse}
                    onChange={(e) =>
                      handleSaveConfig({ ...activeConfig, sneakPulse: e.target.checked })
                    }
                    className="w-4 h-4 accent-emerald-500"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                  <span>Right-Arm Swing + 42s Hotbar Reset</span>
                  <input
                    type="checkbox"
                    checked={activeConfig.armSwing}
                    onChange={(e) =>
                      handleSaveConfig({ ...activeConfig, armSwing: e.target.checked })
                    }
                    className="w-4 h-4 accent-emerald-500"
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 3: SERVER & WATCHDOG SETTINGS */}
        {activeSection === 'reconnect' && (
          <div className="border border-slate-800 rounded-xl bg-[#1E293B]/40 p-5 space-y-5">
            <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-emerald-400" />
                <h2 className="text-base font-semibold text-slate-100">
                  Aternos Endpoint & 24/7 Watchdog
                </h2>
              </div>
              <button
                onClick={() => handleSaveConfig(activeConfig)}
                className="px-3.5 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                Apply & Connect
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2 space-y-1">
                    <label className="text-xs text-slate-400">Server Hostname</label>
                    <input
                      type="text"
                      value={activeConfig.host}
                      onChange={(e) =>
                        setDraftConfig({ ...activeConfig, host: e.target.value })
                      }
                      className="w-full px-3 py-1.5 text-xs font-mono bg-[#090D16] border border-slate-800 rounded-lg text-slate-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Port</label>
                    <input
                      type="number"
                      value={activeConfig.port}
                      onChange={(e) =>
                        setDraftConfig({ ...activeConfig, port: Number(e.target.value) })
                      }
                      className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-[#090D16] border border-slate-800 rounded-lg text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Username</label>
                    <input
                      type="text"
                      value={activeConfig.username}
                      onChange={(e) =>
                        setDraftConfig({ ...activeConfig, username: e.target.value })
                      }
                      className="w-full px-3 py-1.5 text-xs font-mono bg-[#090D16] border border-slate-800 rounded-lg text-slate-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Version</label>
                    <input
                      type="text"
                      value={activeConfig.version}
                      onChange={(e) =>
                        setDraftConfig({ ...activeConfig, version: e.target.value })
                      }
                      className="w-full px-3 py-1.5 text-xs font-mono bg-[#090D16] border border-slate-800 rounded-lg text-slate-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Auth</label>
                    <select
                      value={activeConfig.auth}
                      onChange={(e) =>
                        handleSaveConfig({
                          ...activeConfig,
                          auth: e.target.value as 'offline' | 'microsoft',
                        })
                      }
                      className="w-full px-3 py-1.5 text-xs bg-[#090D16] border border-slate-800 rounded-lg text-slate-100"
                    >
                      <option value="offline">offline</option>
                      <option value="microsoft">microsoft</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                  <span>Auto-Reconnect on Server Restart</span>
                  <input
                    type="checkbox"
                    checked={activeConfig.autoReconnect}
                    onChange={(e) =>
                      handleSaveConfig({ ...activeConfig, autoReconnect: e.target.checked })
                    }
                    className="w-4 h-4 accent-emerald-500"
                  />
                </label>

                <div className="grid grid-cols-3 gap-3 pt-1">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Base Delay (s)</label>
                    <input
                      type="number"
                      min={2}
                      max={60}
                      value={activeConfig.reconnectBaseDelaySec}
                      onChange={(e) =>
                        handleSaveConfig({
                          ...activeConfig,
                          reconnectBaseDelaySec: Number(e.target.value),
                        })
                      }
                      className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-[#090D16] border border-slate-800 rounded-lg text-slate-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Max Backoff (s)</label>
                    <input
                      type="number"
                      min={15}
                      max={300}
                      value={activeConfig.reconnectMaxDelaySec}
                      onChange={(e) =>
                        handleSaveConfig({
                          ...activeConfig,
                          reconnectMaxDelaySec: Number(e.target.value),
                        })
                      }
                      className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-[#090D16] border border-slate-800 rounded-lg text-slate-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Timeout (s)</label>
                    <input
                      type="number"
                      min={60}
                      max={600}
                      value={activeConfig.keepaliveTimeoutSec}
                      onChange={(e) =>
                        handleSaveConfig({
                          ...activeConfig,
                          keepaliveTimeoutSec: Number(e.target.value),
                        })
                      }
                      className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-[#090D16] border border-slate-800 rounded-lg text-slate-100"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 4: PYTHON & MINEFLAYER CODE GENERATOR */}
        {activeSection === 'code' && (
          <div className="border border-slate-800 rounded-xl bg-[#1E293B]/40 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <h2 className="text-base font-semibold text-slate-100">
                  Python & Mineflayer Scripts ({activeConfig.host}:{activeConfig.port})
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 p-0.5 bg-[#090D16] border border-slate-800 rounded-lg">
                  <button
                    onClick={() => setCodeTab('python')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      codeTab === 'python'
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Python GUI (.py)
                  </button>
                  <button
                    onClick={() => setCodeTab('node')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      codeTab === 'node'
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Node.js (.js)
                  </button>
                  <button
                    onClick={() => setCodeTab('setup')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      codeTab === 'setup'
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Setup
                  </button>
                  <button
                    onClick={() => setCodeTab('deploy')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      codeTab === 'deploy'
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    24/7 Cloud Host
                  </button>
                </div>

                <button
                  onClick={handleCopyCode}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-lg flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedCode ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() =>
                    handleDownloadFile(
                      codeTab === 'python'
                        ? 'aternos_afk_bot_gui.py'
                        : codeTab === 'node'
                          ? 'bot_mineflayer.js'
                          : codeTab === 'deploy'
                            ? '24_7_hosting_guide.txt'
                            : 'setup_aternos_bot.sh',
                      displayedCode
                    )
                  }
                  className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
              </div>
            </div>

            <pre className="p-4 bg-[#090D16] border border-slate-800 rounded-lg text-xs font-mono text-slate-200 overflow-x-auto max-h-[500px] leading-relaxed">
              <code>{displayedCode}</code>
            </pre>
          </div>
        )}
      </main>
    </div>
  );
}

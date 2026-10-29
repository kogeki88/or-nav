'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';

interface JulesTask {
  id: string;
  title: string;
  shortTag: string;
  category: 'security' | 'performance' | 'ui' | 'testing' | 'clinical';
  characterClass: 'knight' | 'bolt' | 'artist' | 'alchemist' | 'surgeon';
  state: 'IN_PROGRESS' | 'WAITING_FOR_INPUT' | 'PR_CREATED' | 'IDLE';
  progress: number;
  branch: string;
  prUrl: string | null;
  lastActivity: string;
}

interface LivePoolResponse {
  activeCount: number;
  targetConcurrency: number;
  mergedPRCount: number;
  waitingCount: number;
  nextSyncSeconds: number;
  sessions: JulesTask[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Ragnarok Online Job Class Mappings
// ---------------------------------------------------------------------------
const JOB_CLASS_MAP: Record<
  string,
  {
    key: 'crusader' | 'assassin' | 'alchemist' | 'highpriest' | 'scholar';
    name: string;
    title: string;
    sprite: string;
    defaultStr: number;
    defaultAgi: number;
    defaultVit: number;
    defaultInt: number;
    defaultDex: number;
    defaultLuk: number;
  }
> = {
  knight: {
    key: 'crusader',
    name: 'Paladin',
    title: 'Security & Integrity Guard',
    sprite: '/sprites/ro_crusader.png',
    defaultStr: 99,
    defaultAgi: 78,
    defaultVit: 99,
    defaultInt: 65,
    defaultDex: 85,
    defaultLuk: 77
  },
  bolt: {
    key: 'assassin',
    name: 'Assassin Cross',
    title: 'Performance & Fast Path Optimizer',
    sprite: '/sprites/ro_assassin.png',
    defaultStr: 94,
    defaultAgi: 99,
    defaultVit: 72,
    defaultInt: 80,
    defaultDex: 92,
    defaultLuk: 88
  },
  alchemist: {
    key: 'alchemist',
    name: 'Biochemist',
    title: 'Test Suite & Stress Lab Alchemist',
    sprite: '/sprites/ro_alchemist.png',
    defaultStr: 82,
    defaultAgi: 85,
    defaultVit: 88,
    defaultInt: 99,
    defaultDex: 95,
    defaultLuk: 82
  },
  surgeon: {
    key: 'highpriest',
    name: 'High Priest',
    title: 'Clinical Core & Surgical Lexicon',
    sprite: '/sprites/ro_highpriest.png',
    defaultStr: 70,
    defaultAgi: 82,
    defaultVit: 95,
    defaultInt: 99,
    defaultDex: 90,
    defaultLuk: 92
  },
  artist: {
    key: 'scholar',
    name: 'Scholar',
    title: 'UI/UX & Micro-Interaction Professor',
    sprite: '/sprites/ro_scholar.png',
    defaultStr: 75,
    defaultAgi: 88,
    defaultVit: 80,
    defaultInt: 99,
    defaultDex: 99,
    defaultLuk: 85
  }
};

// ---------------------------------------------------------------------------
// Synthesized Retro Sound Effects
// ---------------------------------------------------------------------------
function playRoSynthSound(type: 'click' | 'select' | 'levelup' | 'warp') {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'select') {
      // Classic RO Menu Beep
      osc.type = 'square';
      osc.frequency.setValueAtTime(987.77, now); // B5
      osc.frequency.setValueAtTime(1318.51, now + 0.05); // E6
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'levelup') {
      // Fanfare arpeggio
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.06); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.12); // G5
      osc.frequency.setValueAtTime(1046.5, now + 0.18); // C6
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else {
      // Quick subtle button click
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.04);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.start(now);
      osc.stop(now + 0.04);
    }
  } catch {}
}

const DEFAULT_VIDEO_MAP: Record<string, string> = {
  crusader: '/sprites/videos/crusader_idle.webm',
  assassin: '/sprites/videos/assassin_idle.webm',
  alchemist: '/sprites/videos/alchemist_idle.webm',
  highpriest: '/sprites/videos/highpriest_idle.webm',
  scholar: '/sprites/videos/scholar_idle.webm',
};

const DEFAULT_JULES_TASKS: JulesTask[] = [
  { id: 'jules-1', title: 'Sentinel • Security & HIPAA Policy Scrubber', shortTag: 'Paladin • Shield', category: 'security', characterClass: 'knight', state: 'IN_PROGRESS', progress: 75, branch: 'jules/task-1', prUrl: 'https://github.com/kogeki88/or-nav/pulls', lastActivity: 'AST inspection & tenant invariant verification' },
  { id: 'jules-2', title: 'Bolt • High-Velocity Double Metaphone & IndexedDB Cache', shortTag: 'Assassin • Turbo', category: 'performance', characterClass: 'bolt', state: 'IN_PROGRESS', progress: 90, branch: 'jules/task-2', prUrl: 'https://github.com/kogeki88/or-nav/pulls', lastActivity: 'Dexie 178-item bulk hydrate optimization' },
  { id: 'jules-3', title: 'Scholar • Ragnarok Character Select Workshop & Veo Motion', shortTag: 'Scholar • Canvas', category: 'ui', characterClass: 'artist', state: 'IN_PROGRESS', progress: 85, branch: 'jules/task-3', prUrl: 'https://github.com/kogeki88/or-nav/pulls', lastActivity: 'Interactive character pedestal rendering' },
  { id: 'jules-4', title: 'Biochemist • E2E Regression Gauntlet & Parity Audit', shortTag: 'Alchemist • Lab', category: 'testing', characterClass: 'alchemist', state: 'IN_PROGRESS', progress: 95, branch: 'jules/task-4', prUrl: 'https://github.com/kogeki88/or-nav/pulls', lastActivity: 'Master gauntlet & data parity audit' },
  { id: 'jules-5', title: 'High Priest • 120+ CVOR Surgical Instrument Ontology', shortTag: 'Priest • Lexicon', category: 'clinical', characterClass: 'surgeon', state: 'IN_PROGRESS', progress: 100, branch: 'jules/task-5', prUrl: 'https://github.com/kogeki88/or-nav/pulls', lastActivity: 'Strict eponym guard & clinical alias sync' },
  { id: 'jules-6', title: 'Sentinel • WebSocket & WebRTC Live Audio Guard', shortTag: 'Paladin • Audio', category: 'security', characterClass: 'knight', state: 'IN_PROGRESS', progress: 65, branch: 'jules/task-6', prUrl: 'https://github.com/kogeki88/or-nav/pulls', lastActivity: '15-min audio window buffer inspection' },
  { id: 'jules-7', title: 'Bolt • Standalone Offline Engine & Fast Path Parser', shortTag: 'Assassin • FastPath', category: 'performance', characterClass: 'bolt', state: 'IN_PROGRESS', progress: 80, branch: 'jules/task-7', prUrl: 'https://github.com/kogeki88/or-nav/pulls', lastActivity: 'Microsecond token index lookups' },
  { id: 'jules-8', title: 'Scholar • Clean Sidebar & Clinician Profile Assignment', shortTag: 'Scholar • Declutter', category: 'ui', characterClass: 'artist', state: 'PR_CREATED', progress: 100, branch: 'jules/task-8', prUrl: 'https://github.com/kogeki88/or-nav/pulls', lastActivity: 'v0.60 sidebar declutter merged' },
  { id: 'jules-9', title: 'Biochemist • Chaos Testing & Memory Leak Guard', shortTag: 'Alchemist • Chaos', category: 'testing', characterClass: 'alchemist', state: 'IN_PROGRESS', progress: 70, branch: 'jules/task-9', prUrl: 'https://github.com/kogeki88/or-nav/pulls', lastActivity: '15-write concurrent mutation validation' },
  { id: 'jules-10', title: 'High Priest • Multi-Clause Discourse Utterance Decomposer', shortTag: 'Priest • Discourse', category: 'clinical', characterClass: 'surgeon', state: 'IN_PROGRESS', progress: 85, branch: 'jules/task-10', prUrl: 'https://github.com/kogeki88/or-nav/pulls', lastActivity: 'Spoken disfluency filter verification' },
  { id: 'jules-11', title: 'Sentinel • Multi-Tenant RBAC & Cross-Hospital Isolation', shortTag: 'Paladin • RBAC', category: 'security', characterClass: 'knight', state: 'IN_PROGRESS', progress: 90, branch: 'jules/task-11', prUrl: 'https://github.com/kogeki88/or-nav/pulls', lastActivity: 'Strict hospital tenant boundary enforcement' },
  { id: 'jules-12', title: 'Bolt • React Memoization & Render Cycle Minimizer', shortTag: 'Assassin • Memo', category: 'performance', characterClass: 'bolt', state: 'IN_PROGRESS', progress: 88, branch: 'jules/task-12', prUrl: 'https://github.com/kogeki88/or-nav/pulls', lastActivity: 'Zero unnecessary re-renders' },
  { id: 'jules-13', title: 'Scholar • RPG Mastery Ranks & Clinician Rewards System', shortTag: 'Scholar • Rewards', category: 'ui', characterClass: 'artist', state: 'IN_PROGRESS', progress: 92, branch: 'jules/task-13', prUrl: 'https://github.com/kogeki88/or-nav/pulls', lastActivity: 'XP progress bar & level progression' },
  { id: 'jules-14', title: 'Biochemist • OTA Version Monotonicity & Bloat Guard', shortTag: 'Alchemist • OTA', category: 'testing', characterClass: 'alchemist', state: 'IN_PROGRESS', progress: 95, branch: 'jules/task-14', prUrl: 'https://github.com/kogeki88/or-nav/pulls', lastActivity: 'APK size validation (<10MB)' },
  { id: 'jules-15', title: 'High Priest • 2-Tier Adaptive Hospital Lexicon & Slang Graph', shortTag: 'Priest • LexiconGraph', category: 'clinical', characterClass: 'surgeon', state: 'IN_PROGRESS', progress: 94, branch: 'jules/task-15', prUrl: 'https://github.com/kogeki88/or-nav/pulls', lastActivity: 'Implicit consensus & nickname resolution' },
];

export default function JulesRagnarokWorkshopPage() {
  const [tasks, setTasks] = useState<JulesTask[]>(DEFAULT_JULES_TASKS);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'3-slot' | '15-grid'>('15-grid');
  const [classicPage, setClassicPage] = useState<number>(0); // 0..4 (3 slots per page)
  const [mergedCount, setMergedCount] = useState<number>(8);
  const [countdown, setCountdown] = useState<number>(2400);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [videoMap, setVideoMap] = useState<Record<string, string>>(DEFAULT_VIDEO_MAP);
  const synthesizingRef = React.useRef<Set<string>>(new Set());

  // Automatic Background Hydration: Check cached Veo loops & trigger background synthesis if missing
  const autoHydrateVeoLoops = async () => {
    try {
      const res = await fetch('/api/jules/animate-sprite');
      if (res.ok) {
        const data = await res.json();
        const available = data.availableVideos || {};
        setVideoMap(available);

        // Silently request synthesis for any missing job classes in background
        const allJobKeys = ['crusader', 'assassin', 'alchemist', 'highpriest', 'scholar'];
        for (const jobKey of allJobKeys) {
          if (!available[jobKey] && !synthesizingRef.current.has(jobKey)) {
            synthesizingRef.current.add(jobKey);
            fetch('/api/jules/animate-sprite', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jobClass: jobKey, currentState: 'IN_PROGRESS' })
            })
              .then((r) => r.json())
              .then((synth) => {
                if (synth.success && synth.localVideoPath) {
                  setVideoMap((prev) => ({ ...prev, [jobKey]: synth.localVideoPath }));
                }
              })
              .catch(() => {});
          }
        }
      }
    } catch {}
  };

  useEffect(() => {
    autoHydrateVeoLoops();
  }, []);

  // Fetch telemetry from live pool
  const fetchPoolData = async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch('/api/jules/live-pool', { cache: 'no-store' });
      if (res.ok) {
        const data: LivePoolResponse = await res.json();
        setTasks(data.sessions || []);
        setMergedCount(data.mergedPRCount || 8);
        if (data.nextSyncSeconds) setCountdown(data.nextSyncSeconds);
      }
    } catch (err) {
      console.warn('Live pool fetch failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPoolData();
    const interval = setInterval(fetchPoolData, 8000);
    return () => clearInterval(interval);
  }, []);

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 3600));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Selected Task
  const selectedTask = useMemo(() => {
    if (!tasks.length) return null;
    return tasks[selectedIndex % tasks.length] || tasks[0];
  }, [tasks, selectedIndex]);

  // Selected RO Job Details
  const selectedJob = useMemo(() => {
    if (!selectedTask) return JOB_CLASS_MAP.knight;
    return JOB_CLASS_MAP[selectedTask.characterClass] || JOB_CLASS_MAP.knight;
  }, [selectedTask]);

  // Handle Unblock
  const handleUnblock = async (sessionId: string) => {
    setUnblockingId(sessionId);
    if (soundEnabled) playRoSynthSound('levelup');

    try {
      const res = await fetch('/api/jules/live-pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      if (res.ok) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === sessionId ? { ...t, state: 'IN_PROGRESS', progress: 85 } : t
          )
        );
        setTimeout(fetchPoolData, 1500);
      }
    } catch {} finally {
      setUnblockingId(null);
    }
  };

  const formattedCountdown = useMemo(() => {
    const m = Math.floor(countdown / 60);
    const s = countdown % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }, [countdown]);

  // Paged slots for 3-slot mode
  const current3Slots = useMemo(() => {
    const start = classicPage * 3;
    return tasks.slice(start, start + 3);
  }, [tasks, classicPage]);

  return (
    <div className="relative min-h-screen w-full bg-[#111622] text-slate-800 flex flex-col items-center justify-center p-3 sm:p-6 font-sans select-none overflow-x-hidden">
      {/* Background Ambience */}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(65,95,140,0.35),rgba(15,20,30,0.95))] pointer-events-none" />

      {/* ------------------------------------------------------------------- */}
      {/* THE CLASSIC RAGNAROK ONLINE CHARACTER SELECT DIALOG WINDOW          */}
      {/* ------------------------------------------------------------------- */}
      <div className="relative z-10 w-full max-w-5xl rounded-sm bg-[#ffffff] border-[2px] border-[#31486d] shadow-[0_20px_60px_rgba(0,0,0,0.65)] flex flex-col overflow-hidden">
        
        {/* ================================================================= */}
        {/* RO Title Bar (Metallic Striped Ice-Blue with Glossy Sphere)       */}
        {/* ================================================================= */}
        <div className="ro-title-bar px-3 py-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Glossy Blue RO Orb Icon */}
            <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-[#1e40af] via-[#38bdf8] to-[#ffffff] border border-[#1e3a8a] shadow-[0_1px_3px_rgba(0,0,0,0.3)] flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-white opacity-80" />
            </div>
            <span
              className="text-xs font-bold text-white tracking-wide"
              style={{ textShadow: '1px 1px 1px #1e293b' }}
            >
              Character Select — Jules Autonomous Fleet (15/15 Active Slots)
            </span>
          </div>

          {/* Window Controls & View Mode Toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setViewMode(viewMode === '15-grid' ? '3-slot' : '15-grid');
                if (soundEnabled) playRoSynthSound('select');
              }}
              className="ro-button px-2.5 py-0.5 text-[11px] font-bold text-[#1e3a8a] rounded shadow-sm hover:text-blue-900 active:scale-95"
            >
              {viewMode === '15-grid' ? '★ Switch to 3-Slot View' : '★ Switch to 15-Grid View'}
            </button>

            {/* Window buttons */}
            <div className="flex items-center gap-1 pl-2 border-l border-blue-900/40">
              <div className="w-3.5 h-3.5 rounded bg-gradient-to-b from-slate-100 to-slate-300 border border-slate-600 flex items-center justify-center text-[10px] font-mono text-slate-700 leading-none">
                _
              </div>
              <div className="w-3.5 h-3.5 rounded bg-gradient-to-b from-rose-200 to-rose-400 border border-rose-700 flex items-center justify-center text-[10px] font-bold text-rose-950 leading-none">
                ×
              </div>
            </div>
          </div>
        </div>

        {/* ================================================================= */}
        {/* RO Canvas Body (White with Ice-Blue Tribal Wing Watermark)         */}
        {/* ================================================================= */}
        <div className="relative w-full p-4 sm:p-6 bg-[#ffffff] min-h-[580px] flex flex-col justify-between">
          
          {/* Subtle Ice-Blue Tribal/Wing Background Watermark (Authentic RO SVG) */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.09]" viewBox="0 0 1000 600" fill="none">
            <path
              d="M 50 300 Q 250 100 500 280 T 950 300 M 100 350 Q 300 200 500 320 T 900 350 M 500 50 C 400 250 200 350 50 400 C 200 450 400 480 500 550 C 600 480 800 450 950 400 C 800 350 600 250 500 50 Z"
              stroke="#436fa8"
              strokeWidth="3"
            />
            <circle cx="500" cy="300" r="140" stroke="#436fa8" strokeWidth="2" strokeDasharray="8 8" />
            <circle cx="500" cy="300" r="210" stroke="#436fa8" strokeWidth="1" />
          </svg>

          {/* Bottom-Right Iconic Stacked Typography Watermark */}
          <div className="absolute right-6 bottom-36 pointer-events-none text-right opacity-[0.14] font-serif leading-none select-none">
            <div className="text-3xl font-black tracking-[0.25em] text-[#2c476f]">SELECT</div>
            <div className="text-2xl font-bold tracking-[0.35em] text-[#3b5d8f] my-0.5">YOUR</div>
            <div className="text-xl font-bold tracking-[0.2em] text-[#4d72a7]">CHARACTERS</div>
          </div>

          {/* Top Bar inside Canvas: Slot Count Pill & Sync Info */}
          <div className="relative z-10 flex items-center justify-between mb-4 pb-2 border-b border-[#e2eaf4]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#2d4b75]">Party Fleet Status:</span>
              <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">
                ● 15 / 15 Agents Deployed
              </span>
              <span className="text-xs font-mono text-slate-500 ml-2">
                origin/main: <span className="font-semibold text-blue-700">8 PRs Merged</span>
              </span>
            </div>

            <div className="flex items-center gap-3">
              {/* Slot Counter Pill (Classic RO Format) */}
              <div className="px-3 py-1 rounded bg-[#f1f5fa] border border-[#c4d4e6] text-xs font-mono font-bold text-[#2b4870] shadow-inner">
                15 / 15 (Character/Total Slot)
              </div>

              {/* Next Sync */}
              <div className="text-xs font-mono text-slate-500">
                Next Sync: <span className="font-bold text-[#b45309]">{formattedCountdown}</span>
              </div>
            </div>
          </div>

          {/* =============================================================== */}
          {/* CHARACTER PEDESTALS: MODE 1 (15-Grid) vs MODE 2 (3-Slot Classic) */}
          {/* =============================================================== */}
          {viewMode === '15-grid' ? (
            /* 15-SLOT PARTY GRID (5x3) */
            <div className="relative z-10 grid grid-cols-3 sm:grid-cols-5 gap-2.5 my-2">
              {tasks.slice(0, 15).map((task, idx) => {
                const isSelected = selectedIndex === idx;
                const jobMeta = JOB_CLASS_MAP[task.characterClass] || JOB_CLASS_MAP.knight;
                const isWaiting = task.state === 'WAITING_FOR_INPUT';
                const isDone = task.state === 'PR_CREATED';

                return (
                  <div
                    key={task.id || idx}
                    onClick={() => {
                      setSelectedIndex(idx);
                      if (soundEnabled) playRoSynthSound('select');
                    }}
                    className={`relative flex flex-col items-center justify-between h-[155px] p-2 rounded cursor-pointer transition-all ${
                      isSelected
                        ? 'border-[2px] border-[#6d8dc7] bg-gradient-to-b from-white to-[#f0f4fa] shadow-[0_2px_8px_rgba(109,141,199,0.4)]'
                        : isWaiting
                        ? 'border-[2px] border-amber-400 bg-amber-50/40'
                        : 'border border-[#cad8ea] bg-white hover:border-[#9cb4d4] hover:bg-[#fafcff]'
                    }`}
                  >
                    {/* Protruding Periwinkle Folder Tab when Selected */}
                    {isSelected && (
                      <div className="absolute -top-[19px] left-[-2px] px-2 py-0.5 bg-[#6d8dc7] text-white text-[9px] font-bold rounded-t shadow-sm">
                        Select
                      </div>
                    )}
                    {isWaiting && !isSelected && (
                      <div className="absolute -top-[19px] left-[-2px] px-2 py-0.5 bg-amber-500 text-black text-[9px] font-bold rounded-t shadow-sm animate-pulse">
                        Input?
                      </div>
                    )}

                    {/* Floor Radial Oval Shadow + Spinning Magic Seal */}
                    <div className="absolute bottom-9 left-1/2 -translate-x-1/2 w-16 h-5 rounded-full pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(60, 75, 105, 0.45) 0%, transparent 70%)' }} />
                    {task.state === 'IN_PROGRESS' && (
                      <div className="absolute bottom-9 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full border border-dashed border-cyan-400/50 animate-magic-seal pointer-events-none opacity-60" />
                    )}

                    {/* Live Head Emote / Cast Bar */}
                    <div className="relative z-10 w-full flex flex-col items-center">
                      {isWaiting ? (
                        <div className="px-1.5 py-0.2 rounded-full bg-white border border-amber-500 shadow-md text-[10px] font-bold text-amber-600 animate-bounce">
                          [ ? ]
                        </div>
                      ) : isDone ? (
                        <div className="px-1.5 py-0.2 rounded bg-yellow-100 border border-yellow-500 shadow text-[9px] font-bold text-yellow-800 animate-pulse">
                          ★ LEVEL UP!
                        </div>
                      ) : (
                        /* Cast Bar */
                        <div className="w-14 h-1.5 bg-slate-200 rounded-full border border-slate-400 overflow-hidden shadow-inner">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-yellow-400"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Authentic RO Pixel Sprite / Veo 3.1 Motion Loop */}
                    <div className="relative z-10 flex-1 w-full h-[80px] flex items-center justify-center my-0.5 overflow-hidden">
                      {videoMap[jobMeta.key] ? (
                        <video
                          src={videoMap[jobMeta.key]}
                          autoPlay
                          loop
                          muted
                          playsInline
                          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                        />
                      ) : (
                        <img
                          src={jobMeta.sprite}
                          alt={jobMeta.name}
                          className="h-[80px] w-auto ro-pixelated object-contain animate-ro-breathe pointer-events-none"
                        />
                      )}
                    </div>

                    {/* Slot Name & Class Label */}
                    <div className="relative z-10 w-full text-center flex flex-col items-center leading-tight">
                      <span className="text-[10px] font-bold text-[#1e3a8a] truncate max-w-[95px]">
                        {jobMeta.name}
                      </span>
                      <span className="text-[9px] font-mono text-slate-500 truncate max-w-[95px]">
                        {task.shortTag}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* 3-SLOT CLASSIC PAGER VIEW */
            <div className="relative z-10 flex items-center justify-center gap-6 my-4">
              {/* Prev Page Button */}
              <button
                onClick={() => {
                  setClassicPage((prev) => (prev > 0 ? prev - 1 : 4));
                  if (soundEnabled) playRoSynthSound('select');
                }}
                className="ro-button w-8 h-12 flex items-center justify-center text-lg font-bold text-[#1e3a8a] rounded shadow"
                title="Previous 3 Characters"
              >
                ◀
              </button>

              {/* 3 Pedestal Slots */}
              <div className="grid grid-cols-3 gap-6 w-full max-w-2xl">
                {current3Slots.map((task, slotIdx) => {
                  const globalIdx = classicPage * 3 + slotIdx;
                  const isSelected = selectedIndex === globalIdx;
                  const jobMeta = JOB_CLASS_MAP[task.characterClass] || JOB_CLASS_MAP.knight;
                  const isWaiting = task.state === 'WAITING_FOR_INPUT';
                  const isDone = task.state === 'PR_CREATED';

                  return (
                    <div
                      key={task.id || slotIdx}
                      onClick={() => {
                        setSelectedIndex(globalIdx);
                        if (soundEnabled) playRoSynthSound('select');
                      }}
                      className={`relative flex flex-col items-center justify-between h-[230px] p-3 rounded cursor-pointer transition-all ${
                        isSelected
                          ? 'border-[3px] border-[#6d8dc7] bg-gradient-to-b from-white to-[#edf3fc] shadow-[0_4px_16px_rgba(109,141,199,0.5)]'
                          : isWaiting
                          ? 'border-[2px] border-amber-400 bg-amber-50/40'
                          : 'border border-[#b8c8e0] bg-white hover:border-[#8ea8cf]'
                      }`}
                    >
                      {/* Protruding Tab */}
                      {isSelected && (
                        <div className="absolute -top-[23px] left-[-3px] px-3 py-0.5 bg-[#6d8dc7] text-white text-[10px] font-bold rounded-t shadow">
                          Select
                        </div>
                      )}

                      {/* Floor Radial Shadow */}
                      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-28 h-7 rounded-full pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(60, 75, 105, 0.45) 0%, transparent 70%)' }} />
                      {task.state === 'IN_PROGRESS' && (
                        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-24 h-24 rounded-full border border-dashed border-cyan-500/60 animate-magic-seal pointer-events-none opacity-70" />
                      )}

                      {/* Floating Emote / Cast Bar */}
                      <div className="relative z-10 w-full flex flex-col items-center">
                        {isWaiting ? (
                          <div className="px-2 py-0.5 rounded-full bg-white border border-amber-500 shadow text-xs font-bold text-amber-600 animate-bounce">
                            [ ? Waiting Input ]
                          </div>
                        ) : isDone ? (
                          <div className="px-2 py-0.5 rounded bg-yellow-100 border border-yellow-500 shadow text-xs font-bold text-yellow-800 animate-pulse">
                            ★ JOB LEVEL UP! ★
                          </div>
                        ) : (
                          <div className="w-24 h-2 bg-slate-200 rounded-full border border-slate-400 overflow-hidden shadow-inner">
                            <div className="h-full bg-gradient-to-r from-emerald-500 to-yellow-400" style={{ width: `${task.progress}%` }} />
                          </div>
                        )}
                      </div>

                      {/* Sprite Image / Veo 3.1 Motion Loop */}
                      <div className="relative z-10 flex-1 w-full h-[135px] flex items-center justify-center overflow-hidden">
                        {videoMap[jobMeta.key] ? (
                          <video
                            src={videoMap[jobMeta.key]}
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                          />
                        ) : (
                          <img
                            src={jobMeta.sprite}
                            alt={jobMeta.name}
                            className="h-[135px] w-auto ro-pixelated object-contain animate-ro-breathe pointer-events-none"
                          />
                        )}
                      </div>

                      {/* Slot Description */}
                      <div className="relative z-10 w-full text-center flex flex-col items-center">
                        <span className="text-xs font-bold text-[#1e3a8a]">{jobMeta.name}</span>
                        <span className="text-[10px] font-mono text-slate-500">{task.shortTag}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Next Page Button */}
              <button
                onClick={() => {
                  setClassicPage((prev) => (prev < 4 ? prev + 1 : 0));
                  if (soundEnabled) playRoSynthSound('select');
                }}
                className="ro-button w-8 h-12 flex items-center justify-center text-lg font-bold text-[#1e3a8a] rounded shadow"
                title="Next 3 Characters"
              >
                ▶
              </button>
            </div>
          )}

          {/* =============================================================== */}
          {/* BOTTOM SECTION: 2-COLUMN RO STAT TABLE & ACTIVE QUEST BOX        */}
          {/* =============================================================== */}
          <div className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-3 mt-3 pt-3 border-t border-[#d8e4f2]">
            
            {/* LEFT: Authentic 2-Column RO Striped Stat Table (7 cols) */}
            <div className="md:col-span-7 rounded border border-[#a2bad8] overflow-hidden shadow-sm bg-white">
              <div className="bg-[#4a70a3] px-2.5 py-1 text-white text-[11px] font-bold flex items-center justify-between border-b border-[#2d4b75]">
                <span>Status Window — {selectedJob.name}</span>
                <span className="font-mono text-[10px] text-blue-200">Slot #{selectedIndex + 1}</span>
              </div>

              <div className="grid grid-cols-2 text-xs divide-x divide-[#c4d4e6]">
                {/* Column 1: Identity & Bars */}
                <table className="w-full border-collapse">
                  <tbody>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="w-16 px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">Name</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono font-medium text-slate-800 truncate max-w-[130px]">
                        {selectedJob.name}-{selectedIndex + 1}
                      </td>
                    </tr>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">Job</td>
                      <td className="px-2 py-1 bg-[#f7faff] text-[11px] font-semibold text-[#1e3a8a]">
                        {selectedJob.name} ({selectedTask?.category?.toUpperCase()})
                      </td>
                    </tr>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">Lv.</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono font-bold text-slate-800">
                        {40 + (selectedIndex * 3) % 59}
                      </td>
                    </tr>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">EXP</td>
                      <td className="px-2 py-1 bg-[#f7faff]">
                        <div className="flex items-center gap-1.5 font-mono text-[10px]">
                          <span>{selectedTask?.progress || 50}%</span>
                          <div className="flex-1 h-1.5 bg-slate-200 rounded overflow-hidden">
                            <div className="h-full bg-blue-600" style={{ width: `${selectedTask?.progress || 50}%` }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">HP</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono text-[10px] text-emerald-700 font-bold">
                        4,500 / 4,500
                      </td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">SP</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono text-[10px] text-blue-700 font-bold">
                        820 / 820
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Column 2: RO Attributes & Fleet Metrics */}
                <table className="w-full border-collapse">
                  <tbody>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="w-14 px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">STR</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono text-xs flex items-center justify-between">
                        <span className="font-bold">{selectedJob.defaultStr}</span>
                        <span className="text-[9px] text-slate-400">Commits</span>
                      </td>
                    </tr>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">AGI</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono text-xs flex items-center justify-between">
                        <span className="font-bold">{selectedJob.defaultAgi}</span>
                        <span className="text-[9px] text-slate-400">Speed</span>
                      </td>
                    </tr>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">VIT</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono text-xs flex items-center justify-between">
                        <span className="font-bold">{selectedJob.defaultVit}</span>
                        <span className="text-[9px] text-slate-400">Defense</span>
                      </td>
                    </tr>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">INT</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono text-xs flex items-center justify-between">
                        <span className="font-bold">{selectedJob.defaultInt}</span>
                        <span className="text-[9px] text-slate-400">AST Depth</span>
                      </td>
                    </tr>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">DEX</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono text-xs flex items-center justify-between">
                        <span className="font-bold">{selectedJob.defaultDex}</span>
                        <span className="text-[9px] text-slate-400">Precision</span>
                      </td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">LUK</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono text-xs flex items-center justify-between">
                        <span className="font-bold">{selectedJob.defaultLuk}</span>
                        <span className="text-[9px] text-slate-400">Auto-Merge</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* RIGHT: Active Quest / Mission Dialog & Live Actions (5 cols) */}
            <div className="md:col-span-5 rounded border border-[#a2bad8] bg-[#f9fbfe] p-2.5 flex flex-col justify-between shadow-sm">
              <div>
                <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-[#d8e4f2]">
                  <span className="text-[11px] font-bold text-[#1e3a8a] flex items-center gap-1">
                    <span>⚔️</span> Active Mission Quest
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    {selectedTask?.branch}
                  </span>
                </div>

                <h4 className="text-xs font-semibold text-slate-800 leading-snug line-clamp-2 mb-1.5">
                  {selectedTask?.title || 'OR-Nav Autonomous Hardening Task'}
                </h4>

                <div className="text-[10px] text-slate-600 bg-white p-1.5 rounded border border-[#d8e4f2] leading-tight">
                  <span className="font-bold text-[#203a60]">Live Status: </span>
                  {selectedTask?.lastActivity}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-2.5 pt-2 border-t border-[#d8e4f2] flex items-center gap-2">
                {selectedTask?.state === 'WAITING_FOR_INPUT' ? (
                  <button
                    onClick={() => handleUnblock(selectedTask.id)}
                    disabled={unblockingId === selectedTask.id}
                    className="ro-button-ok flex-1 py-1 px-3 text-xs font-bold text-amber-950 rounded shadow flex items-center justify-center gap-1 active:scale-95"
                  >
                    <span>⚡</span>
                    <span>{unblockingId === selectedTask.id ? 'Unblocking...' : 'OK (Approve Plan)'}</span>
                  </button>
                ) : selectedTask?.prUrl ? (
                  <a
                    href={selectedTask.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ro-button-cancel flex-1 py-1 px-3 text-xs font-bold text-sky-950 rounded shadow flex items-center justify-center gap-1 text-center active:scale-95"
                  >
                    <span>🔗</span>
                    <span>View PR on GitHub</span>
                  </a>
                ) : (
                  <button
                    disabled
                    className="ro-button flex-1 py-1 px-3 text-xs font-semibold text-slate-400 rounded opacity-60"
                  >
                    In Progress (Auto-Merge)
                  </button>
                )}

                <button
                  onClick={() => {
                    fetchPoolData();
                    if (soundEnabled) playRoSynthSound('click');
                  }}
                  className="ro-button px-3 py-1 text-xs font-bold text-slate-700 rounded shadow active:scale-95"
                >
                  {isRefreshing ? '...' : 'Refresh'}
                </button>
              </div>
            </div>
          </div>

          {/* =============================================================== */}
          {/* WINDOW FOOTER: Authentic RO Pill Action Bar                     */}
          {/* =============================================================== */}
          <div className="relative z-10 flex items-center justify-between mt-3 pt-2 border-t border-[#e2eaf4] text-xs">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setSoundEnabled(!soundEnabled);
                  if (!soundEnabled) playRoSynthSound('click');
                }}
                className="ro-button px-2.5 py-1 text-[11px] font-bold text-[#203a60] rounded shadow-sm"
              >
                {soundEnabled ? '🔊 SFX: ON' : '🔈 SFX: OFF'}
              </button>

              <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
                Gravity Corp RO Engine v2.0 • Jules Autonomous Fleet
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  fetchPoolData();
                  if (soundEnabled) playRoSynthSound('levelup');
                }}
                className="ro-button px-3 py-1 text-[11px] font-bold text-[#1e3a8a] rounded shadow-sm"
              >
                Auto-Orchestrate
              </button>

              <button
                onClick={() => {
                  if (selectedTask?.state === 'WAITING_FOR_INPUT') {
                    handleUnblock(selectedTask.id);
                  } else {
                    window.open('https://github.com/kogeki88/or-nav/pulls', '_blank');
                  }
                }}
                className="ro-button-ok px-4 py-1 text-xs font-bold text-amber-950 rounded shadow-sm"
              >
                OK
              </button>

              <button
                onClick={() => {
                  window.history.back();
                }}
                className="ro-button px-4 py-1 text-xs font-bold text-slate-700 rounded shadow-sm"
              >
                Cancel
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

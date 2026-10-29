'use client';

import React, { useState, useEffect, useMemo } from 'react';

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
// 15 Static Class Slots & Dedicated Archetypes
// ---------------------------------------------------------------------------
export interface StaticClassSlot {
  slotId: number;             // 1 to 15
  cssClass: string;           // class-slot-1 .. class-slot-15
  name: string;               // e.g. Paladin, Assassin Cross, Biochemist
  title: string;              // e.g. Security & Token Auth Guardian
  role: string;
  category: 'security' | 'performance' | 'testing' | 'clinical' | 'ui';
  characterClass: 'knight' | 'bolt' | 'alchemist' | 'surgeon' | 'artist';
  sprite: string;             // dedicated sprite PNG
  video: string;              // dedicated Veo 3.1 idle video loop
  defaultStr: number;
  defaultAgi: number;
  defaultVit: number;
  defaultInt: number;
  defaultDex: number;
  defaultLuk: number;
}

export const STATIC_CLASS_SLOTS: StaticClassSlot[] = [
  {
    slotId: 1,
    cssClass: 'class-slot-1',
    name: 'Paladin',
    title: 'Security & Token Auth Guardian',
    role: 'Zero-Trust Token Validation & Session Expiry Tests',
    category: 'security',
    characterClass: 'knight',
    sprite: '/sprites/ro_paladin.png',
    video: '/sprites/videos/paladin_idle.webm',
    defaultStr: 99,
    defaultAgi: 78,
    defaultVit: 99,
    defaultInt: 65,
    defaultDex: 85,
    defaultLuk: 77
  },
  {
    slotId: 2,
    cssClass: 'class-slot-2',
    name: 'Assassin Cross',
    title: 'Performance & Fast Path Optimizer',
    role: 'Double Metaphone Memoization & Search Benchmark',
    category: 'performance',
    characterClass: 'bolt',
    sprite: '/sprites/ro_assassin_cross.png',
    video: '/sprites/videos/assassin_cross_idle.webm',
    defaultStr: 94,
    defaultAgi: 99,
    defaultVit: 72,
    defaultInt: 80,
    defaultDex: 92,
    defaultLuk: 88
  },
  {
    slotId: 3,
    cssClass: 'class-slot-3',
    name: 'Biochemist',
    title: 'Test Suite & Stress Lab Alchemist',
    role: 'Adversarial Discourse Decomposer Test Harness',
    category: 'testing',
    characterClass: 'alchemist',
    sprite: '/sprites/ro_biochemist.png',
    video: '/sprites/videos/biochemist_idle.webm',
    defaultStr: 82,
    defaultAgi: 85,
    defaultVit: 88,
    defaultInt: 99,
    defaultDex: 95,
    defaultLuk: 82
  },
  {
    slotId: 4,
    cssClass: 'class-slot-4',
    name: 'High Priest',
    title: 'Clinical Core & Surgical Lexicon',
    role: 'Cardiovascular Lexicon Invariants & Preference Engine',
    category: 'clinical',
    characterClass: 'surgeon',
    sprite: '/sprites/ro_highpriest.png',
    video: '/sprites/videos/highpriest_idle.webm',
    defaultStr: 70,
    defaultAgi: 82,
    defaultVit: 95,
    defaultInt: 99,
    defaultDex: 90,
    defaultLuk: 92
  },
  {
    slotId: 5,
    cssClass: 'class-slot-5',
    name: 'Scholar',
    title: 'UI/UX & Micro-Interaction Professor',
    role: 'Keyboard Focus Traps & ARIA Landmark Accessibility',
    category: 'ui',
    characterClass: 'artist',
    sprite: '/sprites/ro_scholar.png',
    video: '/sprites/videos/scholar_idle.webm',
    defaultStr: 75,
    defaultAgi: 88,
    defaultVit: 80,
    defaultInt: 99,
    defaultDex: 99,
    defaultLuk: 85
  },
  {
    slotId: 6,
    cssClass: 'class-slot-6',
    name: 'Grand Crusader',
    title: 'Tenant Isolation & HIPAA Shield',
    role: 'Multi-Facility Upload Path Traversal Hardening',
    category: 'security',
    characterClass: 'knight',
    sprite: '/sprites/ro_grand_crusader.png',
    video: '/sprites/videos/grand_crusader_idle.webm',
    defaultStr: 96,
    defaultAgi: 76,
    defaultVit: 99,
    defaultInt: 68,
    defaultDex: 83,
    defaultLuk: 80
  },
  {
    slotId: 7,
    cssClass: 'class-slot-7',
    name: 'Shadow Chaser',
    title: 'Cache Eviction & Memory Purger',
    role: 'In-Memory Gemini RAG Eviction & LRU Benchmark',
    category: 'performance',
    characterClass: 'bolt',
    sprite: '/sprites/ro_shadow_chaser.png',
    video: '/sprites/videos/shadow_chaser_idle.webm',
    defaultStr: 91,
    defaultAgi: 98,
    defaultVit: 74,
    defaultInt: 84,
    defaultDex: 95,
    defaultLuk: 87
  },
  {
    slotId: 8,
    cssClass: 'class-slot-8',
    name: 'Gene Synthesizer',
    title: 'Coordinate Parser & Fixtures Lab',
    role: 'Cart/Shelf/Bin Coordinate Validation & Fixtures',
    category: 'testing',
    characterClass: 'alchemist',
    sprite: '/sprites/ro_gene_synthesizer.png',
    video: '/sprites/videos/gene_synthesizer_idle.webm',
    defaultStr: 80,
    defaultAgi: 86,
    defaultVit: 84,
    defaultInt: 98,
    defaultDex: 96,
    defaultLuk: 83
  },
  {
    slotId: 9,
    cssClass: 'class-slot-9',
    name: 'Archbishop',
    title: 'Voice Discourse & Vocal Filter',
    role: 'Spoken Disfluency & Acoustic Filler Rejection',
    category: 'clinical',
    characterClass: 'surgeon',
    sprite: '/sprites/ro_archbishop.png',
    video: '/sprites/videos/archbishop_idle.webm',
    defaultStr: 72,
    defaultAgi: 83,
    defaultVit: 96,
    defaultInt: 97,
    defaultDex: 91,
    defaultLuk: 90
  },
  {
    slotId: 10,
    cssClass: 'class-slot-10',
    name: 'Professor',
    title: 'Accessible DOM & Omnibar Engine',
    role: 'Push-to-Talk Omnibar Component Regression Tests',
    category: 'ui',
    characterClass: 'artist',
    sprite: '/sprites/ro_professor.png',
    video: '/sprites/videos/professor_idle.webm',
    defaultStr: 77,
    defaultAgi: 89,
    defaultVit: 79,
    defaultInt: 99,
    defaultDex: 98,
    defaultLuk: 86
  },
  {
    slotId: 11,
    cssClass: 'class-slot-11',
    name: 'Templar Sentinel',
    title: 'Rate Limiting & Firewall Aegis',
    role: 'DoS Prevention & 429 Throttle Header Validation',
    category: 'security',
    characterClass: 'knight',
    sprite: '/sprites/ro_templar.png',
    video: '/sprites/videos/templar_idle.webm',
    defaultStr: 98,
    defaultAgi: 77,
    defaultVit: 98,
    defaultInt: 71,
    defaultDex: 86,
    defaultLuk: 78
  },
  {
    slotId: 12,
    cssClass: 'class-slot-12',
    name: 'Wind Walker',
    title: 'Dexie Delta Sync & Outbox Batcher',
    role: 'Offline-First Rapid Move Verification Debouncing',
    category: 'performance',
    characterClass: 'bolt',
    sprite: '/sprites/ro_wind_walker.png',
    video: '/sprites/videos/wind_walker_idle.webm',
    defaultStr: 93,
    defaultAgi: 99,
    defaultVit: 75,
    defaultInt: 81,
    defaultDex: 97,
    defaultLuk: 89
  },
  {
    slotId: 13,
    cssClass: 'class-slot-13',
    name: 'Apothecary',
    title: 'Adversarial Fuzzing & Stress Suite',
    role: 'Cross-Origin CSRF & Hospital Domain Boundary Hardening',
    category: 'testing',
    characterClass: 'alchemist',
    sprite: '/sprites/ro_apothecary.png',
    video: '/sprites/videos/apothecary_idle.webm',
    defaultStr: 83,
    defaultAgi: 87,
    defaultVit: 86,
    defaultInt: 96,
    defaultDex: 94,
    defaultLuk: 84
  },
  {
    slotId: 14,
    cssClass: 'class-slot-14',
    name: 'Cardinal Sage',
    title: 'Hospital Switcher & Peer Q&A Mesh',
    role: 'Multi-Tenant Peer Network Resiliency Verification',
    category: 'clinical',
    characterClass: 'surgeon',
    sprite: '/sprites/ro_cardinal.png',
    video: '/sprites/videos/cardinal_idle.webm',
    defaultStr: 73,
    defaultAgi: 81,
    defaultVit: 94,
    defaultInt: 99,
    defaultDex: 89,
    defaultLuk: 93
  },
  {
    slotId: 15,
    cssClass: 'class-slot-15',
    name: 'Arcane Chronomancer',
    title: 'LiveKit Disconnect Fallback Arbiter',
    role: 'WebRTC Heartbeat Loss Fallback to Direct Gemini',
    category: 'ui',
    characterClass: 'artist',
    sprite: '/sprites/ro_chronomancer.png',
    video: '/sprites/videos/chronomancer_idle.webm',
    defaultStr: 76,
    defaultAgi: 86,
    defaultVit: 81,
    defaultInt: 99,
    defaultDex: 97,
    defaultLuk: 90
  }
];

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
      osc.type = 'square';
      osc.frequency.setValueAtTime(987.77, now);
      osc.frequency.setValueAtTime(1318.51, now + 0.05);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'levelup') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.06);
      osc.frequency.setValueAtTime(783.99, now + 0.12);
      osc.frequency.setValueAtTime(1046.5, now + 0.18);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else {
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

// ---------------------------------------------------------------------------
// Slot Avatar Media Component with Strict Bounding & Failover
// ---------------------------------------------------------------------------
function SlotAvatarMedia({
  videoSrc,
  spriteSrc,
  name,
  className
}: {
  videoSrc?: string | null;
  spriteSrc: string;
  name: string;
  className?: string;
}) {
  const [videoError, setVideoError] = useState(false);

  return (
    <div className={`relative w-full h-full flex items-center justify-center overflow-hidden ${className || ''}`}>
      {videoSrc && !videoError ? (
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onError={() => setVideoError(true)}
          className="w-full h-full object-contain pointer-events-none ro-pixelated"
        >
          <source src={videoSrc} type="video/webm" />
          <source src={videoSrc.replace('.webm', '.mp4')} type="video/mp4" />
          <img
            src={spriteSrc}
            alt={name}
            className="w-full h-full object-contain pointer-events-none ro-pixelated animate-ro-breathe"
          />
        </video>
      ) : (
        <img
          src={spriteSrc}
          alt={name}
          className="w-full h-full object-contain pointer-events-none ro-pixelated animate-ro-breathe"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard Component
// ---------------------------------------------------------------------------
export default function JulesRagnarokWorkshopPage() {
  const [tasks, setTasks] = useState<JulesTask[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'3-slot' | '15-grid'>('15-grid');
  const [classicPage, setClassicPage] = useState<number>(0);
  const [mergedCount, setMergedCount] = useState<number>(22);
  const [countdown, setCountdown] = useState<number>(2150);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [isDispatching, setIsDispatching] = useState<boolean>(false);

  // Fetch telemetry from live pool
  const fetchPoolData = async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch('/api/jules/live-pool', { cache: 'no-store' });
      if (res.ok) {
        const data: LivePoolResponse = await res.json();
        setTasks(data.sessions || []);
        if (typeof data.mergedPRCount === 'number') setMergedCount(data.mergedPRCount);
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
    const interval = setInterval(fetchPoolData, 6000);
    return () => clearInterval(interval);
  }, []);

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 3600));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Map 15 Static Class Slots to Active Sessions
  const mappedSlots = useMemo(() => {
    return STATIC_CLASS_SLOTS.map((slot, idx) => {
      const boundSession = tasks[idx] || null;
      const isBound = !!boundSession && boundSession.state !== 'IDLE';

      return {
        slot,
        session: boundSession,
        isBound,
        state: isBound ? boundSession.state : 'IDLE',
        progress: isBound ? boundSession.progress : 0,
        activityText: isBound ? boundSession.lastActivity : 'Standby • Slot ready for assignment'
      };
    });
  }, [tasks]);

  // Selected Slot & Session State Controller
  const selectedSlotData = useMemo(() => {
    const safeIdx = Math.min(Math.max(selectedIndex, 0), STATIC_CLASS_SLOTS.length - 1);
    return mappedSlots[safeIdx] || mappedSlots[0];
  }, [mappedSlots, selectedIndex]);

  const { slot: selectedSlot, session: selectedSession, isBound: isSelectedBound } = selectedSlotData;

  // Handle Unblocking
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
            t.id === sessionId ? { ...t, state: 'IN_PROGRESS', progress: 85, lastActivity: 'Plan approved: implementing & pushing PR' } : t
          )
        );
        setTimeout(fetchPoolData, 1500);
      }
    } catch {} finally {
      setUnblockingId(null);
    }
  };

  // Handle Launching a New Quest Session into an unassigned slot
  const handleLaunchQuest = async (slotId: number) => {
    const slotIdx = slotId - 1;
    const targetSlot = STATIC_CLASS_SLOTS[slotIdx];
    setIsDispatching(true);
    if (soundEnabled) playRoSynthSound('levelup');

    try {
      const res = await fetch('/api/jules/live-pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'dispatch',
          slotIndex: slotIdx,
          slotName: targetSlot.name,
          role: targetSlot.role,
          category: targetSlot.category
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          setTasks((prev) => {
            const next = [...prev];
            next[slotIdx] = data.session;
            return next;
          });
        }
      }
    } catch (err) {
      console.warn('Launch quest failed:', err);
    } finally {
      setIsDispatching(false);
      setTimeout(fetchPoolData, 1200);
    }
  };

  const formattedCountdown = useMemo(() => {
    const m = Math.floor(countdown / 60);
    const s = countdown % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }, [countdown]);

  // Paged slots for 3-slot mode (0..4 pages of 3 slots each)
  const current3Slots = useMemo(() => {
    const start = classicPage * 3;
    return mappedSlots.slice(start, start + 3);
  }, [mappedSlots, classicPage]);

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
              Character Select — Jules Autonomous Fleet (15 Static Class Slots)
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

            {/* Window decorative buttons */}
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
          
          {/* Subtle Ice-Blue Tribal/Wing Background Watermark */}
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
                ● {mappedSlots.filter(s => s.isBound).length} / 15 Agents Deployed
              </span>
              <span className="text-xs font-mono text-slate-500 ml-2">
                origin/main: <span className="font-semibold text-blue-700">{mergedCount} PRs Merged</span>
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
            /* 15 STATIC CLASS SLOTS PARTY GRID (5x3) */
            <div className="relative z-10 grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-2.5 my-2">
              {mappedSlots.map((item, idx) => {
                const { slot, session, isBound } = item;
                const isSelected = selectedIndex === idx;

                return (
                  <div
                    key={slot.slotId}
                    onClick={() => {
                      setSelectedIndex(idx);
                      if (soundEnabled) playRoSynthSound('select');
                    }}
                    className={`${slot.cssClass} class-slot-base min-h-[168px] max-h-[185px] w-full p-2 border cursor-pointer ${
                      isSelected
                        ? 'border-[2px] border-[#6d8dc7] bg-gradient-to-b from-white to-[#f0f4fa] shadow-[0_2px_8px_rgba(109,141,199,0.4)]'
                        : item.state === 'WAITING_FOR_INPUT'
                        ? 'border-[2px] border-amber-400 bg-amber-50/40'
                        : isBound
                        ? 'border-[#cad8ea] bg-white hover:border-[#9cb4d4] hover:bg-[#fafcff]'
                        : 'border-dashed border-slate-300 bg-slate-50/50 opacity-80 hover:opacity-100 hover:border-slate-400'
                    }`}
                  >
                    {/* Protruding Periwinkle Folder Tab when Selected */}
                    {isSelected && (
                      <div className="absolute -top-[19px] left-[-2px] px-2 py-0.5 bg-[#6d8dc7] text-white text-[9px] font-bold rounded-t shadow-sm">
                        Select
                      </div>
                    )}
                    {item.state === 'WAITING_FOR_INPUT' && !isSelected && (
                      <div className="absolute -top-[19px] left-[-2px] px-2 py-0.5 bg-amber-500 text-black text-[9px] font-bold rounded-t shadow-sm animate-pulse">
                        Input?
                      </div>
                    )}
                    {!isBound && (
                      <div className="absolute top-1 right-1 px-1 py-0.2 rounded bg-slate-200 text-slate-600 text-[8px] font-mono">
                        STANDBY
                      </div>
                    )}

                    {/* Status Emote or Cast Bar */}
                    <div className="relative z-10 w-full flex flex-col items-center h-4 justify-center">
                      {item.state === 'WAITING_FOR_INPUT' ? (
                        <div className="px-1.5 py-0.2 rounded-full bg-white border border-amber-500 shadow-md text-[10px] font-bold text-amber-600 animate-bounce">
                          [ ? ]
                        </div>
                      ) : item.state === 'PR_CREATED' ? (
                        <div className="px-1.5 py-0.2 rounded bg-yellow-100 border border-yellow-500 shadow text-[9px] font-bold text-yellow-800 animate-pulse">
                          ★ LEVEL UP!
                        </div>
                      ) : isBound ? (
                        <div className="w-14 h-1.5 bg-slate-200 rounded-full border border-slate-400 overflow-hidden shadow-inner">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-yellow-400"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      ) : (
                        <div className="text-[9px] font-mono text-slate-400 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                          <span>Ready</span>
                        </div>
                      )}
                    </div>

                    {/* Avatar Container with strict CSS bounding constraints (aspect-square, max bounds) */}
                    <div className="relative z-10 w-full aspect-square max-h-[92px] max-w-[92px] sm:max-h-[105px] sm:max-w-[105px] mx-auto my-0.5 flex items-center justify-center overflow-hidden">
                      {/* Floor Oval Shadow */}
                      <div
                        className="absolute bottom-1 left-1/2 -translate-x-1/2 w-14 h-3.5 rounded-full pointer-events-none"
                        style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(60, 75, 105, 0.45) 0%, transparent 70%)' }}
                      />
                      {item.state === 'IN_PROGRESS' && (
                        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full border border-dashed border-cyan-400/50 animate-magic-seal pointer-events-none opacity-60" />
                      )}
                      <SlotAvatarMedia
                        videoSrc={slot.video}
                        spriteSrc={slot.sprite}
                        name={slot.name}
                      />
                    </div>

                    {/* Slot Name & Class Label */}
                    <div className="relative z-10 w-full text-center flex flex-col items-center leading-tight">
                      <span className="text-[10px] font-bold text-[#1e3a8a] truncate max-w-[95px]">
                        #{slot.slotId} {slot.name}
                      </span>
                      <span className="text-[8.5px] font-mono text-slate-500 truncate max-w-[95px]">
                        {isBound ? (session?.shortTag || slot.role) : 'Standby • Ready'}
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
                {current3Slots.map((item, slotIdx) => {
                  const globalIdx = classicPage * 3 + slotIdx;
                  const isSelected = selectedIndex === globalIdx;
                  const { slot, session, isBound } = item;

                  return (
                    <div
                      key={slot.slotId}
                      onClick={() => {
                        setSelectedIndex(globalIdx);
                        if (soundEnabled) playRoSynthSound('select');
                      }}
                      className={`${slot.cssClass} class-slot-base min-h-[230px] max-h-[250px] w-full p-3 border cursor-pointer ${
                        isSelected
                          ? 'border-[3px] border-[#6d8dc7] bg-gradient-to-b from-white to-[#edf3fc] shadow-[0_4px_16px_rgba(109,141,199,0.5)]'
                          : item.state === 'WAITING_FOR_INPUT'
                          ? 'border-[2px] border-amber-400 bg-amber-50/40'
                          : isBound
                          ? 'border-[#b8c8e0] bg-white hover:border-[#8ea8cf]'
                          : 'border-dashed border-slate-300 bg-slate-50/50 opacity-80'
                      }`}
                    >
                      {/* Protruding Tab */}
                      {isSelected && (
                        <div className="absolute -top-[23px] left-[-3px] px-3 py-0.5 bg-[#6d8dc7] text-white text-[10px] font-bold rounded-t shadow">
                          Select
                        </div>
                      )}

                      {/* Floating Emote / Cast Bar */}
                      <div className="relative z-10 w-full flex flex-col items-center h-5 justify-center">
                        {item.state === 'WAITING_FOR_INPUT' ? (
                          <div className="px-2 py-0.5 rounded-full bg-white border border-amber-500 shadow text-xs font-bold text-amber-600 animate-bounce">
                            [ ? Waiting Input ]
                          </div>
                        ) : item.state === 'PR_CREATED' ? (
                          <div className="px-2 py-0.5 rounded bg-yellow-100 border border-yellow-500 shadow text-xs font-bold text-yellow-800 animate-pulse">
                            ★ JOB LEVEL UP! ★
                          </div>
                        ) : isBound ? (
                          <div className="w-24 h-2 bg-slate-200 rounded-full border border-slate-400 overflow-hidden shadow-inner">
                            <div className="h-full bg-gradient-to-r from-emerald-500 to-yellow-400" style={{ width: `${item.progress}%` }} />
                          </div>
                        ) : (
                          <span className="text-[10px] font-mono text-slate-400">Standby Concurrency Slot</span>
                        )}
                      </div>

                      {/* Avatar Media with strict CSS bounding constraints */}
                      <div className="relative z-10 w-full aspect-square max-h-[140px] max-w-[140px] sm:max-h-[160px] sm:max-w-[160px] mx-auto my-1 flex items-center justify-center overflow-hidden">
                        {/* Floor Radial Shadow */}
                        <div
                          className="absolute bottom-2 left-1/2 -translate-x-1/2 w-24 h-6 rounded-full pointer-events-none"
                          style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(60, 75, 105, 0.45) 0%, transparent 70%)' }}
                        />
                        {item.state === 'IN_PROGRESS' && (
                          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-20 h-20 rounded-full border border-dashed border-cyan-500/60 animate-magic-seal pointer-events-none opacity-70" />
                        )}
                        <SlotAvatarMedia
                          videoSrc={slot.video}
                          spriteSrc={slot.sprite}
                          name={slot.name}
                        />
                      </div>

                      {/* Slot Description */}
                      <div className="relative z-10 w-full text-center flex flex-col items-center">
                        <span className="text-xs font-bold text-[#1e3a8a]">#{slot.slotId} {slot.name}</span>
                        <span className="text-[10px] font-mono text-slate-500">
                          {isBound ? (session?.shortTag || slot.role) : 'Standby • Available'}
                        </span>
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
                <span>Status Window — {selectedSlot.name}</span>
                <span className="font-mono text-[10px] text-blue-200">Slot #{selectedSlot.slotId} ({selectedSlot.category.toUpperCase()})</span>
              </div>

              <div className="grid grid-cols-2 text-xs divide-x divide-[#c4d4e6]">
                {/* Column 1: Identity & Bars */}
                <table className="w-full border-collapse">
                  <tbody>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="w-16 px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">Name</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono font-medium text-slate-800 truncate max-w-[130px]">
                        {selectedSlot.name}-{selectedSlot.slotId}
                      </td>
                    </tr>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">Job</td>
                      <td className="px-2 py-1 bg-[#f7faff] text-[11px] font-semibold text-[#1e3a8a]">
                        {selectedSlot.name} ({selectedSlot.category.toUpperCase()})
                      </td>
                    </tr>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">Lv.</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono font-bold text-slate-800">
                        {45 + (selectedSlot.slotId * 3) % 54}
                      </td>
                    </tr>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">EXP</td>
                      <td className="px-2 py-1 bg-[#f7faff]">
                        <div className="flex items-center gap-1.5 font-mono text-[10px]">
                          <span>{selectedSlotData.progress}%</span>
                          <div className="flex-1 h-1.5 bg-slate-200 rounded overflow-hidden">
                            <div className="h-full bg-blue-600" style={{ width: `${selectedSlotData.progress}%` }} />
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
                        <span className="font-bold">{selectedSlot.defaultStr}</span>
                        <span className="text-[9px] text-slate-400">Commits</span>
                      </td>
                    </tr>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">AGI</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono text-xs flex items-center justify-between">
                        <span className="font-bold">{selectedSlot.defaultAgi}</span>
                        <span className="text-[9px] text-slate-400">Speed</span>
                      </td>
                    </tr>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">VIT</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono text-xs flex items-center justify-between">
                        <span className="font-bold">{selectedSlot.defaultVit}</span>
                        <span className="text-[9px] text-slate-400">Defense</span>
                      </td>
                    </tr>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">INT</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono text-xs flex items-center justify-between">
                        <span className="font-bold">{selectedSlot.defaultInt}</span>
                        <span className="text-[9px] text-slate-400">AST Depth</span>
                      </td>
                    </tr>
                    <tr className="border-b border-[#e2eaf4]">
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">DEX</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono text-xs flex items-center justify-between">
                        <span className="font-bold">{selectedSlot.defaultDex}</span>
                        <span className="text-[9px] text-slate-400">Precision</span>
                      </td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 bg-[#dbe6f5] font-bold text-[#203a60] border-r border-[#c4d4e6]">LUK</td>
                      <td className="px-2 py-1 bg-[#f7faff] font-mono text-xs flex items-center justify-between">
                        <span className="font-bold">{selectedSlot.defaultLuk}</span>
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
                    <span>⚔️</span> {isSelectedBound ? 'Active Mission Quest' : 'Slot Concurrency Controller'}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    {isSelectedBound ? selectedSession?.branch : 'origin/main'}
                  </span>
                </div>

                <h4 className="text-xs font-semibold text-slate-800 leading-snug line-clamp-2 mb-1.5">
                  {isSelectedBound
                    ? (selectedSession?.title || `${selectedSlot.name}: ${selectedSlot.role}`)
                    : `Slot #${selectedSlot.slotId}: ${selectedSlot.name} (${selectedSlot.title})`}
                </h4>

                <div className="text-[10px] text-slate-600 bg-white p-1.5 rounded border border-[#d8e4f2] leading-tight">
                  <span className="font-bold text-[#203a60]">Live Status: </span>
                  {selectedSlotData.activityText}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-2.5 pt-2 border-t border-[#d8e4f2] flex items-center gap-2">
                {selectedSlotData.state === 'WAITING_FOR_INPUT' && selectedSession ? (
                  <button
                    onClick={() => handleUnblock(selectedSession.id)}
                    disabled={unblockingId === selectedSession.id}
                    className="ro-button-ok flex-1 py-1 px-3 text-xs font-bold text-amber-950 rounded shadow flex items-center justify-center gap-1 active:scale-95"
                  >
                    <span>⚡</span>
                    <span>{unblockingId === selectedSession.id ? 'Unblocking...' : 'OK (Approve Plan)'}</span>
                  </button>
                ) : selectedSession?.prUrl ? (
                  <a
                    href={selectedSession.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ro-button-cancel flex-1 py-1 px-3 text-xs font-bold text-sky-950 rounded shadow flex items-center justify-center gap-1 text-center active:scale-95"
                  >
                    <span>🔗</span>
                    <span>View PR on GitHub</span>
                  </a>
                ) : !isSelectedBound ? (
                  <button
                    onClick={() => handleLaunchQuest(selectedSlot.slotId)}
                    disabled={isDispatching}
                    className="ro-button-ok flex-1 py-1 px-3 text-xs font-bold text-emerald-950 rounded shadow flex items-center justify-center gap-1 active:scale-95"
                  >
                    <span>🚀</span>
                    <span>{isDispatching ? 'Dispatching...' : `Launch Quest #${selectedSlot.slotId}`}</span>
                  </button>
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
                  if (selectedSlotData.state === 'WAITING_FOR_INPUT' && selectedSession) {
                    handleUnblock(selectedSession.id);
                  } else if (!isSelectedBound) {
                    handleLaunchQuest(selectedSlot.slotId);
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

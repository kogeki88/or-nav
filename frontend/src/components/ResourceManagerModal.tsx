"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  RefreshCw,
  Trash2,
  DownloadCloud,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  Building2,
  Layers,
  UserCheck,
} from "lucide-react";
import {
  fetchPacksManifest,
  getInstalledPacks,
  installPack,
  deletePack,
  purgeUnassignedHospitalPacks,
  getResourceStorageSummary,
  getRequiredPacksForProfile,
  formatBytes,
  type PackManifestEntry,
  type HospitalPacksManifest,
  type ResourceStorageSummary,
} from "@/lib/resourceManager";
import { type InstalledResourcePack } from "@/lib/offlineDb";
import { getUserProfile, type UserProfile } from "@/lib/userProfile";

interface ResourceManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProfile?: UserProfile;
}

export default function ResourceManagerModal({
  isOpen,
  onClose,
  activeProfile,
}: ResourceManagerModalProps) {
  const [manifest, setManifest] = useState<HospitalPacksManifest | null>(null);
  const [installedPacks, setInstalledPacks] = useState<InstalledResourcePack[]>([]);
  const [storageSummary, setStorageSummary] = useState<ResourceStorageSummary>({
    totalPacksCount: 0,
    totalSizeBytes: 0,
    formattedSize: "0 B",
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const profile = activeProfile || getUserProfile();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [m, inst, summary] = await Promise.all([
        fetchPacksManifest().catch(() => null),
        getInstalledPacks(),
        getResourceStorageSummary(),
      ]);
      if (m) setManifest(m);
      setInstalledPacks(inst);
      setStorageSummary(summary);
    } catch (e: any) {
      console.warn("Error loading resource packs:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  if (!isOpen) return null;

  const installedMap = new Map<string, InstalledResourcePack>(
    installedPacks.map((p) => [p.packId, p])
  );

  // Compute required packs for active profile
  const requiredPacks = manifest
    ? getRequiredPacksForProfile(
        manifest,
        profile.facilityId,
        profile.departmentId,
        profile.clinicalRole
      )
    : [];

  const requiredIds = new Set(requiredPacks.map((p) => p.packId));

  // Other installed packs (from unassigned facilities or non-active roles)
  const otherInstalled = installedPacks.filter((p) => !requiredIds.has(p.packId));

  const handleInstallOrUpdate = async (pack: PackManifestEntry) => {
    setActionInProgress(pack.packId);
    setStatusMessage(`Downloading ${pack.title}...`);
    try {
      await installPack(pack);
      setStatusMessage(`Installed ${pack.title}`);
      await loadData();
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setActionInProgress(null);
      setTimeout(() => setStatusMessage(null), 3500);
    }
  };

  const handleDelete = async (packId: string, title: string) => {
    setActionInProgress(packId);
    setStatusMessage(`Deleting ${title}...`);
    try {
      await deletePack(packId);
      setStatusMessage(`Deleted ${title}`);
      await loadData();
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setActionInProgress(null);
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

  const handleSyncAllRequired = async () => {
    if (!manifest || requiredPacks.length === 0) return;
    setActionInProgress("sync_all");
    setStatusMessage("Syncing all required packs for your role from GitHub Cloud...");
    try {
      for (const pack of requiredPacks) {
        await installPack(pack);
      }
      setStatusMessage("All required packs synced successfully!");
      await loadData();
    } catch (err: any) {
      setStatusMessage(`Sync error: ${err.message}`);
    } finally {
      setActionInProgress(null);
      setTimeout(() => setStatusMessage(null), 3500);
    }
  };

  const handlePurgeUnassigned = async () => {
    setActionInProgress("purge_unassigned");
    setStatusMessage("Purging unassigned hospital data...");
    try {
      const purged = await purgeUnassignedHospitalPacks(profile.facilityId);
      setStatusMessage(`Purged ${purged} unassigned packs.`);
      await loadData();
    } catch (err: any) {
      setStatusMessage(`Purge error: ${err.message}`);
    } finally {
      setActionInProgress(null);
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="resource-manager-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="relative w-full max-w-lg bg-[#121215] border border-zinc-800 rounded-xl shadow-2xl text-zinc-100 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80 bg-zinc-950/60">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-emerald-400" />
            <h2 id="resource-manager-title" className="text-sm font-semibold tracking-tight text-zinc-100">
              Installed Resources
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Storage Summary Banner */}
        <div className="px-4 py-2.5 bg-zinc-900/60 border-b border-zinc-800/60 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-zinc-300">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-zinc-100">{storageSummary.totalPacksCount} Packs Installed</span>
            <span className="text-zinc-500">•</span>
            <span className="text-zinc-400">{storageSummary.formattedSize} on device</span>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono">GitHub On-Demand</span>
        </div>

        {/* Status notification */}
        {statusMessage && (
          <div className="px-4 py-2 bg-emerald-950/50 border-b border-emerald-800/50 text-[11px] text-emerald-300 flex items-center gap-1.5 animate-in fade-in">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{statusMessage}</span>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="p-4 space-y-4 overflow-y-auto text-xs flex-1">
          {/* Active Profile Packs Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Active Assignment Packs ({profile.facilityName})
              </h3>
              <span className="text-[10px] text-emerald-400/90 font-medium">
                {profile.clinicalRole}
              </span>
            </div>

            <div className="space-y-2">
              {requiredPacks.map((pack) => {
                const installed = installedMap.get(pack.packId);
                const isBusy = actionInProgress === pack.packId;

                return (
                  <div
                    key={pack.packId}
                    data-testid={`pack-item-${pack.packId}`}
                    className="p-2.5 rounded-lg bg-zinc-900/70 border border-zinc-800/90 flex items-start justify-between gap-3 hover:border-zinc-700/80 transition-colors"
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <div className="p-1.5 rounded-md bg-zinc-800/80 text-zinc-300 flex-shrink-0 mt-0.5">
                        {pack.category === "hospital" && <Building2 className="w-3.5 h-3.5 text-blue-400" />}
                        {pack.category === "department" && <Layers className="w-3.5 h-3.5 text-amber-400" />}
                        {pack.category === "role" && <UserCheck className="w-3.5 h-3.5 text-purple-400" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-zinc-200 text-xs leading-snug line-clamp-1">
                          {pack.title}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-zinc-400 mt-1">
                          <span>{formatBytes(pack.sizeBytes)}</span>
                          <span>•</span>
                          {installed ? (
                            <span className="text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 inline" /> Installed
                            </span>
                          ) : (
                            <span className="text-zinc-500">Not Installed</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleInstallOrUpdate(pack)}
                        disabled={isBusy}
                        title={installed ? "Reinstall / Update" : "Download Pack"}
                        className="p-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {installed ? (
                          <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? "animate-spin" : ""}`} />
                        ) : (
                          <DownloadCloud className={`w-3.5 h-3.5 text-emerald-400 ${isBusy ? "animate-bounce" : ""}`} />
                        )}
                      </button>

                      {installed && (
                        <button
                          type="button"
                          onClick={() => handleDelete(pack.packId, pack.title)}
                          disabled={isBusy}
                          title="Delete Pack"
                          className="p-1.5 rounded-md bg-zinc-800 hover:bg-red-950/80 hover:text-red-400 text-zinc-400 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Other Cached Packs */}
          {otherInstalled.length > 0 && (
            <div className="pt-2 border-t border-zinc-800/60">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
                Other Cached Facility / Unit Packs ({otherInstalled.length})
              </h3>
              <div className="space-y-1.5">
                {otherInstalled.map((pack) => {
                  const isBusy = actionInProgress === pack.packId;
                  return (
                    <div
                      key={pack.packId}
                      className="p-2 rounded-lg bg-zinc-950/40 border border-zinc-800/50 flex items-center justify-between text-xs"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="font-medium text-zinc-300 truncate text-[11px]">{pack.title}</div>
                        <div className="text-[10px] text-zinc-500">
                          {formatBytes(pack.sizeBytes)} • {pack.facilityId}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDelete(pack.packId, pack.title)}
                        disabled={isBusy}
                        title="Delete Pack"
                        className="p-1 rounded bg-zinc-900 hover:bg-red-950/80 hover:text-red-400 text-zinc-400 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Global Action Footer */}
        <div className="p-3 border-t border-zinc-800/80 bg-zinc-950/80 flex items-center justify-between gap-2 text-xs">
          <button
            type="button"
            onClick={handlePurgeUnassigned}
            disabled={actionInProgress !== null || otherInstalled.length === 0}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-medium text-[11px] transition-colors disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
          >
            <Trash2 className="w-3 h-3 text-red-400" />
            <span>Purge Unassigned</span>
          </button>

          <button
            type="button"
            onClick={handleSyncAllRequired}
            disabled={actionInProgress !== null || requiredPacks.length === 0}
            className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-zinc-950 font-semibold text-[11px] transition-colors shadow-sm disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
          >
            <DownloadCloud className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Sync All Required</span>
          </button>
        </div>
      </div>
    </div>
  );
}

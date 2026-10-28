"use client";

import React, { useState, useEffect } from "react";
import { X, Check, HardDrive, Award, Trophy, Flame, Target, Sparkles, Lock } from "lucide-react";
import {
  UserProfile,
  REGISTERED_FACILITIES,
  REGISTERED_DEPARTMENTS,
  ROLES_BY_DEPARTMENT,
} from "@/lib/userProfile";
import { ensureProfilePacksInstalled } from "@/lib/resourceManager";
import { updateUserAuthProfile } from "@/lib/auth";
import {
  getClinicianRewards,
  getLevelInfo,
  CLINICAL_BADGES,
  type ClinicianRewards,
} from "@/lib/gamification";

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentProfile: UserProfile;
  onSaveProfile: (updated: UserProfile) => void;
  onOpenResourceManager?: () => void;
  onboardingMode?: boolean;
  onSignOut?: () => void;
  initialTab?: "assignment" | "rewards";
}

export default function UserProfileModal({
  isOpen,
  onClose,
  currentProfile,
  onSaveProfile,
  onOpenResourceManager,
  onboardingMode = false,
  onSignOut,
  initialTab = "assignment",
}: UserProfileModalProps) {
  const [activeTab, setActiveTab] = useState<"assignment" | "rewards">(initialTab);
  const [formData, setFormData] = useState<UserProfile>(currentProfile);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [rewards, setRewards] = useState<ClinicianRewards>(getClinicianRewards());

  useEffect(() => {
    setFormData(currentProfile);
    if (isOpen) {
      setRewards(getClinicianRewards());
      if (initialTab) setActiveTab(initialTab);
    }
  }, [currentProfile, isOpen, initialTab]);

  if (!isOpen) return null;

  const currentRoles = ROLES_BY_DEPARTMENT[formData.departmentId] || ROLES_BY_DEPARTMENT["or_main"];

  const handleFacilityChange = (facId: string) => {
    const fac = REGISTERED_FACILITIES.find((f) => f.id === facId);
    setFormData({
      ...formData,
      facilityId: facId,
      facilityName: fac ? fac.name : formData.facilityName,
    });
  };

  const handleDepartmentChange = (deptId: string) => {
    const newRoles = ROLES_BY_DEPARTMENT[deptId] || ROLES_BY_DEPARTMENT["or_main"];
    const roleStillValid = newRoles.includes(formData.clinicalRole);
    setFormData({
      ...formData,
      departmentId: deptId,
      clinicalRole: roleStillValid ? formData.clinicalRole : newRoles[0],
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveProfile(formData);
    setSavedSuccess(true);
    updateUserAuthProfile(formData).catch(console.warn);
    // Background provision required 3-tier packs from GitHub
    ensureProfilePacksInstalled(formData.facilityId, formData.departmentId, formData.clinicalRole).catch(console.warn);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 500);
  };

  const levelInfo = getLevelInfo(rewards.xp);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        data-testid="profile-modal"
        className="relative w-full max-w-md bg-[#121215] border border-zinc-800 rounded-xl shadow-2xl text-zinc-100 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80 bg-zinc-950/60">
          <div className="flex items-center gap-2">
            <h2 id="profile-modal-title" className="text-sm font-semibold tracking-tight text-zinc-100">
              {onboardingMode ? "Profile Setup" : "Profile & Clinical Mastery"}
            </h2>
            {onboardingMode && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                First-Time Setup
              </span>
            )}
          </div>
          {!onboardingMode && (
            <button
              type="button"
              onClick={onClose}
              data-testid="close-profile-modal-btn"
              aria-label="Close"
              className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Tab Switcher (Visible in normal profile mode) */}
        {!onboardingMode && (
          <div className="flex border-b border-zinc-800/80 bg-zinc-950/40 p-1.5 gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab("assignment")}
              data-testid="tab-profile-assignment"
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "assignment"
                  ? "bg-zinc-800 text-zinc-100 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              👤 Assignment
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("rewards")}
              data-testid="tab-profile-rewards"
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === "rewards"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span>Rewards & Rank</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-emerald-400">
                Lv.{levelInfo.level}
              </span>
            </button>
          </div>
        )}

        {/* TAB 1: CLINICAL ASSIGNMENT */}
        {activeTab === "assignment" && (
          <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
            {/* Name */}
            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                Name
              </label>
              <input
                type="text"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                placeholder="Full name"
                required
                data-testid="input-fullname"
                className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/40 rounded-lg px-2.5 py-1.5 text-zinc-100 placeholder:text-zinc-600 transition-colors font-medium outline-none"
              />
            </div>

            {/* Facility */}
            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                Facility
              </label>
              <select
                value={formData.facilityId || "sacred_heart"}
                onChange={(e) => handleFacilityChange(e.target.value)}
                data-testid="select-facility"
                className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500/60 rounded-lg px-2.5 py-1.5 text-zinc-100 font-medium cursor-pointer transition-colors outline-none"
              >
                {REGISTERED_FACILITIES.map((fac) => (
                  <option key={fac.id} value={fac.id} className="bg-zinc-950 text-zinc-100">
                    {fac.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Department */}
            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                Department
              </label>
              <select
                value={formData.departmentId}
                onChange={(e) => handleDepartmentChange(e.target.value)}
                data-testid="select-department"
                className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500/60 rounded-lg px-2.5 py-1.5 text-zinc-100 font-medium cursor-pointer transition-colors outline-none"
              >
                {REGISTERED_DEPARTMENTS.map((dept) => (
                  <option key={dept.id} value={dept.id} className="bg-zinc-950 text-zinc-100">
                    {dept.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Role */}
            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                Role
              </label>
              <select
                value={formData.clinicalRole}
                onChange={(e) => setFormData({ ...formData, clinicalRole: e.target.value })}
                data-testid="select-role"
                className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500/60 rounded-lg px-2.5 py-1.5 text-zinc-100 font-medium cursor-pointer transition-colors outline-none"
              >
                {currentRoles.map((role) => (
                  <option key={role} value={role} className="bg-zinc-950 text-zinc-100">
                    {role}
                  </option>
                ))}
              </select>
            </div>

            {/* Knowledge Packs Access */}
            {onOpenResourceManager && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={onOpenResourceManager}
                  data-testid="btn-open-resources-from-profile"
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-[11px] font-medium transition-colors cursor-pointer"
                >
                  <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                  <span>📦 View Installed Knowledge Packs</span>
                </button>
              </div>
            )}

            {/* Footer Actions */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800/80">
              {onboardingMode && onSignOut ? (
                <button
                  type="button"
                  onClick={onSignOut}
                  data-testid="profile-onboarding-signout-btn"
                  className="px-2.5 py-1.5 rounded-lg text-zinc-500 hover:text-rose-400 text-xs transition-colors cursor-pointer"
                >
                  Sign Out
                </button>
              ) : !onboardingMode ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-medium text-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              ) : (
                <div />
              )}
              <button
                type="submit"
                disabled={savedSuccess}
                data-testid="button-save-profile"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-zinc-950 font-semibold text-xs transition-colors shadow-sm cursor-pointer disabled:opacity-50 ml-auto"
              >
                {savedSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Saved!</span>
                  </>
                ) : (
                  <span>{onboardingMode ? "Complete Setup" : "Save"}</span>
                )}
              </button>
            </div>
          </form>
        )}

        {/* TAB 2: REWARDS & RANK */}
        {activeTab === "rewards" && (
          <div className="p-3.5 space-y-3 max-h-[80vh] overflow-y-auto text-xs" data-testid="rewards-dashboard">
            {/* Compact Rank Header */}
            <div className="p-3 rounded-xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-emerald-500/30 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{levelInfo.icon}</span>
                  <div>
                    <div className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
                      <span className="text-emerald-400 font-mono">Lv.{levelInfo.level}</span>
                      <span>{levelInfo.rankTitle}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-zinc-400">
                    {rewards.xp} / {levelInfo.nextLevelXp} XP
                  </span>
                  <div className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px] font-semibold">
                    <Flame className="w-3 h-3 fill-amber-400 text-amber-400" />
                    <span>{rewards.shiftStreakDays}d</span>
                  </div>
                </div>
              </div>

              {/* Slim 6px Progress Bar */}
              <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500"
                  style={{ width: `${levelInfo.progressPercent}%` }}
                />
              </div>
            </div>

            {/* Compact Daily Shift Quests */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-0.5">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                  <Target className="w-3 h-3 text-emerald-400" />
                  <span>Daily Quests</span>
                </h3>
                <span className="text-[10px] text-zinc-500 font-mono">Resets Daily</span>
              </div>
              <div className="space-y-1">
                {rewards.dailyQuests.map((q) => (
                  <div
                    key={q.id}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs flex flex-col gap-1 transition-colors ${
                      q.completed
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                        : "bg-zinc-900/80 border-zinc-800/80 text-zinc-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-[11px] truncate flex items-center gap-1">
                        {q.completed ? "✓" : "○"} {q.title}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400 shrink-0 ml-2">
                        {q.progress}/{q.target} • <span className="text-emerald-400">+{q.xpReward} XP</span>
                      </span>
                    </div>
                    <div className="w-full h-1 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          q.completed ? "bg-emerald-400" : "bg-emerald-500/70"
                        }`}
                        style={{ width: `${Math.min(100, (q.progress / q.target) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Compact Badge Grid (3x2) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-0.5">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                  <Trophy className="w-3 h-3 text-amber-400" />
                  <span>Badges ({rewards.unlockedBadges.length}/6)</span>
                </h3>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {Object.values(CLINICAL_BADGES).map((badge) => {
                  const isUnlocked = rewards.unlockedBadges.includes(badge.id);
                  return (
                    <div
                      key={badge.id}
                      className={`p-2 rounded-xl border flex flex-col items-center text-center transition-all ${
                        isUnlocked
                          ? "bg-zinc-900 border-emerald-500/40 shadow-sm"
                          : "bg-zinc-950/40 border-zinc-800/60 opacity-60"
                      }`}
                    >
                      <span className="text-lg mb-1">{badge.icon}</span>
                      <div className="text-[10px] font-semibold text-zinc-100 truncate w-full">
                        {badge.title}
                      </div>
                      <div className="text-[9px] text-zinc-500 font-mono mt-0.5">
                        {isUnlocked ? "✓ Unlocked" : "Locked"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Done Button */}
            <div className="pt-1.5 border-t border-zinc-800/80 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                data-testid="btn-rewards-done"
                className="px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import { X, Check, HardDrive } from "lucide-react";
import {
  UserProfile,
  REGISTERED_FACILITIES,
  REGISTERED_DEPARTMENTS,
  ROLES_BY_DEPARTMENT,
} from "@/lib/userProfile";
import { ensureProfilePacksInstalled } from "@/lib/resourceManager";
import { updateUserAuthProfile } from "@/lib/auth";

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentProfile: UserProfile;
  onSaveProfile: (updated: UserProfile) => void;
  onOpenResourceManager?: () => void;
  onboardingMode?: boolean;
  onSignOut?: () => void;
}

export default function UserProfileModal({
  isOpen,
  onClose,
  currentProfile,
  onSaveProfile,
  onOpenResourceManager,
  onboardingMode = false,
  onSignOut,
}: UserProfileModalProps) {
  const [formData, setFormData] = useState<UserProfile>(currentProfile);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    setFormData(currentProfile);
  }, [currentProfile, isOpen]);

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="relative w-full max-w-sm bg-[#121215] border border-zinc-800 rounded-xl shadow-2xl text-zinc-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80 bg-zinc-950/60">
          <div className="flex items-center gap-2">
            <h2 id="profile-modal-title" className="text-sm font-semibold tracking-tight text-zinc-100">
              {onboardingMode ? "Profile Setup" : "Profile"}
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
              aria-label="Close"
              className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Clean, Minimal Form */}
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
      </div>
    </div>
  );
}

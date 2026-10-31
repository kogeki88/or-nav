/**
 * Hierarchical User Profile & Clinical Assignment Model
 * Multi-Tenant Facilities, Multi-Department Scoping, and Role-Based Access Control (RBAC).
 */

import { DEFAULT_DEPARTMENT_ID, setActiveDepartmentId } from "./departments";

export interface FacilityOption {
  id: string;
  name: string;
}

export const REGISTERED_FACILITIES: FacilityOption[] = [
  { id: "sacred_heart", name: "Sacred Heart Hospital" },
  { id: "princeton_plainsboro", name: "Princeton-Plainsboro Teaching Hospital" },
  { id: "county_general", name: "County General Hospital" },
];

export interface DepartmentOption {
  id: string;
  name: string;
}

export const REGISTERED_DEPARTMENTS: DepartmentOption[] = [
  { id: "or_main", name: "OR" },
  { id: "icu_critical_care", name: "ICU" },
  { id: "er_trauma", name: "ER" },
  { id: "pacu_periop", name: "PACU" },
];

export const ROLES_BY_DEPARTMENT: Record<string, string[]> = {
  or_main: ["Circulating RN", "Scrub Tech", "CRNA"],
  icu_critical_care: ["ICU RN", "Charge RN"],
  er_trauma: ["ER RN", "Trauma RN"],
  pacu_periop: ["PACU RN"],
};

export interface UserProfile {
  fullName: string;      // e.g. "Sean Iglesia, RN"
  email?: string;
  userId?: string;
  facilityId: string;    // "sacred_heart" | "princeton_plainsboro" | "county_general"
  facilityName: string;  // e.g. "Sacred Heart Hospital"
  departmentId: string;  // "or_main" | "icu_critical_care" | "er_trauma" | "pacu_periop"
  clinicalRole: string;  // e.g. "Circulating RN", "Scrub Tech", "CRNA"
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  fullName: "Clinical Nurse",
  facilityId: "sacred_heart",
  facilityName: "Sacred Heart Hospital",
  departmentId: DEFAULT_DEPARTMENT_ID,
  clinicalRole: "Circulating RN",
};

export const USER_PROFILE_STORAGE_KEY = "ornav_user_profile";
export const USER_PROFILE_EVENT = "ornav_user_profile_updated";

export function getRolesForDepartment(departmentId: string): string[] {
  return ROLES_BY_DEPARTMENT[departmentId] || ROLES_BY_DEPARTMENT["or_main"];
}

// Legacy helper for backward compatibility
export interface RoleScopeDefinition {
  id: string;
  name: string;
  departmentId: string;
  focusSummary: string;
  ragInstruction: string;
  prioritizedCategories: string[];
}

export function getRoleScope(departmentId: string, roleNameOrId: string): RoleScopeDefinition {
  const roleName = roleNameOrId || "Circulating RN";
  const rLower = roleName.toLowerCase();

  if (rLower.includes("scrub") || rLower.includes("tech") || rLower.includes("cst")) {
    return {
      id: "scrub_tech",
      name: "Scrub Tech",
      departmentId,
      focusSummary: "Sterile field, instrument trays, suture gauges, surgeon preferences",
      ragInstruction:
        "Focus strictly on sterile setup, instrument tray contents, exact suture/needle gauges, Mayo stand organization, and surgeon preference cards.",
      prioritizedCategories: ["Suture", "Instrument", "Mesh", "Drain"],
    };
  } else if (rLower.includes("crna") || rLower.includes("anesthes")) {
    return {
      id: "crna",
      name: "CRNA",
      departmentId,
      focusSummary: "Airway, induction meds, hemodynamic lines, Dantrolene MH cart",
      ragInstruction:
        "Focus on airway management, induction medications, hemodynamic support, and Malignant Hyperthermia (Dantrolene) cart locations and dosing.",
      prioritizedCategories: ["Airway", "Medication", "Emergency"],
    };
  }

  return {
    id: "circulating_rn",
    name: "Circulating RN",
    departmentId,
    focusSummary: "CNOR checklists, counts, safety time-outs, specimen logging",
    ragInstruction:
      "Focus on CNOR safety checklists, sponge/needle/instrument counts, patient handover (SBAR), surgical safety time-out and sign-out, and specimen logging.",
    prioritizedCategories: ["Safety", "Specimen", "Equipment", "General"],
  };
}

export function isAnesthesiaRole(role?: string): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return r.includes("crna") || r.includes("anesthes");
}

export function isScrubRole(role?: string): boolean {
  if (!role) return false;
  if (isAnesthesiaRole(role)) return false;
  const r = role.toLowerCase();
  return r.includes("scrub") || r.includes("tech") || r.includes("cst");
}

export function isNursingRole(role?: string): boolean {
  if (!role) return true;
  if (isAnesthesiaRole(role)) return false;
  if (isScrubRole(role)) return false;
  const r = role.toLowerCase();
  return r.includes("rn") || r.includes("nurse") || r.includes("circulat") || r.includes("charge");
}

/**
 * Role-Based Access Control (RBAC) Query Evaluator
 * 1. Drugs / Medications / Dosing / Drips: RN and CRNA ONLY. Restricted for Scrub Tech.
 * 2. Instrument Trays / Scrub Setups / Suture Loading: Circulator & Scrub Tech ONLY. Filtered for CRNA.
 * 3. Overall Inventory Locations: ALLOWED for all roles.
 */
export function evaluateRbacQuery(
  query: string,
  role: string
): { allowed: boolean; reason?: string } {
  const q = query.toLowerCase();

  // Medication / dosing / mixing / drip queries
  const isMedDosing =
    /\b(?:dosing|dose|doses|mixing|reconstitut|titrat|drip|bolus|iv push|mg\/kg|mcg\/kg|heparin dose|protamine dose|dantrolene dose|ryanodex dose|sugammadex dose|levophed drip|norepinephrine drip|propofol dose)\b/i.test(
      q
    );

  if (isMedDosing) {
    if (isScrubRole(role)) {
      return {
        allowed: false,
        reason: "Medication & dosing protocols are restricted to Nursing / Anesthesia roles.",
      };
    }
  }

  // Instrument tray / scrub setup / suture preference queries
  const isInstrumentSutureSetup =
    /\b(?:tray breakdown|tray setup|instrument setup|instrument tray|suture preference|suture loading|needle loading|mayo stand|back table setup|preference card)\b/i.test(
      q
    );

  if (isInstrumentSutureSetup) {
    if (isAnesthesiaRole(role)) {
      return {
        allowed: false,
        reason: "Surgical tray and instrument setups are filtered for Anesthesia roles.",
      };
    }
  }

  return { allowed: true };
}

const SUTURE_LOADING_RE = /\b(?:loaded\s+on|loads?|loading|backhand|hand-tied|suture\s+loading|needle\s+loading|double-arms?|prefers?\s+loaded)\b/i;
const DRUG_DOSING_RE = /\b(?:dos(?:e|ing|es|ed)|mg\/kg|mcg\/kg|units?\/kg|u\/kg|bolus|iv\s*push|titrat\w*|draws?|administer\w*|act\s*[><=]\s*\d+|act\s*target|target\s*act|reconstitut\w*|dilut\w*)/i;

export function filterSurgeonNoteForRole(note?: string | null, role?: string): string | null {
  if (!note || !role) return note || null;

  if (isAnesthesiaRole(role)) {
    const clauses = note.split(/[;.]/).map((c) => c.trim()).filter(Boolean);
    const filtered = clauses.filter((c) => !SUTURE_LOADING_RE.test(c));
    return filtered.length > 0 ? filtered.join("; ") : null;
  }

  if (isScrubRole(role)) {
    const clauses = note.split(/[;.]/).map((c) => c.trim()).filter(Boolean);
    const filtered = clauses.filter((c) => !DRUG_DOSING_RE.test(c));
    return filtered.length > 0 ? filtered.join("; ") : null;
  }

  return note;
}

export function getUserProfile(): UserProfile {
  if (typeof window === "undefined") return { ...DEFAULT_USER_PROFILE };
  try {
    const raw = localStorage.getItem(USER_PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_USER_PROFILE };

      const deptId = typeof parsed.departmentId === 'string' ? parsed.departmentId : DEFAULT_USER_PROFILE.departmentId;
      const facId = typeof parsed.facilityId === 'string' ? parsed.facilityId : DEFAULT_USER_PROFILE.facilityId;
      const matchedFac = REGISTERED_FACILITIES.find((f) => f.id === facId);
      const facName = matchedFac ? matchedFac.name : (typeof parsed.facilityName === 'string' ? parsed.facilityName : DEFAULT_USER_PROFILE.facilityName);

      const fullName = typeof parsed.fullName === 'string' ? parsed.fullName.trim() : DEFAULT_USER_PROFILE.fullName;
      const clinicalRole = typeof parsed.clinicalRole === 'string' ? parsed.clinicalRole : DEFAULT_USER_PROFILE.clinicalRole;

      return {
        fullName: fullName || DEFAULT_USER_PROFILE.fullName,
        facilityId: facId,
        facilityName: facName,
        departmentId: deptId,
        clinicalRole: clinicalRole || DEFAULT_USER_PROFILE.clinicalRole,
      };
    }
  } catch (e) {
    console.warn("Could not parse user profile from localStorage:", e);
  }
  return { ...DEFAULT_USER_PROFILE };
}

export function saveUserProfile(profile: UserProfile): UserProfile | void {
  if (typeof window === "undefined") return;
  try {
    const safeProfile = (typeof profile === 'object' && profile !== null) ? profile : {} as Partial<UserProfile>;
    const facId = typeof safeProfile.facilityId === 'string' ? safeProfile.facilityId : DEFAULT_USER_PROFILE.facilityId;
    const matchedFac = REGISTERED_FACILITIES.find((f) => f.id === facId);
    const facName = matchedFac ? matchedFac.name : (typeof safeProfile.facilityName === 'string' ? safeProfile.facilityName : DEFAULT_USER_PROFILE.facilityName);

    const fullName = typeof safeProfile.fullName === 'string' ? safeProfile.fullName.trim() : DEFAULT_USER_PROFILE.fullName;
    const deptId = typeof safeProfile.departmentId === 'string' ? safeProfile.departmentId : DEFAULT_USER_PROFILE.departmentId;
    const clinicalRole = typeof safeProfile.clinicalRole === 'string' ? safeProfile.clinicalRole : DEFAULT_USER_PROFILE.clinicalRole;

    const clean: UserProfile = {
      fullName: fullName || DEFAULT_USER_PROFILE.fullName,
      facilityId: facId,
      facilityName: facName,
      departmentId: deptId,
      clinicalRole: clinicalRole || DEFAULT_USER_PROFILE.clinicalRole,
    };

    localStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(clean));
    setActiveDepartmentId(clean.departmentId);
    window.dispatchEvent(new CustomEvent(USER_PROFILE_EVENT, { detail: clean }));
    return clean;
  } catch (e) {
    console.error("Failed to save user profile:", e);
  }
}

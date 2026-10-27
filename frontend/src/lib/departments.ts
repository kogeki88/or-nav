/**
 * Multi-Department / Clinical Role Model
 * Supports Operating Room (OR), Intensive Care Unit (ICU), Emergency Dept (ER), and PACU / Pre-Op.
 */

export interface DepartmentDefinition {
  id: string;
  name: string;
  shortName: string;
  category: string;
  placeholder: string;
  notesLabel: string;
  rolePrompt: string;
  vocabHint: string;
  starterPrompts: { label: string; prompt: string }[];
}

export const DEPARTMENTS: Record<string, DepartmentDefinition> = {
  or_main: {
    id: "or_main",
    name: "Operating Room (OR)",
    shortName: "OR",
    category: "Multi-Specialty Surgical Suite",
    placeholder: "Ask where an instrument/suture is, surgeon preferences, or report a move...",
    notesLabel: "Surgeon & Case Notes",
    rolePrompt: "Operating Room multi-specialty surgical circulator and scrub specialist",
    vocabHint:
      "DeBakey, Weitlaner, Prolene, Ti-Cron, Vicryl, Monocryl, Trocar, LigaSure, Dantrolene, Bovie, Heparin, Bone Wax, Gelfoam, Stryker, Pruitt",
    starterPrompts: [
      { label: "Where is 3-0 Silk?", prompt: "where is 3-0 silk" },
      { label: "Dr. Patel's suture preferences", prompt: "What sutures does Dr. Patel prefer?" },
      { label: "MH Cart & Dantrolene dose", prompt: "What is the Dantrolene dosing for malignant hyperthermia?" },
      { label: "Report an item moved", prompt: "The 3-0 silk moved to OR 21 B 1 A" },
    ],
  },
  icu_critical_care: {
    id: "icu_critical_care",
    name: "ICU / Critical Care",
    shortName: "ICU",
    category: "Intensive Care Unit",
    placeholder: "Find line kits, drip supplies, vent equipment, or check unit protocols...",
    notesLabel: "Clinical & Unit Notes",
    rolePrompt: "Intensive Care Unit (ICU) critical care nurse and clinician specialist",
    vocabHint:
      "Central line, Arterial line, GlideScope, Pleur-evac, CRRT, Norepinephrine, Propofol, ETT, Suction catheter, Transducer, Prismaflex",
    starterPrompts: [
      { label: "Where is Central Line Kit?", prompt: "where is triple lumen central line kit" },
      { label: "Arterial line transducer location", prompt: "locate arterial line transducer kit" },
      { label: "CRRT setup and filter workflow", prompt: "What is the setup workflow for CRRT filter set?" },
      { label: "Report supply moved", prompt: "The central line kit moved to ICU Supply A 1 B" },
    ],
  },
  er_trauma: {
    id: "er_trauma",
    name: "Emergency Dept (ER)",
    shortName: "ER",
    category: "Emergency & Trauma Resuscitation",
    placeholder: "Locate trauma trays, airway carts, RSI supplies, or check ED protocols...",
    notesLabel: "Clinical & Unit Notes",
    rolePrompt: "Emergency Department (ED) trauma nurse and emergency resuscitation specialist",
    vocabHint:
      "RSI tackle box, EZ-IO, Thoracotomy tray, Rapid infuser, SAM sling, Cricothyrotomy, C-collar, Narcan, Trauma bay, Belmont",
    starterPrompts: [
      { label: "Where is Adult RSI Tackle Box?", prompt: "where is adult rsi airway tackle box" },
      { label: "EZ-IO drill & needles coordinate", prompt: "find ez-io intraosseous drill" },
      { label: "Massive Transfusion Protocol (MTP)", prompt: "How do we activate massive transfusion in the ED?" },
      { label: "Report equipment moved", prompt: "The EZ-IO needles moved to Bay 2 Cart A Shelf 1 Bin B" },
    ],
  },
  pacu_periop: {
    id: "pacu_periop",
    name: "PACU / Pre-Op",
    shortName: "PACU",
    category: "Post-Anesthesia Care & Recovery",
    placeholder: "Locate reversal agents, block cart supplies, airway kits, or phase criteria...",
    notesLabel: "Clinical & Unit Notes",
    rolePrompt: "PACU and Post-Anesthesia Care unit recovery nurse specialist",
    vocabHint:
      "Sugammadex, Nerve block, Bair Hugger, Trumpet airway, Aldrete, Ondansetron, Neostigmine, High-flow cannula, Reversal",
    starterPrompts: [
      { label: "Where is Sugammadex Reversal Kit?", prompt: "where is sugammadex reversal kit" },
      { label: "Ultrasound nerve block tray", prompt: "find ultrasound nerve block tray" },
      { label: "Aldrete scoring discharge criteria", prompt: "What are the PACU Phase I Aldrete discharge criteria?" },
      { label: "Report supply moved", prompt: "The sugammadex moved to PACU Med Room A 1 A" },
    ],
  },
};

export const DEPARTMENT_LIST: DepartmentDefinition[] = Object.values(DEPARTMENTS);

export const DEFAULT_DEPARTMENT_ID = "or_main";

export const LOCAL_STORAGE_DEPT_KEY = "ornav_active_department";

export function getActiveDepartmentId(): string {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem(LOCAL_STORAGE_DEPT_KEY);
    if (saved && (DEPARTMENTS[saved] || saved === "general_memorial_cvor")) {
      return saved === "general_memorial_cvor" ? DEFAULT_DEPARTMENT_ID : saved;
    }
  }
  return DEFAULT_DEPARTMENT_ID;
}

export function setActiveDepartmentId(id: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(LOCAL_STORAGE_DEPT_KEY, id);
  }
}

export function getDepartment(id?: string): DepartmentDefinition {
  if (!id) return DEPARTMENTS[DEFAULT_DEPARTMENT_ID];
  if (id === "general_memorial_cvor") return DEPARTMENTS.or_main;
  return DEPARTMENTS[id] || DEPARTMENTS[DEFAULT_DEPARTMENT_ID];
}

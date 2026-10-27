#!/usr/bin/env python3
"""
Phase 30: Comprehensive Sample Clinical Data & Knowledge Packs Generator
Generates realistic, multi-tier clinical knowledge across:
- Tier 1: Facility Handbooks (Emergency response, Blood Bank chain of custody, SSI infection control)
- Tier 2: Department Inventories (50+ coordinate-mapped items) & Preference Cards (Lap Chole, TKA, CABG, Robotic, etc.)
- Tier 3: Role-Specific Case Guides (Scrub Tech, Circulator, CRNA, ICU RN, ER RN)
- Master Manifest: Calculates exact sizeBytes and MD5 versionHash for hospitals/manifest.json
"""

import hashlib
import json
import os
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
HOSPITALS_DIR = ROOT / "hospitals"

# ==============================================================================
# TIER 1: FACILITY HANDBOOKS
# ==============================================================================

FACILITY_HANDBOOKS = {
    "sacred_heart": """# Sacred Heart Hospital — Clinical Governance & Facility Handbook
**Urban Teaching Hospital & Surgical Pavilion**
**Facility ID:** `sacred_heart` | **Address:** 12629 Riverside Dr, North Hollywood, CA

---

## 1. Emergency Crisis Codes & Immediate Response
- **Code Blue (Adult Cardiac / Respiratory Arrest)**: Dial **x4-5555** or press red bedside emergency button.
  - Team Dispatched: Attending Intensivist, Code Team RN, Respiratory Therapy (RT), Anesthesia / CRNA, Pharmacy.
  - CPR Protocol: 100–120 compressions/min, depth 2.0–2.4 inches (5–6 cm), complete chest recoil.
  - Defibrillation: Zoll R-Series biphasic at 120J -> 150J -> 200J. Pediatric: 2 J/kg initial, 4 J/kg subsequent.
  - Medications: Epinephrine 1 mg IV push q3-5min. Amiodarone 300 mg IV push for refractory VF/pVT, second dose 150 mg.
- **Code Red (Fire / RACE & PASS)**:
  - **R**escue anyone in immediate danger.
  - **A**larm: Pull fire box by exit and dial **x4-9911**.
  - **C**onfine: Close all doors, shut off room gas valves ONLY on direct order of Charge RN / Surgeon.
  - **E**xtinguish / Evacuate: PASS (Pull, Aim, Squeeze, Sweep).
  - **Operating Room Surgical Fire Algorithm**:
    1. Immediately halt ventilation and disconnect breathing circuit from endotracheal tube.
    2. Remove all drapes, sponges, and burning materials from patient.
    3. Extinguish flames with sterile saline or wet lap sponges.
    4. Resume manual mask ventilation with ROOM AIR (FiO2 0.21) — eliminate oxidizer (O2/N2O).
    5. Assess airway with fiberoptic scope for thermal damage.
- **Code Amber (Infant / Pediatric Abduction)**:
  - Immediate overhead alert. Facility perimeter lockdown.
  - Staff must immediately staff all stairwells, elevator banks, and emergency exits.
  - Interrogate anyone carrying large bags, coats, or duffels.
- **Massive Hemorrhage Protocol (MHP / MTP)**:
  - Trigger Criteria: Shock Index (HR / SBP) > 1.0, active bleeding rate > 150 mL/min, or trauma ABC score >= 2.
  - Activation: Call Blood Bank STAT at **x4-2566** state: *"Activate Massive Transfusion Protocol for Room [X]"*.
  - **Pack 1 (Immediate)**: 4 units uncrossmatched PRBCs, 4 units thawed FFP, 1 apheresis platelet pack.
  - **Pack 2 (Continuous)**: 4 units PRBCs, 4 units FFP, 1 pool Cryoprecipitate (10 units), TXA 1 g IV.
  - Golden Ratio: Maintain balanced 1:1:1 resuscitation. Avoid crystalloid volume overload.
  - Calcium Chloride: Administer 1 g IV for every 4 units of blood products to counter citrate hypocalcemia.

---

## 2. Blood Bank & Specimen Chain of Custody
### Phlebotomy & Type & Screen Protocol
- **Two-Clinician Identification Rule**: Two licensed clinicians (RN/MD) must independently verify patient ID, full name, DOB, and MRN against wristband barcode prior to venipuncture.
- Pink Top (K2-EDTA 6 mL) tube drawn at bedside. Affix barcode label vertically. No handwritten labels accepted.
- Type & Screen valid for exactly 72 hours from draw time.

### Transfusion Administration & 2-Nurse Witness Sign-off
1. Verify physician order and patient consent in EMR.
2. Blood product must be spiked and initiated within **30 minutes** of leaving the Blood Bank cooler.
3. Two licensed nurses (or RN + CRNA/MD) must independently verify at bedside:
   - Patient Name, DOB, MRN
   - Unit donor number on bag vs Blood Bank issue slip
   - ABO and Rh compatibility
   - Expiration date and time
   - Visual inspection: Absence of clumping, hemolysis, gas bubbles, or purple discoloration.
4. Baseline vitals before spike; repeat at 15 minutes, then hourly until complete. Infuse unit within 4 hours maximum.

### Emergency Uncrossmatched Release Procedure
- When blood is required before Type & Crossmatch completion (under 15 min):
  - Females of childbearing potential (age <= 50): **O-Negative** PRBCs strictly mandatory.
  - Adult males and females > 50 years: **O-Positive** PRBCs may be released to preserve O-Negative inventory.
  - Attending Physician must sign emergency release voucher within 4 hours post-event.

### Surgical Pathology Specimen Chain of Custody
- **Frozen Section**:
  - Place specimen in dry, sterile specimen container — **NEVER ADD FORMALIN**.
  - Call Surgical Pathology at **x4-1890** (Pneumatic Station 12).
  - Hand-carry with requisition slip stating: specimen source, patient MRN, surgeon phone extension.
  - Target frozen section turnaround: 20 minutes from lab receipt.
- **Permanent Pathology**:
  - Submerge in 10% Neutral Buffered Formalin at a minimum 10:1 ratio (formalin volume to tissue volume).
  - Verify container is tightly threaded. Affix specimen requisition label with two patient identifiers.
  - **Pneumatic Tube Prohibition**: NEVER send fresh tissue, breast specimens, amputations, or irreplaceable biopsies via pneumatic tube.

---

## 3. Infection Control & Occupational Safety
### Surgical Site Infection (SSI) Prevention Bundle
1. **Skin Antisepsis**: ChloraPrep (2% CHG / 70% IPA) applied with back-and-forth friction scrub for 2 minutes on dry skin (3 minutes in groin/folds).
2. **Mandatory Dry Time**: Must allow full 3 minutes for vapors to dissipate prior to sterile draping or electrocautery activation to eliminate fire risk.
3. **Normothermia Maintenance**: Core body temperature maintained >= 36.0°C (96.8°F) using forced-air warming (Bair Hugger) or warm IV fluids.
4. **Prophylactic Antibiotics**:
   - Cefazolin (Ancef): 2 g IV (3 g if patient weight >= 120 kg) infused within 60 minutes prior to surgical incision.
   - Vancomycin: 15 mg/kg IV infused over 60–120 minutes (must complete within 120 minutes before cut).
   - Redosing: Re-dose Cefazolin every 4 hours intraoperatively for prolonged cases.
5. **Glycemic Control**: Perioperative blood glucose target < 200 mg/dL for all surgical patients.

### Sharps Injury & Bloodborne Pathogen Exposure Protocol
1. **Immediate Wound Hygiene**: Wash puncture wound immediately with antimicrobial soap and warm running water for 5 full minutes. For eye/mucous splash, flush at eyewash station for 15 minutes.
2. **Notification**: Report immediately to Charge Nurse and Operating Room Control Desk.
3. **Source Patient Testing**: Order STAT *"Post-Exposure Source Panel"* in EMR (Rapid HIV, Hepatitis B Surface Antigen, Hepatitis C Antibody).
4. **Employee Health Triage**: Report to Employee Health (Room 104, Ext **x4-1100**) or Emergency Department after hours.
5. **Post-Exposure Prophylaxis (PEP)**: High-risk HIV exposures require 3-drug antiretroviral prophylaxis (Biktarvy or Truvada + Tivicay) initiated **within 2 hours** of exposure.

### Hazardous Waste & Spill Containment
- **Red Biohazard Bags**: Saturated blood/body fluid items (> 100 mL free fluid), suction canisters, chest drain units.
- **Yellow Trace Chemo Bins**: Gowns, gloves, and tubing used in hyperthermic intraperitoneal chemotherapy (HIPEC).
- **Formalin Neutralization**: Spill kits located in Sub-Sterile Core. Pour Formalex neutralizing granules over spill, wait 15 minutes until gelled, shovel into hazardous waste container.
""",

    "princeton_plainsboro": """# Princeton-Plainsboro Teaching Hospital — Clinical Practice Guidelines & Facility Handbook
**Tertiary Academic Medical Center · Department of Diagnostic & Surgical Sciences**
**Facility ID:** `princeton_plainsboro` | **Address:** Princeton-Plainsboro Academic Campus, Plainsboro, NJ

---

## 1. Safety Alerts & Emergency Actions
- **Emergency Dispatch (All Clinical Codes)**: Call **x6-9111**. State exact Building, Pavilion, Floor, and Operating Room.
- **Code Blue (Adult Resuscitation)**:
  - Rapid Response & Anesthesia team overhead broadcast.
  - Defibrillator (Zoll X-Series) located at Central Nurses Station.
  - High-quality CPR, end-tidal CO2 (ETCO2) monitoring target > 20 mmHg during active chest compressions.
- **Code Red (Fire Emergency)**:
  - Immediate manual pull station at each exit.
  - Operating Room: Turn off oxygen and nitrous flowmeters. Pour sterile water on operative field.
  - Remove all surgical drapes and transfer patient to clean gurney immediately.
- **Code Amber (Pediatric Alert)**:
  - Automatic magnetic door lock triggers in Labor & Delivery and Pediatrics.
  - Staff members immediately assume security surveillance at all external perimeter glass exits.
- **Massive Hemorrhage Protocol (MHP / MTP)**:
  - Call Princeton-Plainsboro Blood Bank at **x6-2244**.
  - Emergency Cooler: 4 Units O-Neg PRBC, 4 Units Plasma (AB or A), 1 Platelet pack.
  - Maintain core body temperature > 36.0°C and Ionized Calcium > 1.1 mmol/L.

---

## 2. Transfusion Protocols & Specimen Chain of Custody
### Type & Screen Protocol
- Strict positive patient identification (PPID) wristband scan.
- Second phlebotomy confirmation sample required for patients without historical ABO type on file.
- Uncrossmatched emergency release authorized upon attending surgeon/CRNA signature.

### Transfusion Administration & 2-Nurse Sign-off
- 2 licensed nurses must independently check donor unit number, blood type, and crossmatch at bedside.
- Transfusion reaction: Stop immediately, notify Blood Bank, initiate saline flush.

### Specimen Management & Pathology Routing
- **Frozen Sections**:
  - Deliver dry on sterile Telfa pad. Call Frozen Desk at **x6-5400**.
  - Turnaround time target: < 20 minutes from specimen drop-off.
- **Permanent Tissue**:
  - 10% Neutral Buffered Formalin. Ensure specimen is 100% submerged (minimum 10:1 ratio).
  - Affix barcode label with initials of circulating nurse and scrub technician.
  - Never tube fresh lymph nodes, breast core biopsies, or permanent margins.

---

## 3. Infection Prevention & Sharp Safety
- **Surgical Site Infection (SSI) Bundle**:
  - Hospital-laundered scrubs only. Beard covers required for all scrubbed personnel.
  - ChloraPrep for intact skin (3-minute dry time).
  - Prophylactic Cefazolin within 60 minutes of surgical incision.
- **Needlestick Exposure Protocol**:
  - Wash with soap and water for 5 minutes.
  - Report to Employee Health (Ext **x6-4422**) or ED triage desk.
  - Rapid HIV PEP protocol available in ED Pyxis for immediate dispensing within 2 hours.
""",

    "county_general": """# County General Hospital — Clinical Governance & Emergency Trauma Handbook
**Cook County Level-I Trauma Center · Public Health System**
**Facility ID:** `county_general` | **Address:** 1835 W Harrison St, Chicago, IL

---

## 1. Emergency Crisis Codes & Immediate Extensions
- **Code Blue (Cardiac/Pulmonary Arrest)**: Dial **x8-3333**.
  - Resuscitation team: Critical Care Fellow, Code RN, Anesthesia Attending, Pharmacy Clinical Specialist.
  - Epinephrine 1 mg IV push q3-5 min. Target coronary perfusion pressure with diastolic BP > 20 mmHg.
- **Code Red (Fire Protocol)**:
  - RACE protocol. OR Fire Triad mitigation: Laser-safe ETT with methylene blue cuff saline inflation for airway cases.
  - Halon / CO2 fire extinguisher located outside every OR entrance door.
- **Code Amber (Missing Infant / Child)**:
  - Dial **x8-9911**. Overhead code announcement. Security secures all street-level turnstiles and garage exits.
- **Massive Transfusion Protocol (MTP)**:
  - Blood Bank STAT Hotline: **x8-1122**.
  - MTP Cooler Pack Alpha: 4 PRBCs, 4 FFP, 1 Single-Donor Platelet.
  - Administer TXA 1g IV over 10 min followed by 1g over 8 hours.

---

## 2. Blood Bank & Specimen Chain of Custody
- **Type & Screen Protocol**: Positive patient identification (PPID) wristband barcode scan. Valid for 72 hours.
- **Blood Product Release & 2-Nurse Sign-off**: Independent verification of patient MRN, donor unit number, ABO/Rh compatibility, and expiration at bedside before spike.
- **Emergency Uncrossmatched Release**: O-Negative PRBCs available for immediate release from Blood Bank Satellite with attending physician emergency voucher.
- **Transfusion Reaction Protocol**: Stop infusion immediately, disconnect IV tubing, infuse normal saline, notify Blood Bank, send blood unit and post-transfusion patient blood/urine sample to lab.
- **Specimens**: Frozen sections sent fresh on ice via hand runner to Room 310 (Ext **x8-4455**). Formalin containers strictly sealed in secondary ziplock biohazard bags. Never tube fresh surgical specimens.

---

## 3. Infection Control & Exposure Safety
- **Surgical Site Infection (SSI) Bundle**:
  - Pre-op CHG skin wipes night before and morning of surgery.
  - Surgical skin prep: 2% CHG / 70% IPA with 3-minute timed dry.
  - Intraoperative normothermia (>= 36.0°C) and tight glucose control (< 180 mg/dL).
- **Needlestick & Body Fluid Exposure**:
  - Wash immediately with antimicrobial soap. Flush eyes with sterile saline.
  - Notify Supervisor; report to Employee Health (Ext **x8-2200**) or ED.
  - Rapid source patient screening and PEP starter pack initiation within 120 minutes.
"""
}

# ==============================================================================
# TIER 2: DEPARTMENT PREFERENCE CARDS (JSON)
# ==============================================================================

OR_PREFERENCE_CARDS = [
    {
        "id": "lap_chole",
        "procedure": "Laparoscopic Cholecystectomy",
        "specialty": "General Surgery",
        "surgeon": "Dr. Elena Rodriguez, MD",
        "room": "OR 12",
        "position": "Supine, Reverse Trendelenburg 15°, Left Tilt 10°",
        "prep": "ChloraPrep (2% CHG / 70% IPA) - abdomen from xiphoid to pubis, bilaterally to midaxillary lines. Timed 3-minute dry.",
        "instrumentation": [
            "Lap Chole Set 1",
            "Karl Storz 10mm 30° Laparoscope",
            "LigaSure Maryland 5mm Sealer / Divider",
            "Endo Catch 10mm Specimen Bag",
            "Ethicon 5mm Medium-Large Clip Applier"
        ],
        "sutures": [
            "0 Polysorb UR-6 on fascial closure",
            "4-0 Monocryl PS-2 for subcuticular skin closure",
            "Endoloop 0 Vicryl (on standby for cystic duct)"
        ],
        "implants": "None",
        "notes": "Prefers Hassan open cut-down for umbilical port. Defogger must be heated. Veress needle not used. Keep dry lap ready for gallbladder extraction."
    },
    {
        "id": "tka",
        "procedure": "Total Knee Arthroplasty (TKA)",
        "specialty": "Orthopedic Surgery",
        "surgeon": "Dr. Marcus Chen, MD",
        "room": "OR 18",
        "position": "Supine with lateral leg positioner, thigh tourniquet, foot of bed dropped",
        "prep": "DuraPrep 2-layer, foot isolated with sterile impervious stockinette and Coban wrap",
        "instrumentation": [
            "Stryker System 8 Power Tool Set",
            "Zimmer Persona Knee Tray 1 & 2",
            "Pulsatile Lavage with 3L Normal Saline",
            "Bone Cement Gun & Spatula"
        ],
        "sutures": [
            "#1 Stratafix Spiral PDS for arthrotomy capsule",
            "2-0 Monocryl SH for subcutaneous tissue",
            "Ethicon Proximate 35W Skin Stapler"
        ],
        "implants": "Zimmer Persona Modular Cruciate Retaining (CR) Component",
        "notes": "Tourniquet inflated to 250 mmHg prior to skin incision. Vancomycin cement mixed at 14 minutes. Tranexamic acid (TXA) 1g IV given at start and deflation."
    },
    {
        "id": "cabg",
        "procedure": "Coronary Artery Bypass Graft (CABG x3)",
        "specialty": "Cardiovascular OR (CVOR)",
        "surgeon": "Dr. Arthur Vance, MD",
        "room": "OR 21",
        "position": "Supine with chest roll, bilateral legs externally rotated (frog-leg) with knee rolls",
        "prep": "ChloraPrep chin-to-ankles circumferentially. 3-minute dry time strictly timed.",
        "instrumentation": [
            "Cardiovascular Major Sternotomy Set",
            "Vascular Peripheral Micro Instruments",
            "Castroviejo Micro Needle Holders",
            "DeBakey 1.5mm & 2.0mm Pickups",
            "Internal Defibrillator Paddles (Charge to 20J)"
        ],
        "sutures": [
            "7-0 Prolene BV-1 for distal coronary anastomoses",
            "6-0 Prolene C-1 for proximal aortic anastomoses",
            "#5 Ethibond sternal closure wires (x6 or x8)",
            "3-0 Silk ties on DeBakey for venous branch ligations"
        ],
        "implants": "Hemashield 8mm vascular graft on standby",
        "notes": "Heparin 300 units/kg prior to cannulation; Target ACT > 480 sec. Cool chest with sterile saline slush. Have Protamine ready for pump separation."
    },
    {
        "id": "robotic_prostatectomy",
        "procedure": "Robotic-Assisted Laparoscopic Prostatectomy (RALP)",
        "specialty": "Urology / Robotic Surgery",
        "surgeon": "Dr. Sanjay Gupta, MD",
        "room": "OR 16 (Robotic Suite)",
        "position": "Steep Trendelenburg (28°), Lithotomy with Allen Yellofin stirrups, arms tucked securely with foam pads",
        "prep": "ChloraPrep abdomen from nipples to mid-thighs, including genitalia. 3-minute dry.",
        "instrumentation": [
            "Da Vinci Xi Robotic System",
            "8mm Monopolar Curved Scissors",
            "8mm Fenestrated Bipolar Forceps",
            "8mm ProGrasp Forceps",
            "8mm Large Needle Driver",
            "AirSeal Insufflation System (target 12 mmHg)"
        ],
        "sutures": [
            "3-0 V-Loc 180 barbed suture for vesicourethral anastomosis",
            "2-0 Vicryl CT-1 for dorsal venous complex ligation",
            "4-0 Monocryl for port sites"
        ],
        "implants": "None",
        "notes": "Verify zero pressure on brachial plexus before docking. Confirm bladder integrity with 200 mL sterile saline instillation via 3-way Foley."
    },
    {
        "id": "lumbar_microdiscectomy",
        "procedure": "Lumbar Microdiscectomy (L4-L5)",
        "specialty": "Neurosurgery / Spine",
        "surgeon": "Dr. Sarah Jenkins, MD",
        "room": "OR 14",
        "position": "Prone on Wilson frame or Jackson table, abdomen completely hanging free to minimize epidural venous pressure",
        "prep": "Betadine scrub & paint (or ChloraPrep) - lower thoracic to sacrum",
        "instrumentation": [
            "Spine Microdiscectomy Tray",
            "Zeiss OPMI Surgical Microscope",
            "McCulloch Retractor System with Micro Blades",
            "Kerrison Rongeurs 2mm, 3mm, 4mm (Up-biting & Down-biting)",
            "Woodson Dural Separator"
        ],
        "sutures": [
            "0 Vicryl CT-1 for lumbodorsal fascia",
            "2-0 Vicryl SH for subcutaneous layer",
            "4-0 Monocryl PS-2 for subcuticular skin closure"
        ],
        "implants": "None",
        "notes": "Have Surgicel and thrombin-soaked Gelfoam patties ready for epidural bleeding. Microscope brought in from patient right side."
    },
    {
        "id": "trauma_ex_lap",
        "procedure": "Trauma Exploratory Laparotomy",
        "specialty": "Trauma / Acute Care Surgery",
        "surgeon": "Dr. Karen O'Connor, MD",
        "room": "OR 1 (Trauma Dedicated)",
        "position": "Supine with arms out on armboards at 90° for rapid bilateral vascular access",
        "prep": "Rapid ChloraPrep or Betadine paint - chin to mid-thighs bilaterally",
        "instrumentation": [
            "Trauma Laparotomy Major Tray",
            "Balfour Retractor with deep blades",
            "Bookwalter Abdominal Retractor",
            "Poole Suction Tips (x2 connected to dual canisters)",
            "Satinsky & DeBakey Vascular Clamps"
        ],
        "sutures": [
            "#1 PDS Loop on CTX needle for mass abdominal closure",
            "2-0 Silk ties on passers",
            "3-0 Silk on SH for bowel oversewing",
            "Skin stapler (x2)"
        ],
        "implants": "Bogota bag / ABThera Open Abdomen VAC dressing ready on standby",
        "notes": "Warm room to 78°F. Level 1 rapid infuser primed. Count softs by 10s. Four quadrants packed with laparotomy sponges immediately upon entry."
    },
    {
        "id": "evar",
        "procedure": "Endovascular Aneurysm Repair (EVAR)",
        "specialty": "Vascular Surgery",
        "surgeon": "Dr. Tariq Al-Mansoor, MD",
        "room": "Hybrid OR 2",
        "position": "Supine on radiolucent carbon fiber fluoroscopy table",
        "prep": "ChloraPrep bilateral groins and entire abdomen to knees",
        "instrumentation": [
            "EVAR Endovascular Cut-Down / Percutaneous Tray",
            "GE Discovery IGS Hybrid Angiography System",
            "0.035in Lunderquist Extra-Stiff Wire",
            "Perclose ProGlide Suture-Mediated Closure Devices (x4)",
            "Gore C3 Excluder or Medtronic Endurant Stent Graft System"
        ],
        "sutures": [
            "4-0 Prolene RB-1 for femoral transverse arteriotomy",
            "3-0 Monocryl for groin cutdowns"
        ],
        "implants": "Bifurcated Aortic Endograft + Contralateral Iliac Limb",
        "notes": "Systemic heparinization 100 units/kg prior to sheath insertion. Target ACT > 250 sec. Power injector filled with Isovue-370 contrast."
    }
]

ICU_PREFERENCE_CARDS = [
    {
        "id": "icu_crrt_setup",
        "procedure": "Continuous Renal Replacement Therapy (CRRT) Setup",
        "specialty": "Critical Care Medicine",
        "clinician": "Critical Care Clinical Specialist RN",
        "unit": "Medical / Surgical ICU",
        "position": "Bedside supine or semi-Fowler's",
        "supplies": [
            "Baxter Prismaflex Machine",
            "Prismaflex ST150 Hemofilter Set",
            "Prismasol BGK 4/2.5 Dialysate Solution (5L Bags x 2)",
            "ACD-A Citrate Anticoagulant Solution 1000 mL",
            "10% Calcium Chloride Infusion 500 mL"
        ],
        "notes": "Prime circuit with 2L Normal Saline containing 5000 units Heparin (or pure saline if HIT suspected). Monitor post-filter ionized calcium target 0.25-0.35 mmol/L and systemic ionized calcium 1.1-1.3 mmol/L."
    },
    {
        "id": "icu_art_line",
        "procedure": "Radial Arterial Line Insertion Tray Setup",
        "specialty": "Critical Care / Anesthesia",
        "clinician": "Intensivist / Critical Care Fellow",
        "unit": "Bedside ICU",
        "position": "Wrist dorsiflexed on armboard with roll beneath wrist joint",
        "supplies": [
            "Arrow 20Ga 1.75in Radial Artery Catheterization Kit",
            "Edwards TruWave Disposable Pressure Transducer",
            "500 mL Normal Saline Flush Bag with Pressure Bag (pressurized to 300 mmHg)",
            "ChloraPrep 3 mL Applicator",
            "Tegaderm IV Advanced Dressing with CHG Gel Pad"
        ],
        "notes": "Perform Allen's test before puncture. Level transducer to phlebostatic axis (4th intercostal space, mid-axillary line) and perform square-wave flush test."
    },
    {
        "id": "icu_cvc_kit",
        "procedure": "Triple Lumen Central Venous Catheter (CVC) Insertion",
        "specialty": "Critical Care / Vascular Access",
        "clinician": "Attending Intensivist",
        "unit": "Bedside ICU",
        "position": "Trendelenburg (15°) for internal jugular or subclavian vein engorgement",
        "supplies": [
            "Arrow Triple Lumen CVC 7Fr 20cm Kit (Blue FlexTip)",
            "SonoSite Ultrasound with Vascular Linear Probe in sterile sheath",
            "Full Body Sterile Drape",
            "1% Lidocaine plain 5 mL vial",
            "Biopatch Protective Disk with CHG (blue side up)",
            "3-0 Silk suture on straight needle for wing fixation"
        ],
        "notes": "Sterile full-barrier PPE required: cap, mask, sterile gown, sterile gloves. Flush and clamp all 3 lumens prior to insertion. Post-procedure ultrasound or chest X-ray confirms catheter tip at cavoatrial junction."
    },
    {
        "id": "icu_icp_monitor",
        "procedure": "Intracranial Pressure (ICP) Monitor Insertion",
        "specialty": "Neurocritical Care",
        "clinician": "Neurosurgery Fellow / Neurointensivist",
        "unit": "Neuro ICU Bedside",
        "position": "Head elevated 30°, head midline in neutral position",
        "supplies": [
            "Codman ICP Microsensor Express Catheter Kit",
            "Codman ICP Express Monitor Console",
            "Twist Drill Cranial Access Kit with Hand Drill and Stops",
            "ChloraPrep 26 mL applicator",
            "Sterile cranial drape with aperture"
        ],
        "notes": "Target ICP < 20 mmHg. Maintain Cerebral Perfusion Pressure (CPP = MAP - ICP) between 60–70 mmHg. Zero sensor to atmospheric air BEFORE insertion into brain parenchyma."
    }
]

ER_PREFERENCE_CARDS = [
    {
        "id": "er_rsi_kit",
        "procedure": "Rapid Sequence Intubation (RSI) Protocol",
        "specialty": "Emergency Medicine / Trauma Resuscitation",
        "clinician": "Trauma Team Leader / Emergency Physician",
        "unit": "Trauma Bay 1 / 2",
        "position": "Sniffing position (ear-to-sternal notch aligned)",
        "supplies": [
            "Video Laryngoscope (GlideScope or McGRATH MAC) with Blade 3 and 4",
            "Endotracheal Tubes 7.5mm and 8.0mm cuffed with pre-lubricated stylets",
            "Bougie Tracheal Tube Introducer 15Fr",
            "Colorimetric End-Tidal CO2 Detector (Easy Cap II)",
            "Etomidate 20 mg/10 mL (Dose: 0.3 mg/kg IV push)",
            "Rocuronium 100 mg/10 mL (Dose: 1.2 mg/kg IV push for rapid paralysis)"
        ],
        "notes": "Pre-oxygenate with high-flow non-rebreather mask for 3 minutes. Have suction under mattress running. Confirm tube depth at teeth (typically 21–23 cm) and verify bilateral breath sounds."
    },
    {
        "id": "er_chest_tube",
        "procedure": "Emergency Tube Thoracostomy (Chest Tube)",
        "specialty": "Trauma Surgery / Emergency Medicine",
        "clinician": "Trauma Attending / Senior Resident",
        "unit": "Trauma Bay",
        "position": "Supine with ipsilateral arm abducted over head",
        "supplies": [
            "Chest Tube Insertion Tray (Scalpel #10, Curved Kelly, Mayo Scissors)",
            "36Fr Argyle Thoracic Drainage Catheter (Large bore for hemothorax)",
            "Atrium Oasis Dry Suction Chest Drain Unit",
            "0 Silk Suture on CT-1 Needle for horizontal mattress stay stitch",
            "Vaseline Petrolatum Gauze 3x9in",
            "Heavy 2in cloth tape"
        ],
        "notes": "Insertion site: 4th or 5th intercostal space, anterior to mid-axillary line (Safe Triangle). Blunt dissect over top of rib to avoid neurovascular bundle. Connect to -20 cmH2O wall suction."
    },
    {
        "id": "er_mtp_cooler",
        "procedure": "Massive Transfusion Protocol (MTP) Cooler Protocol",
        "specialty": "Trauma Resuscitation",
        "clinician": "Trauma Lead RN & Resuscitationist",
        "unit": "Trauma Bay 1",
        "position": "Immediate bedside rapid transfusion",
        "supplies": [
            "Belmont FMS 2000 Rapid Infuser (Flow rate up to 500 mL/min, 37.5°C)",
            "Belmont Fast-Flow Dual Spike Disposable Circuit",
            "MTP Cooler Pack 1 (4 O-Neg PRBCs, 4 FFP, 1 Platelet)",
            "Calcium Chloride 1g/10 mL IV push (give after 4th unit blood)",
            "Tranexamic Acid (TXA) 1g in 100 mL NS infused over 10 minutes"
        ],
        "notes": "Verify 2-nurse witness ID on every unit. Never infuse through standard peripheral IV catheter; use 16Ga, 14Ga, or Cordis introducer. Target SBP 90-100 mmHg (permissive hypotension until surgical hemostasis)."
    },
    {
        "id": "er_pelvic_binder",
        "procedure": "Pelvic Binder Application for Unstable Pelvic Fracture",
        "specialty": "Trauma Orthopedics / Emergency Resuscitation",
        "clinician": "Trauma Resuscitation Nurse",
        "unit": "Trauma Bay",
        "position": "Supine, lower extremities internally rotated and bound at knees/ankles",
        "supplies": [
            "SAM Pelvic Sling II (Standard Size: 32–50 in)",
            "T-POD Rapid Pelvic Stabilizer",
            "Wide elastic bandage / sheet for foot binding"
        ],
        "notes": "Placement anatomical landmark: Center binder over the GREATER TROCHANTERS of the femurs (NOT the iliac crests). Pull orange strap until buckle audibly clicks (applies 33 lbs of circumferential compression)."
    }
]

PACU_PREFERENCE_CARDS = [
    {
        "id": "pacu_aldrete_recovery",
        "procedure": "Phase 1 Post-Anesthesia Emergence & Aldrete Scoring",
        "specialty": "Post-Anesthesia Care (PACU)",
        "clinician": "PACU Primary Recovery RN",
        "unit": "PACU Bay 1-16",
        "position": "Semi-Fowler's 30° with lateral recovery head tilt",
        "supplies": [
            "High-Flow Nasal Cannula / Non-Rebreather Mask",
            "Nellcor OxiMax SpO2 Continuous Monitoring",
            "Bair Hugger Model 775 Forced Air Patient Warmer",
            "Yankauer Suction Wand attached to headwall canister"
        ],
        "notes": "Assess Aldrete score every 15 minutes (Activity, Respiration, Circulation, Consciousness, O2 Saturation). Patient requires score >= 9/10 with stable vitals for Phase 1 discharge."
    },
    {
        "id": "pacu_laryngospasm_rescue",
        "procedure": "Emergence Laryngospasm & Airway Rescue Protocol",
        "specialty": "Anesthesia Emergency",
        "clinician": "PACU RN & Anesthesia Attending",
        "unit": "PACU Bedside",
        "position": "Jaw-thrust maneuver with Larson's Notch pressure",
        "supplies": [
            "Ambu Bag-Valve-Mask with PEEP Valve set to 10 cmH2O",
            "Succinylcholine (Anectine) 20 mg/mL (Dose: 0.1–0.5 mg/kg IV push)",
            "Atropine Sulfate 0.4 mg/mL (Dose: 0.4 mg IV for bradycardia)",
            "100% Oxygen via tight mask seal"
        ],
        "notes": "Apply firm bilateral digital pressure upward and inward at Larson's Notch (behind earlobe at mastoid process). If spasm persists > 30 seconds, administer low-dose succinylcholine 20 mg IV."
    },
    {
        "id": "pacu_pca_pump_setup",
        "procedure": "Alaris PCA Pump Setup & Opioid Titration Protocol",
        "specialty": "Pain Management / Perioperative",
        "clinician": "PACU RN",
        "unit": "PACU Bedside",
        "position": "Bedside patient-controlled analgesia",
        "supplies": [
            "BD Alaris PCA Module 8120 with Tamper-Resistant Key",
            "Hydromorphone (Dilaudid) 0.2 mg/mL in 30 mL prefilled syringe",
            "Microbore PCA Extension Set with Anti-Siphon One-Way Valve",
            "Naloxone (Narcan) 0.4 mg/mL ampule at bedside for opioid reversal"
        ],
        "notes": "Standard adult settings: Bolus 0.2 mg, Lockout interval 8 minutes, 4-hour limit 3.0 mg. Continuous basal rate is ZERO for opioid-naive patients. Independent two-nurse programming verification mandatory."
    },
    {
        "id": "pacu_ponv_shivering_rescue",
        "procedure": "Post-Op Nausea & Shivering Rescue Protocol",
        "specialty": "Post-Anesthesia Care",
        "clinician": "PACU Recovery RN",
        "unit": "PACU Bedside",
        "position": "Head elevated 30°, emesis basin at bedside",
        "supplies": [
            "Ondansetron (Zofran) 4 mg IV push over 2 minutes",
            "Dexamethasone (Decadron) 4 mg IV (if not given intraoperatively)",
            "Metoclopramide (Reglan) 10 mg IV push",
            "Meperidine (Demerol) 25 mg/mL (Dose: 12.5–25 mg IV for shivering)",
            "Bair Hugger Warm Air Upper / Lower Blanket"
        ],
        "notes": "Post-anesthesia shivering increases metabolic oxygen consumption by 300%. Administer Meperidine 12.5-25 mg IV push; apply forced warm air blanket until core temperature >= 36.5°C."
    }
]

# ==============================================================================
# TIER 3: ROLE-SPECIFIC CASE GUIDES (MARKDOWN)
# ==============================================================================

ROLE_GUIDES = {
    "scrub": """# Surgical Technologist / Scrub Tech — Operating Room Case Guide
**Department:** Operating Room (OR) | **Clinical Scope:** CST / Scrub Specialist

---

## 1. Mayo Stand & Back Table Setup Rules
- **Sharps Neutral Zone**: Magnetic sharps transfer pad strictly enforced for all scalpel and suture handoffs. No hand-to-hand blade passing.
- **Micro-Instrument Care**: Fine vascular Castroviejo needle holders and DeBakey forceps must never clamp heavy needles, drapes, or towels. Inspect jaw alignment and tungsten carbide inserts before case.
- **Suture Mounting Standards**:
  - 7-0 and 6-0 Prolene: Mount 1/3 from swage on micro Castroviejo; needle oriented at 90° towards surgeon's hand.
  - Suture boots must be clamped on all fine mosquito hemostats tagging monofilament Prolene (never bare metal).
  - Heavy fascia sutures (0 Polysorb, #1 PDS): Load on heavy Mayo-Hegar needle driver 1/3 from swage, never on tip.

---

## 2. Case-by-Case Procedural Setups
### A. Laparoscopic Cholecystectomy (Dr. Elena Rodriguez)
- **Mayo Stand Layout**:
  - Front row: #11 knife, #10 knife, 2 curved Kelly hemostats, curved Metzenbaum scissors, straight Mayo scissors.
  - Middle: 10mm Hassan blunt trocar, two 5mm optical trocars, one 12mm optical trocar.
  - Back row: LigaSure Maryland 5mm, 10mm 30° laparoscope with heated defogger sleeve, atraumatic grasper, hook cautery.
- **Passing Order**:
  1. Local anesthetic syringe (0.5% Marcaine) + #11 blade for umbilical cutdown.
  2. Hassan trocar + 2 Stay sutures (0 Vicryl on UR-6).
  3. 10mm 30° laparoscope followed by two 5mm secondary port trocars under direct visualization.
  4. Endoscopic atraumatic grasper to retract fundus superiorly towards patient's right shoulder.
  5. LigaSure or hook cautery to dissect Calot's triangle and skeletonize cystic duct and cystic artery.
  6. Ethicon 5mm clip applier: 2 clips placed proximal (patient side), 1 clip distal (gallbladder side).
  7. Endoscopic scissors to transect duct and artery between clips.
  8. Endo Catch specimen pouch deployed; extract gallbladder via 12mm umbilical site.

### B. Total Knee Arthroplasty (Dr. Marcus Chen)
- **Mayo Stand Layout**:
  - Front: #10 skin blade, deep #10 blade, tissue pickups (toothed Adson & Ferris-Smith), curved Mayo scissors.
  - Bone prep: Stryker System 8 oscillating saw with sagittal blade, bone curettes, osteotomes, bone mallet.
  - Retractors: Z-retractors (pair), Hohmann retractors (narrow and broad), PCL retractor.
- **Passing Order**:
  1. Esmarch bandage wrap for leg exsanguination; inflate thigh tourniquet to 250 mmHg.
  2. #10 knife for anterior midline knee incision; change to fresh deep knife for medial parapatellar arthrotomy.
  3. Pass Hohmann retractors to subluxate patella laterally.
  4. Distal femoral resection cutting block pinned; pass oscillating saw (irrigate saw blade constantly with cold saline).
  5. Proximal tibial resection cutting guide; pass saw and bone chisel.
  6. Pulsatile lavage with 3L warm normal saline to flush cancellous bone bed.
  7. High-viscosity bone cement delivered with cement syringe; hand surgeon trial components, then mallet for impaction.
  8. Suture closure: #1 Stratafix knotless PDS on capsule, 2-0 Monocryl subcutaneous, skin stapler.

### C. Coronary Artery Bypass Graft (CABG x3) (Dr. Arthur Vance)
- **Mayo Stand Layout**:
  - Front: #10 knife, sternal saw (Stryker), sternal retractor with internal mammary artery (IMA) rake.
  - Micro vascular: Castroviejo micro needle holders, DeBakey 1.5mm pickups, Gerald toothed micro pickups, Potts-Smith reverse-angle scissors.
  - Cannulation: Aortic cannula (24Fr), dual-stage venous cannula (36/46Fr), retrograde cardioplegia catheter.
- **Passing Order**:
  1. #10 knife for median sternotomy; coagulate periosteum with Bovie (40 coag).
  2. Sternal saw passed (ensure lungs are dropped/held by anesthesia); bone wax immediately ready for sternal marrow.
  3. IMA retractor placed for left internal mammary artery (LIMA) harvest. Keep papaverine-soaked gauze ready.
  4. Aortic purse-string sutures: 2-0 Ti-Cron on pledgets loaded forehand and backhand; pass aortic cannula.
  5. Cross-clamp placed on ascending aorta; deliver cold blood cardioplegia into aortic root.
  6. Distal anastomoses: 7-0 Prolene BV-1 on micro Castroviejo, Potts scissors, fine coronary probe (1.0mm, 1.5mm).
  7. Sternal closure: #5 Ethibond sternal wires passed on heavy wire driver; wire twister and wire cutter.

### D. Robotic-Assisted Prostatectomy (Dr. Sanjay Gupta)
- **Mayo Stand & Docking**:
  - Trocars: 12mm AirSeal camera port, three 8mm robotic trocars, one 12mm assistant port.
  - Robotic Arms: Arm 1 (Fenestrated Bipolar), Arm 2 (Monopolar Curved Scissors), Arm 3 (ProGrasp Forceps).
  - Suture: 3-0 V-Loc 180 barbed suture cut to 15 cm with Lapra-Ty clip on tail for vesicourethral anastomosis.

---

## 3. Surgical Count Verification Checkpoints
1. **Initial Baseline Count**: Prior to patient entering room. Circulating RN and CST count all sponges, sharps, and instruments aloud.
2. **Cavity / Peritoneum Closure Count**: Executed before closing fascia/peritoneum. All sponges and needles must be 100% accounted for.
3. **Subcutaneous / Final Skin Count**: Completed during subcutaneous skin closure.
4. **Discrepancy Protocol**: If count is incorrect:
   - Immediately inform surgeon: *"The sponge/needle count is incorrect."*
   - Surgeon must stop closure and perform wound exploration.
   - Circulator conducts floor and trash search. CST conducts back table and Mayo stand search.
   - If unresolved: Order portable intraoperative STAT X-ray before patient leaves room.
""",

    "circulator": """# Circulating RN — Case Governance, Positioning & Safety Guide
**Department:** Operating Room (OR) | **Clinical Scope:** CNOR / Registered Nurse Specialist

---

## 1. Universal Protocol & Time-Out Scripting
### Pre-Procedure Sign-In (Before Anesthesia Induction)
- Confirm patient identity, procedure, consent, surgical site marking, allergy check, and pulse oximeter functional.
- Anesthesia safety check verified; difficult airway equipment confirmed in room.

### Formal Surgical Time-Out (Immediately Prior to Incision)
- Initiated aloud by Circulator: *"Attention team, we are ready for the Surgical Time-Out."*
- Verbal confirmation from Surgeon, CRNA, CST, and Circulator:
  - Correct Patient (Name, DOB, MRN)
  - Correct Procedure and Surgical Site / Side
  - Fire Risk Assessment Score (Scale 1–3)
  - Antibiotic Administration & Re-dose Timing (e.g. *"Cefazolin 2g IV completed at 07:42, re-dose due at 11:42"*)
  - Essential Imaging displayed on monitors
  - Anticipated Blood Loss & Implant availability

### Post-Procedure Sign-Out (Before Cavity Closure)
- Verbally confirm with surgeon: Procedure performed, final sponge/needle/instrument counts CORRECT, specimen labels read aloud, equipment issues noted.

---

## 2. Patient Positioning & Nerve Protection Matrix
- **Reverse Trendelenburg (Lap Chole)**:
  - Table tilted 15° Reverse Trendelenburg, 10° Left Tilt.
  - Padded footboard secured to prevent caudal sliding. Safety strap placed 2 inches above knees.
- **Lithotomy (Robotic Prostatectomy)**:
  - Allen Yellofin stirrups: Raise and lower legs simultaneously with two clinicians to prevent lumbar sacral torque.
  - Peroneal Nerve Protection: Ensure zero pressure against the head of the fibula.
  - Arms tucked securely at patient sides in foam sleds; fingers extended and thumbs facing ceiling.
- **Prone Position (Spine Microdiscectomy)**:
  - Wilson frame / Jackson table: Check that eyes and ears are completely free of pressure (check q15 min).
  - Breasts positioned medially, male genitalia free of compression.
  - Axillary rolls placed 3 finger breadths below axillary vault to prevent brachial plexus neuropraxia.

---

## 3. Electrosurgical Unit (ESU) & Grounding Pad Governance
- Apply Bovie grounding pad over well-vascularized muscular tissue (anterior/lateral thigh).
- Strictly avoid bony prominences, tattoos, scar tissue, joint replacements, or implanted pacemakers.
- Smoke evacuation mandatory for all open cautery and laparoscopic procedures (OSHA / AORN standard).

---

## 4. Specimen Chain of Custody & Labeling
- **Frozen Section**: Hand-carry dry in sterile cup (NO formalin). Call Pathology **x4-1890**. Turnaround target: 20 min.
- **Permanent Pathology**: Submerge tissue in 10% neutral buffered formalin (10:1 ratio). Verify 2 patient identifiers on label. Read label aloud with surgeon and scrub tech prior to sending.
""",

    "crna": """# CRNA & Anesthesia — Airway, Dosing & Emergency Hemodynamics
**Department:** Operating Room (OR) | **Clinical Scope:** CRNA / Anesthesia Provider

---

## 1. Airway Assessment & Setup
- **Pre-Op Scoring**:
  - Mallampati Class I–IV, Thyromental distance (< 6 cm predicts difficult intubation), Neck mobility.
  - STOP-Bang score for Obstructive Sleep Apnea (OSA).
- **Standard Video Laryngoscopy**: GlideScope Core / McGRATH MAC tested before induction.
- **Emergency Airway Cart**: Located in Central Corridor. Contains fiberoptic intubating bronchoscope, LMA Supreme (#3, #4, #5), Eschmann bougie, Cook percutaneous cricothyrotomy kit.

---

## 2. Anesthesia Induction & Maintenance Dosing
- **Standard Adult Induction**:
  - Propofol: 1.5–2.5 mg/kg IV (decrease to 1.0 mg/kg in elderly or hemodynamically unstable).
  - Fentanyl: 1–2 mcg/kg IV (50–100 mcg).
  - Rocuronium: 0.6 mg/kg IV for standard intubation (1.2 mg/kg for RSI).
  - Lidocaine 1%: 1.0 mg/kg IV 90 seconds prior to intubation to blunt sympathetic airway reflexes.
- **Reversal Agents**:
  - Sugammadex (Bridion): 2 mg/kg for moderate block (2 twitches on TOF); 4 mg/kg for deep block (1-2 post-tetanic twitches); 16 mg/kg for immediate rescue reversal after 1.2 mg/kg rocuronium.
  - Neostigmine (0.05 mg/kg, max 5 mg) + Glycopyrrolate (0.2 mg per 1 mg neostigmine) for TOF 4/4 with sustained tetanus.

---

## 3. Vasoactive Continuous Infusions (Smart Pump Profiles)
- **Norepinephrine (Levophed)**: 4 mg in 250 mL D5W (16 mcg/mL). Titrate 0.02–0.30 mcg/kg/min for MAP >= 65 mmHg.
- **Phenylephrine (Neo-Synephrine)**: 20 mg in 250 mL NS (80 mcg/mL). Push dose: 50–100 mcg IV bolus.
- **Vasopressin**: 20 units in 100 mL NS (0.2 units/mL). Fixed rate: 0.04 units/min (second-line vasopressor).
- **Epinephrine**: 4 mg in 250 mL NS (16 mcg/mL). Titrate 0.02–0.25 mcg/kg/min for inotropic / vasopressor support.

---

## 4. Anticoagulation & Bypass Protocols (CVOR)
- **Heparin Loading**: 300–400 units/kg IV administered via central line.
- **Target ACT**: Activated Clotting Time must be **> 480 seconds** prior to aortic cannulation and initiation of cardiopulmonary bypass (CPB). Recheck ACT every 30 minutes on pump.
- **Protamine Reversal**: 1.0 mg Protamine per 100 units of initial Heparin administered. Infuse slowly over 10–15 minutes to prevent catastrophic pulmonary vasoconstriction and hypotension.

---

## 5. Malignant Hyperthermia (MH) Emergency Protocol
1. **Immediate Actions**: Discontinue all volatile halogenated anesthetics and succinylcholine. Call for MH Cart.
2. **Hyperventilate**: 100% O2 at 10 L/min via clean circuit (place charcoal filters on inspiratory/expiratory limbs).
3. **Ryanodex (Dantrolene Sodium)**: Administer **2.5 mg/kg IV push** immediately. Each 250 mg vial reconstitutes in only 5 mL sterile water. Repeat q5-10 min until symptoms (rigidity, ETCO2 > 65, hyperthermia) subside.
4. **Cooling**: Infuse cold normal saline (4°C), lavage open cavities, apply ice packs to axillae and groin. Stop cooling when core temp reaches 38.0°C.
5. **Call MHAUS 24/7 Hotline**: 1-800-644-9737.
"""
}

ROLE_GUIDES["icu_rn"] = """# Critical Care RN — Intensive Care Unit Case & Protocol Guide
**Department:** ICU / Critical Care | **Clinical Scope:** CCRN / ICU Registered Nurse

---

## 1. Hemodynamic Monitoring & Line Calibration
- **Radial Arterial Line Calibration**:
  - Level transducer to phlebostatic axis (4th intercostal space, mid-axillary line) at each position change.
  - Perform fast-flush square-wave test q8h: assess for optimal damping (1.5–2 oscillations before return to baseline).
  - Continuous pressure bag maintained at 300 mmHg with 3 mL/hr continuous heparinized or plain saline flush.
- **Central Venous Pressure (CVP)**:
  - Connect transducer to distal brown port of triple-lumen CVC. Normal CVP target: 8–12 mmHg (12–15 mmHg in ventilated patients).
  - Biopatch placement: Blue side facing upward towards the ceiling; chlorhexidine ring directly surrounding catheter exit site.

---

## 2. Vasoactive Continuous Infusion Titration Matrix
- **Norepinephrine (Levophed)**: 4 mg/250 mL D5W (16 mcg/mL).
  - First-line for septic and distributive shock. Initial rate: 0.05 mcg/kg/min; titrate q2–5 min to maintain MAP >= 65 mmHg.
- **Vasopressin**: 20 units/100 mL NS (0.2 units/mL).
  - Second-line non-adrenergic vasoconstrictor. Fixed rate: 0.04 units/min. DO NOT TITRATE. Discontinue after norepinephrine weaned.
- **Epinephrine**: 4 mg/250 mL NS (16 mcg/mL).
  - Titrate 0.02–0.25 mcg/kg/min for cardiogenic shock or refractory hypotension with low cardiac index.
- **Nicardipine (Cardene)**: 25 mg/250 mL NS (0.1 mg/mL).
  - Initial 5 mg/hr; titrate by 2.5 mg/hr q15 min (max 15 mg/hr) to maintain target SBP in acute hemorrhagic/ischemic stroke.

---

## 3. Continuous Renal Replacement Therapy (CRRT) Management
- **Circuit Anticoagulation (Regional Citrate)**:
  - Infuse ACD-A pre-blood pump at 1.5–2.0 x blood flow rate.
  - Monitor post-filter ionized Calcium (target: 0.25–0.35 mmol/L) to prevent clotting in Prismaflex ST150 filter.
  - Infuse 10% Calcium Chloride via separate central line port to maintain systemic ionized Calcium 1.10–1.30 mmol/L.
- **Alarm Response**:
  - High Transmembrane Pressure (TMP > 250 mmHg): Indicates progressive hollow-fiber clotting; prepare replacement circuit.
  - Extremely negative access pressure (< -200 mmHg): Check vascular catheter for positional kink or fibrin sheath; reverse lines as temporary bridge.

---

## 4. Mechanical Ventilation & Daily Weaning Trials
- **Daily SAT / SBT Protocol**:
  - Spontaneous Awakening Trial (SAT): Turn off continuous sedation (propofol/precedex) at 06:00 if no active seizures, paralytics, or elevated ICP.
  - Spontaneous Breathing Trial (SBT): Place on Pressure Support 5 cmH2O, PEEP 5 cmH2O for 30 minutes if SAT passed.
  - Rapid Shallow Breathing Index (RSBI = f / Vt): Value < 105 predicts successful extubation.
- **Airway Emergency**: If accidental extubation occurs, bag-mask ventilate with 100% O2 and summon Code Airway team.
"""

ROLE_GUIDES["er_rn"] = """# Emergency & Trauma RN — Trauma Bay Resuscitation Guide
**Department:** Emergency Dept (ER) | **Clinical Scope:** CEN / TCRN / Trauma Lead Nurse

---

## 1. Trauma Bay Primary Survey & Resuscitation Sequence
- **A — Airway with C-Spine Protection**: Assess patency, clear secretions with rigid suction. Maintain manual in-line cervical stabilization.
- **B — Breathing & Ventilation**: Inspect chest rise, auscultate bilateral breath sounds. Tension pneumothorax: Immediate needle decompression with 14Ga 3.25in angiocatheter at 2nd ICS mid-clavicular line or 5th ICS anterior axillary line.
- **C — Circulation & Hemorrhage Control**: Direct pressure, CAT tourniquet placed 2–3 inches proximal to bleeding site (tighten until arterial pulse ceases). Establish 2 large-bore (16Ga or 14Ga) IVs or EZ-IO in proximal humerus.
- **D — Disability & Neurological Exam**: Glasgow Coma Scale (GCS 3–15), pupillary light reflex, gross extremity movement.
- **E — Exposure & Environmental Control**: Remove all clothing to inspect for occult wounds; immediately cover with forced-air warming blanket to prevent hypothermia.

---

## 2. Massive Transfusion Protocol (MTP) Execution
1. **Activation**: Call Blood Bank STAT (**x4-2566** or local hotline). State: *"Trauma Bay 1 MTP Activation"*.
2. **Belmont FMS 2000 Setup**: Prime rapid infuser set with 37.5°C fluid warmer. Connect to 14Ga peripheral line or central Cordis sheath.
3. **MTP Pack 1**: Rapidly infuse 4 Units O-Neg PRBCs, 4 Units Plasma (AB/A), 1 Single-Donor Platelet pack.
4. **Hemostatic Resuscitation**: Maintain 1:1:1 ratio. Administer Tranexamic Acid (TXA) 1 g IV over 10 minutes within 3 hours of injury.
5. **Calcium Replacement**: Administer Calcium Chloride 1 g IV after every 4 units of citrated blood products.

---

## 3. Rapid Sequence Intubation (RSI) Checklist
- **SOAP ME Verification**:
  - **S**uction: Dual rigid Yankauer catheters running at bedside.
  - **O**xygen: High-flow NRB at 15 L/min + nasal cannula at 15 L/min for flush apneic oxygenation.
  - **A**irway: Video laryngoscope (GlideScope or McGRATH) with blade 3/4, ETT 7.5 & 8.0 cuffed with stylets, bougie.
  - **P**harmacy: Etomidate 0.3 mg/kg IV + Rocuronium 1.2 mg/kg IV drawn and verified.
  - **M**onitors: Continuous ECG, SpO2, NIBP cycling q1min, colorimetric and waveform capnography ready.
  - **E**mergency: Cook Melker percutaneous cricothyrotomy kit verified on airway stand.

---

## 4. Emergency Thoracostomy & Pelvic Stabilization
- **Chest Tube Setup**: Assist physician with 36Fr tube for hemothorax. Connect to Atrium dry suction drain at -20 cmH2O. Tape all connection points securely.
- **SAM Pelvic Sling Application**: For open-book pelvic ring fractures with hypotension. Slide sling under patient centered over GREATER TROCHANTERS. Pull orange strap until buckle audibly clicks (33 lbs force). Internally rotate feet and bind together.
"""

ROLE_GUIDES["pacu_rn"] = """# PACU Recovery RN — Post-Anesthesia Care Unit Clinical Guide
**Department:** PACU / Post-Op | **Clinical Scope:** CPAN / Post-Anesthesia Nurse Specialist

---

## 1. Phase 1 Emergence & Aldrete Scoring
- Assess Modified Aldrete score every 15 minutes upon admission from OR:
  1. **Activity**: Moves 4 extremities voluntarily (2), 2 extremities (1), 0 extremities (0).
  2. **Respiration**: Breathes deeply and coughs freely (2), Dyspneic / shallow breathing (1), Apneic (0).
  3. **Circulation**: BP within ± 20% of pre-op level (2), ± 20–49% (1), ± 50% (0).
  4. **Consciousness**: Fully awake and oriented (2), Arousable on calling (1), Not responding (0).
  5. **O2 Saturation**: Maintains SpO2 > 92% on room air (2), Needs O2 to maintain > 90% (1), SpO2 < 90% with O2 (0).
- **Discharge Threshold**: Minimum score of **>= 9 / 10** required for transfer to inpatient floor or Phase 2 recovery.

---

## 2. Airway Emergencies & Laryngospasm Rescue
- **Symptoms**: High-pitched inspiratory stridor, suprasternal retraction, tracheal tugging, "rocking horse" paradoxical chest wall motion, acute desaturation.
- **Immediate Intervention**:
  1. 100% O2 via Ambu bag with tight mask seal and 10 cmH2O PEEP.
  2. Larson's Maneuver: Firm, upward and forward bilateral pressure at Larson's Notch (behind earlobe at the mastoid process).
  3. If complete spasm persists > 30 seconds: Administer Succinylcholine 20 mg (0.1–0.5 mg/kg) IV push. Have Atropine 0.4 mg IV ready for bradycardia.

---

## 3. Post-Operative Nausea & Shivering Protocols
- **PONV Rescue**:
  - First-line: Ondansetron (Zofran) 4 mg IV push over 2 minutes.
  - Second-line: Metoclopramide (Reglan) 10 mg IV or Dexamethasone 4 mg IV.
  - Refractory nausea: Promethazine (Phenergan) 12.5–25 mg deep IM or slow IV drip.
- **Post-Anesthetic Shivering**:
  - Increases metabolic rate and myocardial oxygen demand by up to 300%.
  - Apply Bair Hugger warm air blanket set to 43°C until core temperature >= 36.5°C.
  - Administer Meperidine (Demerol) 12.5–25 mg IV push (aborts shivering via kappa-opioid thermoregulatory resetting).

---

## 4. PCA Setup & Opioid Respiratory Depression
- **Alaris PCA Module 8120**: Two-nurse independent verification of medication, concentration, bolus dose, and lockout interval.
- **Respiratory Depression Protocol**: If RR < 8 breaths/min or patient unarousable:
  - Stimulate patient, apply high-flow oxygen.
  - Administer Naloxone (Narcan) 0.04 mg – 0.08 mg IV every 2 minutes. Titrate slowly to restore respiratory drive without completely reversing surgical analgesia.
"""

def generate_department_inventory(facility_id: str, dept_id: str) -> str:
    """Generate 50+ realistic coordinate rows for the department."""
    rows = [
        "item,category,room,cabinet,shelf,container,aliases,pending_location,verify_count,surgeon_notes,human_alias,verification_score,status,last_verified_at"
    ]

    prefix = "OR 21" if dept_id == "or" else ("ICU Core" if dept_id == "icu" else ("Trauma Bay 1" if dept_id == "er" else "PACU Bay 4"))
    
    if dept_id == "or":
        items = [
            ("DeBakey Forceps 12in", "Instruments", prefix, "J", "2", "A", "debakeys|debakey|bakery|pickup|atraumatic forceps", "Dr. Vance takes 2 pair on field; Dr. Patel prefers for coronary pickups", 3.0),
            ("Saphenous Vein Retractor (Weitlaner 3x4 Sharp)", "Instruments", prefix, "J", "3", "C", "weitlaner|white laner|white liner|vein retractor|saphenous retractor", "Weitlaner style; Dr. Chen wants 2 for vein harvest; ensure spring lock engages", 3.0),
            ("Balfour Abdominal Retractor", "Instruments", "Core Supply", "E", "1", "A", "balfour|abdominal retractor|bladder blade retractor", "Check thumb screws; includes interchangeable lateral and bladder blades", 3.0),
            ("Bookwalter Retractor System", "Instruments", "Core Supply", "M", "2", "A", "bookwalter|table mounted retractor|ring retractor", "Attach post to table rail opposite operative side; sterile wrench in tray", 3.0),
            ("Castroviejo Micro Needle Holder", "Instruments", prefix, "J", "1", "D", "castro|castroviejo|micro needle driver", "Straight jaws with lock; inspect for tungsten wear before coronary cases", 3.0),
            ("Metzenbaum Scissors 7in Curved", "Instruments", prefix, "J", "2", "B", "metz|metzenbaum|dissecting scissors", "Curved tips; never cut sutures or heavy drapes with Metzenbaum", 3.0),
            ("Mayo Scissors Heavy Straight", "Instruments", prefix, "J", "2", "C", "mayo scissors|suture scissors|straight mayo", "Used for heavy fascial cuts and cutting heavy suture ties", 3.0),
            ("Kelly Hemostatic Forceps Curved", "Instruments", prefix, "J", "3", "A", "kelly|hemostat|clamp|snap", "Standard 5.5in curved hemostat for soft tissue clamping", 3.0),
            ("Allis Tissue Forceps 6in", "Instruments", prefix, "J", "3", "B", "allis|allis clamp|grasping forceps", "5x6 teeth; used for grasping fascia and non-viable tissues", 3.0),
            ("Babcock Intestinal Forceps", "Instruments", prefix, "J", "3", "C", "babcock|tubular grasper|bowel clamp", "Atraumatic circumferential jaws for bowel and appendix grasp", 3.0),
            ("Kocher Hemostatic Forceps", "Instruments", prefix, "J", "3", "D", "kocher|oschner|toothed clamp", "1x2 aggressive teeth for tough fibrous fascial traction", 3.0),
            ("Army-Navy Retractor Pair", "Instruments", prefix, "J", "4", "A", "army navy|us army retractor|handheld retractor", "Pair of double-ended handheld retractors for superficial exposure", 3.0),
            ("Richardson Retractor Large", "Instruments", prefix, "J", "4", "B", "richardson|rich|kelly retractor", "Deep belly handheld retractor; handle with comfort grip", 3.0),
            ("Senn Retractor Double Ended", "Instruments", prefix, "J", "4", "C", "senn|senn retractor|cat paw retractor", "Sharp and dull three-prong rake on one end, right angle blade on other", 3.0),
            ("Poole Suction Tube with Guard", "Instruments", prefix, "J", "4", "D", "poole suction|abdominal suction|sump suction", "Removable outer sheath with multiple holes to prevent omental suction entrapment", 3.0),
            ("Yankauer Suction Tip with Tubing", "Instruments", prefix, "A", "1", "B", "yankauer|tonsil suction|suction wand", "Rigid plastic suction wand for oral and operative field clearance", 3.0),
            ("Bovie Pencil with Holster", "Electrosurgery", prefix, "C", "3", "B", "bovie|cautery|electrocautery|esu pencil", "Standard blade tip with push-button cut and coag controls", 3.0),
            ("LigaSure Maryland 5mm Sealer", "Energy Devices", "Core Supply", "K", "1", "A", "ligasure|maryland ligasure|bipolar sealer", "Vessel sealing up to 7mm; single-patient sterile disposable", 3.0),
            ("Harmonic Scalpel ACE+7 Shears", "Energy Devices", "Core Supply", "K", "1", "B", "harmonic|ultrasonic scalpel|harmonic ace", "Ultrasonic shears with advanced hemostasis mode", 3.0),
            ("Karl Storz 10mm 30° Laparoscope", "Video Endoscopy", "Video Tower", "1", "A", "laparoscope|10mm scope|storz scope|30 degree scope", "High definition rod lens telescope; verify light cable transmission", 3.0),
            ("Karl Storz 5mm 0° Laparoscope", "Video Endoscopy", "Video Tower", "1", "B", "5mm scope|zero degree scope|pediatric laparoscope", "Pediatric and laparoscopic hernia inspection telescope", 3.0),
            ("Insufflation Tubing with Filter", "Video Endoscopy", prefix, "K", "2", "A", "insufflation tubing|co2 tubing|gas line", "High-flow heating tubing with 0.1 micron hydrophobic filter", 3.0),
            ("Endo Catch 10mm Specimen Bag", "General/Lap", prefix, "K", "2", "B", "endo catch|specimen bag|catch bag|endo pouch", "Automatic spring opening 10mm specimen retrieval pouch", 3.0),
            ("5mm Trocar (Applied Medical Kii)", "General/Lap", prefix, "K", "1", "A", "5mm trocar|optical trocar|kii trocar", "Optical non-bladed access trocar with universal seal", 3.0),
            ("12mm Trocar (Applied Medical Kii)", "General/Lap", prefix, "K", "1", "B", "12mm trocar|camera port|large trocar", "Accommodates 5mm to 12mm instruments without reducer caps", 3.0),
            ("Hassan 10/12mm Blunt Trocar", "General/Lap", prefix, "K", "1", "C", "hassan trocar|blunt trocar|open trocar", "Blunt tip with adjustable suture retention sleeve for open entry", 3.0),
            ("Da Vinci Xi 8mm Bipolar Forceps", "Robotic", "Robotic Core", "R", "2", "A", "fenestrated bipolar|robotic bipolar|da vinci forceps", "Articulating EndoWrist bipolar instrument for delicate dissection", 3.0),
            ("Da Vinci Xi 8mm Curved Scissors", "Robotic", "Robotic Core", "R", "2", "B", "monopolar scissors|robotic shears|robotic scissors", "Hot shears monopolar curved scissors with protective cover", 3.0),
            ("Da Vinci Xi 8mm ProGrasp Forceps", "Robotic", "Robotic Core", "R", "2", "C", "prograsp|robotic grasper|tissue grasper", "Heavy serrated jaws for aggressive organ and bowel retraction", 3.0),
            ("Da Vinci Xi 8mm Large Needle Driver", "Robotic", "Robotic Core", "R", "2", "D", "needle driver|robotic driver|robotic needle holder", "Tungsten carbide diamond-cut jaws for heavy needle control", 3.0),
            ("3-0 Silk Suture", "Sutures", prefix, "A", "2", "C", "3-0 silk|30 silk|silk ties|free ties|three-oh silk", "Dr. Chen uses for venous cannulation tie-down; Dr. Patel prefers loaded on Debakey", 3.0),
            ("0 Silk Suture on CT-1", "Sutures", prefix, "A", "2", "B", "0 silk|zero silk|aught silk", "Heavy ligating suture for pelvic and deep abdominal pedicles", 3.0),
            ("2-0 Prolene Suture on SH", "Sutures", prefix, "A", "2", "D", "2-0 prolene|20 prolene|blue suture|pro lean", "Dr. Vance double-arms for aortic root purse-strings", 3.0),
            ("4-0 Prolene Suture on RB-1", "Sutures", prefix, "A", "3", "A", "4-0 prolene|40 prolene|four-oh prolene", "Fine vascular monofilament for femoral and carotid arteriotomies", 3.0),
            ("6-0 Prolene Suture on C-1", "Sutures", prefix, "A", "3", "B", "6-0 prolene|60 prolene|six-oh prolene", "Micro vascular suture for coronary proximal aortic anastomoses", 3.0),
            ("7-0 Prolene Suture on BV-1", "Sutures", prefix, "A", "3", "C", "7-0 prolene|70 prolene|seven-oh prolene", "Micro coronary bypass suture for LAD and circumflex grafting", 3.0),
            ("2-0 Ti-Cron Braided Suture", "Sutures", prefix, "A", "2", "E", "ti-cron|ticron|braided poly|tie cron", "Coated polyester braided suture on V-7 needle for valve annulus", 3.0),
            ("0 Vicryl (Polysorb UR-6 Suture)", "Sutures", prefix, "A", "1", "A", "0 vicryl|0 polysorb|zero vicryl|fascial closure suture", "Absorbable braided synthetic suture for heavy fascial closure", 3.0),
            ("2-0 Vicryl on SH", "Sutures", prefix, "A", "1", "B", "2-0 vicryl|20 vicryl|purple suture", "Standard soft tissue and peritoneum closure suture", 3.0),
            ("3-0 Vicryl on SH", "Sutures", prefix, "A", "1", "C", "3-0 vicryl|30 vicryl|vicryl suture", "Subcutaneous fat and GI tract mucosal closure", 3.0),
            ("3-0 Monocryl Suture on PS-2", "Sutures", prefix, "A", "1", "D", "3-0 monocryl|30 monocryl|monocryl", "Clear monofilament absorbable suture for plastic subcuticular closure", 3.0),
            ("#1 Stratafix Spiral PDS", "Sutures", prefix, "A", "4", "A", "stratafix|barbed suture|pds stratafix", "Knotless tissue control barbed suture for arthrotomy and fascia", 3.0),
            ("Endo GIA 60mm Articulating Stapler", "Mechanical Closure", "Core Supply", "S", "2", "A", "endo gia|lap stapler|curved stapler", "Endoscopic linear cutting stapler with 45° articulation", 3.0),
            ("Endo GIA 60mm Purple Reload", "Mechanical Closure", "Core Supply", "S", "2", "B", "purple reload|tri-staple reload|thick tissue reload", "Medium/Thick tissue reload (1.5mm - 2.25mm) for stomach and colon", 3.0),
            ("Ethicon Proximate 35W Skin Stapler", "Mechanical Closure", prefix, "A", "4", "B", "skin stapler|stapler|wide staples", "Wide 35-shot sterile disposable surgical skin stapler", 3.0),
            ("#5 Ethibond Sternal Closure Wires", "Mechanical Closure", prefix, "B", "3", "D", "sternal wires|sternum wire|closure wire", "#5 gauge stainless steel wires for adult median sternotomy closure", 3.0),
            ("Surgicel Fibrillar Absorbable Hemostat", "Hemostatics", prefix, "D", "1", "A", "surgicel|oxidized cellulose|fibrillar", "Multi-layer peelable absorbable hemostat for oozing vascular beds", 3.0),
            ("Floseal Hemostatic Matrix Kit 5mL", "Hemostatics", "Core Supply", "Refrig", "2", "B", "floseal|flowseal|thrombin matrix", "Gelatin matrix with bovine thrombin for high-pressure bleeding", 3.0),
            ("Gelfoam Absorbable Gelatin Sponge", "Hemostatics", prefix, "D", "1", "B", "gelfoam|gelatin sponge|gelfoam pad", "Compressed absorbable sponge; soak in topical thrombin solution", 3.0),
            ("Bone Wax Hemostatic Plates", "Hemostatics", prefix, "D", "1", "C", "bone wax|wax plates|sternal wax", "Refined beeswax matrix for mechanical control of bone marrow bleeding", 3.0),
            ("Heparin Sodium 1000u/mL 10mL", "Medications", "Core Supply", "Pyxis D", "1", "A", "heparin|hep|unfractionated heparin", "Anesthesia draws; perfusion confirms ACT > 480 before cannulation. Refrigerated overflow in Pharmacy", 3.0),
            ("Protamine Sulfate 10mg/mL 5mL", "Medications", "Core Supply", "Pyxis D", "1", "B", "protamine|protamine sulfate|heparin reversal", "Specific antagonist for heparin; infuse slowly to avoid hypotension", 3.0),
            ("Dantrolene (Ryanodex) 250mg", "Medications", "MH Cart", "Top", "1", "A", "dantrolene|ryanodex|malignant hyperthermia drug", "250mg vial reconstitutes in 5mL sterile water for MH crisis", 3.0),
            ("0.5% Marcaine with Epinephrine", "Medications", "Core Supply", "Pyxis D", "2", "A", "marcaine|bupivacaine|local with epi", "Long-acting local anesthetic; never inject intravenously", 3.0),
            ("Cefazolin (Ancef) 2g IV Vial", "Medications", "Core Supply", "Pyxis D", "3", "A", "cefazolin|ancef|preop antibiotic", "First-generation cephalosporin for surgical site prophylaxis", 3.0),
            ("Tranexamic Acid (TXA) 1000mg/10mL", "Medications", "Core Supply", "Pyxis D", "3", "B", "txa|tranexamic acid|antifibrinolytic", "Antifibrinolytic hemostatic agent; give within 3 hours of trauma", 3.0),
            ("Stryker System 7 Drill Battery Pack", "Power Tools", "Core Supply", "P", "1", "A", "stryker drill battery|stryker battery|drill battery|power tool battery", "Sterile rechargeable lithium-ion battery for System 7 sagittal saw and drill", 3.0),
        ]
    elif dept_id == "icu":
        items = [
            ("Arrow 20Ga 1.75in Radial Artery Kit", "Arterial Access", prefix, "A", "1", "A", "art line|radial art line|arterial catheter", "Integral spring-wire guide with hydrophilic catheter", 3.0),
            ("Arterial Line Transducer (Edwards TruWave)", "Monitoring", prefix, "A", "1", "B", "transducer|pressure line|arterial transducer|arterial line transducer", "Single-channel disposable physiological pressure monitoring set", 3.0),
            ("Central Line (Arrow Triple Lumen CVC 7Fr 20cm)", "Vascular Access", prefix, "A", "2", "A", "central line|cvc|triple lumen|triple lumen central line kit", "Blue FlexTip catheter for multi-infusion hemodynamic access", 3.0),
            ("Teleflex HD Catheter 13.5Fr 20cm", "Dialysis Access", prefix, "A", "2", "B", "dialysis line|quinton catheter|hd line", "Curved dual-lumen high-flow catheter for acute CRRT access", 3.0),
            ("Biopatch Protective Disk with CHG", "Dressings", prefix, "A", "3", "A", "biopatch|chg patch|blue disk", "Antimicrobial chlorhexidine gluconate disc; blue side must face up", 3.0),
            ("ChloraPrep 3mL Clear Applicator", "Antiseptics", prefix, "A", "3", "B", "chloraprep|chg prep|skin prep", "2% CHG with 70% IPA; allow full 2-3 minute dry time", 3.0),
            ("Tegaderm 3M IV Advanced Dressing", "Dressings", prefix, "A", "3", "C", "tegaderm|transparent dressing|central line dressing", "Securement dressing with breathable border and date label", 3.0),
            ("GlideScope Core Video Laryngoscope", "Airway", "Clean Core", "Bay 4", "1", "A", "glidescope|video laryngoscope|difficult airway scope", "Titanium reusable video monitor with hyperangulated camera blade", 3.0),
            ("GlideScope Spectrum LoPro Blade 3", "Airway", "Clean Core", "Bay 4", "1", "B", "glidescope blade|lopro 3|video blade", "Disposable low-profile video laryngoscope blade for adult intubation", 3.0),
            ("Endotracheal Tube 7.5mm Cuffed", "Airway", "Airway Cart", "2", "A", "ett 7.5|7.5 tube|endotracheal tube", "High-volume low-pressure cuff with radiopaque line", 3.0),
            ("Endotracheal Tube 8.0mm Cuffed", "Airway", "Airway Cart", "2", "B", "ett 8.0|8.0 tube|large endotracheal tube", "Standard adult male endotracheal tube with 15mm connector", 3.0),
            ("Parker Flex-Tip ETT 7.0mm", "Airway", "Airway Cart", "2", "C", "parker ett|flex tip tube|soft tip ett", "Centering curved tip designed to prevent laryngeal trauma", 3.0),
            ("Adult Tracheal Tube Introducer Bougie", "Airway", "Airway Cart", "3", "B", "bougie|intubating guide|coude tip bougie", "15Fr 70cm flexible polyester bougie with 40° Coude tip", 3.0),
            ("In-Line Closed Suction Catheter 14Fr", "Respiratory", prefix, "B", "1", "A", "in-line suction|ballard suction|closed suction", "24-hour closed suction system to prevent alveolar derecruitment", 3.0),
            ("Hollister AnchorFast ETT Fastener", "Respiratory", prefix, "B", "2", "A", "anchorfast|tube holder|ett securement", "Eliminates need for cloth tape; prevents accidental extubation", 3.0),
            ("Shiley Cuffed Tracheostomy Tube Size 8", "Airway", "Airway Cart", "4", "B", "trach tube|shiley 8|tracheostomy", "Disposable cannula tracheostomy tube with low-pressure cuff", 3.0),
            ("Heat and Moisture Exchanger (HME)", "Respiratory", prefix, "B", "3", "A", "hme|artificial nose|ventilator filter", "Passive humidification filter with bacterial/viral retention", 3.0),
            ("Prismaflex ST150 CRRT Filter Set", "CRRT", "Clean Core", "Dialysis", "1", "A", "prismaflex set|crrt filter|st150 set|crrt filter set", "AN69 surface-treated membrane for CVVH and CVVHD modes", 3.0),
            ("Prismasol BGK 4/2.5 Solution 5L", "CRRT", "Warm Storage", "Rack 2", "1", "A", "prismasol|crrt fluid|dialysate bag", "Physiological replacement solution with potassium and bicarbonate", 3.0),
            ("ACD-A Citrate Anticoagulant 1000mL", "CRRT", "Dialysis Bay", "3", "A", "citrate|acd-a|regional anticoagulation", "Regional citrate anticoagulation solution for CRRT circuit", 3.0),
            ("Codman ICP Microsensor Kit", "Neurological", "Neuro Cart", "1", "A", "icp bolt|codman bolt|intracranial monitor", "Parenchymal strain-gauge sensor for continuous ICP monitoring", 3.0),
            ("External Ventricular Drain (EVD) Kit", "Neurological", "Neuro Cart", "1", "B", "evd|ventriculostomy|drainage transducer", "Closed CSF drainage system with laser leveling clamp", 3.0),
            ("Atrium Oasis Dry Suction Chest Drain", "Drainage", "Clean Core", "Chest", "2", "A", "chest drain|pleur-evac|atrium drain", "Dry suction regulator with pre-calibrated -20 cmH2O setting", 3.0),
            ("Argyle Thoracic Catheter 28Fr", "Drainage", "Clean Core", "Chest", "1", "A", "chest tube|28fr chest tube|thoracostomy tube", "Clear PVC tube with radiopaque sentinel line for pleural fluid", 3.0),
            ("BARD Arctic Sun 5000 Gel Pads", "Thermal Control", "Clean Core", "Bay 2", "3", "A", "arctic sun pads|targeted temp pads|cooling pads", "Hydrogel temperature management pads for postcardiac arrest TTM", 3.0),
            ("Norepinephrine 4mg/250mL D5W", "Medications", "Med Pyxis", "Vasoactive", "1", "A", "levophed|norepi|first line vasopressor", "First-line vasopressor for septic and distributive shock; target MAP >= 65", 3.0),
            ("Vasopressin 20 units/100mL NS", "Medications", "Med Pyxis", "Vasoactive", "2", "A", "vaso|vasopressin|second line pressor", "Non-adrenergic vasoconstrictor; fixed infusion rate 0.04 units/min", 3.0),
            ("Epinephrine Infusion 4mg/250mL", "Medications", "Med Pyxis", "Vasoactive", "3", "A", "epi infusion|epinephrine drip|inotropic support", "Potent beta-1 inotropic and alpha-1 vasoconstrictor support", 3.0),
            ("Nicardipine (Cardene) 25mg/250mL", "Medications", "Med Pyxis", "Vasoactive", "4", "A", "cardene|nicardipine|calcium channel drip", "Dihydropyridine calcium blocker for post-stroke hypertension", 3.0),
            ("Propofol (Diprivan) 1000mg/100mL", "Medications", "Med Pyxis", "Sedation", "1", "A", "propofol|diprivan|sedation drip", "GABA-agonist short-acting sedative for mechanically ventilated patients", 3.0),
            ("Dexmedetomidine (Precedex) 200mcg", "Medications", "Med Pyxis", "Sedation", "2", "A", "precedex|dexmedetomidine|alpha2 sedative", "Selective alpha-2 agonist providing conscious sedation without respiratory depression", 3.0),
            ("Fentanyl Citrate 2500mcg/50mL", "Medications", "Narcotic Vault", "Safe", "1", "A", "fentanyl drip|fentanyl infusion|opioid analgesia", "Potent synthetic opioid; monitor for chest wall rigidity at high doses", 3.0),
            ("Midazolam (Versed) 50mg/50mL", "Medications", "Narcotic Vault", "Safe", "2", "A", "versed|midazolam|benzo drip", "Benzodiazepine for refractory status epilepticus and deep sedation", 3.0),
            ("Cisatracurium (Nimbex) 200mg/20mL", "Medications", "Refrig 1", "Shelf 1", "A", "nimbex|cisatracurium|paralytic drip", "Non-depolarizing neuromuscular blocker eliminated via Hofmann degradation", 3.0),
            ("Sodium Bicarbonate 8.4% 50mEq", "Medications", "Code Cart", "1", "A", "bicarb|sodium bicarb|alkalinizing agent", "Emergency treatment of severe metabolic acidosis and hyperkalemia", 3.0),
            ("Amiodarone 150mg/100mL D5W", "Medications", "Med Pyxis", "Cardiac", "1", "A", "amiodarone|cordarone|antiarrhythmic", "Class III antiarrhythmic for ventricular tachycardia and atrial fibrillation", 3.0),
            ("Calcium Chloride 10% 1g/10mL", "Medications", "Code Cart", "1", "B", "calcium chloride|calcium ampule|ion calcium", "Rapidly bioavailable calcium for hyperkalemia and calcium blocker overdose", 3.0),
            ("Potassium Chloride 20mEq/100mL", "Medications", "Med Pyxis", "Electrolyte", "3", "A", "kcl|potassium rider|electrolyte rider", "Concentrated potassium replacement; max peripheral rate 10 mEq/hr", 3.0),
            ("Regular Insulin 100 units/100mL", "Medications", "Med Pyxis", "Endocrine", "1", "A", "insulin drip|regular insulin|dka protocol", "Continuous IV infusion for diabetic ketoacidosis and glycemic control", 3.0),
            ("Dextrose 50% (D50W) 25g/50mL", "Medications", "Code Cart", "1", "C", "d50|dextrose 50|hypoglycemia syringe", "Immediate parenteral glucose for severe symptomatic hypoglycemia", 3.0),
            ("Naloxone (Narcan) 0.4mg/mL", "Medications", "Med Pyxis", "Reversal", "1", "A", "narcan|naloxone|opioid reversal", "Competitive pure opioid antagonist; titrate small doses to avoid flash pulmonary edema", 3.0),
            ("Flumazenil (Romazicon) 0.5mg/5mL", "Medications", "Med Pyxis", "Reversal", "2", "A", "flumazenil|romazicon|benzo reversal", "Benzodiazepine antagonist; use with caution in chronic benzo dependence (seizure risk)", 3.0),
            ("Alaris Infusion Pump 8100 Channel", "Equipment", "Clean Core", "Pump Rack", "1", "A", "alaris pump|iv pump|infusion module", "Smart pump module with Guardrails dose error reduction software", 3.0),
            ("Zoll R-Series Defibrillator", "Equipment", "ICU Station", "Central", "1", "A", "defibrillator|zoll|crash cart monitor", "Biphasic defibrillator with external pacing and CPR feedback puck", 3.0),
            ("Fisher & Paykel Airvo 2 High Flow", "Respiratory", "Clean Core", "Resp Bay", "2", "A", "airvo|high flow nasal cannula|hfnc unit", "Humidified high flow nasal cannula delivering up to 60 L/min with FiO2 1.0", 3.0),
            ("Puritan Bennett 980 Ventilator", "Respiratory", "Clean Core", "Resp Bay", "1", "A", "ventilator|pb980|mechanical vent", "Advanced intensive care mechanical ventilator with invasive and non-invasive modes", 3.0),
            ("Bair Hugger Warming Blanket Full", "Thermal Control", prefix, "B", "4", "A", "bair hugger blanket|warming blanket|normothermia", "Forced-air warming blanket to prevent hypothermia-induced coagulopathy", 3.0),
            ("Kangaroo OMNI Enteral Feeding Pump", "Nutrition", "Clean Core", "Nutr Bay", "1", "A", "feeding pump|kangaroo pump|tube feeding", "Programmable continuous and intermittent enteral feeding and flushing system", 3.0),
            ("Salem Sump Nasogastric Tube 16Fr", "Gastrointestinal", prefix, "C", "1", "A", "ng tube|salem sump|stomach tube", "Dual-lumen tube for continuous gastric decompression and suction", 3.0),
            ("Bard PureWick Female External Catheter", "Urology", prefix, "C", "2", "A", "purewick|female urinal|wick catheter", "Non-invasive suction-based external urine collection to prevent CAUTI", 3.0),
        ]
    elif dept_id == "er":
        items = [
            ("Belmont FMS 2000 Rapid Infuser", "Resuscitation", prefix, "R", "1", "A", "belmont|rapid infuser|fms 2000", "Electromagnetic induction warmer infusing blood products up to 500 mL/min", 3.0),
            ("Belmont Dual Spike Disposable Set", "Resuscitation", prefix, "R", "1", "B", "belmont tubing|rapid infuser circuit|belmont set", "Fast-flow fluid circuit with integral pressure monitoring and air purging", 3.0),
            ("Pelvic Binder (SAM Pelvic Sling II)", "Trauma", "Wall Rack", "1", "A", "sam sling|pelvic binder|pelvic sling|pelvic binder sam sling", "Circumferential pelvic compression device; apply over greater trochanters", 3.0),
            ("T-POD Pelvic Stabilization Device", "Trauma", "Wall Rack", "1", "B", "t-pod|pelvic clamp|pelvic belt", "Mechanical pulley compression system for open-book pelvic ring fractures", 3.0),
            ("Philadelphia Cervical Collar Adult", "Trauma", "Wall Cabinet", "1", "A", "c-collar|neck collar|cervical collar", "Rigid immobilizing cervical orthosis for suspected spinal trauma", 3.0),
            ("EZ-IO Intraosseous Drill & Needles", "Vascular Access", prefix, "Resus", "2", "A", "ez-io|io drill|intraosseous driver|ez-io intraosseous drill", "Lithium battery powered driver for immediate bone marrow vascular access", 3.0),
            ("EZ-IO 25mm 15Ga Needle Set (Blue)", "Vascular Access", prefix, "Resus", "2", "B", "blue io needle|25mm io|adult io needle", "Standard adult needle for proximal tibia and humeral head insertion", 3.0),
            ("EZ-IO 45mm 15Ga Needle Set (Yellow)", "Vascular Access", prefix, "Resus", "2", "C", "yellow io needle|45mm io|bariatric io needle", "Long needle for proximal humerus or bariatric adult tibia", 3.0),
            ("CAT Tourniquet Gen 7", "Trauma", "Tackle Box", "1", "A", "tourniquet|cat|windlass tourniquet", "Combat Application Tourniquet for limb arterial hemorrhage control", 3.0),
            ("QuikClot Combat Gauze Z-Folded", "Hemostatics", "Tackle Box", "1", "B", "quikclot|combat gauze|kaolin gauze", "Kaolin-impregnated non-woven gauze for wound packing and rapid clotting", 3.0),
            ("Asherman Chest Seal 1-Way Valve", "Trauma", "Tackle Box", "2", "A", "chest seal|asherman|sucking chest wound seal", "Occlusive dressing with flutter valve for open pneumothorax", 3.0),
            ("ARS 14Ga 3.25in Decompression Needle", "Trauma", "Tackle Box", "2", "B", "dart|decompression needle|needle thoracostomy", "Long angiocatheter for immediate relief of tension pneumothorax", 3.0),
            ("ED Thoracotomy Emergency Tray", "Surgical", "Sterile Core", "1", "A", "thoracotomy tray|clam shell tray|open chest tray", "Surgical instruments for resuscitative clamshell thoracotomy", 3.0),
            ("Finochietto Rib Spreader Heavy", "Surgical", "Sterile Core", "1", "B", "rib spreader|finochietto|chest retractor", "Heavy geared retractor for rapid intercostal exposure during arrest", 3.0),
            ("Satinsky Atraumatic Vascular Clamp", "Surgical", "Sterile Core", "2", "A", "satinsky|vascular clamp|aortic clamp", "Cross-action clamp for descending thoracic aorta cross-clamping", 3.0),
            ("Scalpel Handle #3 with #10 Blade", "Surgical", prefix, "1", "A", "10 scalpel|knife|skin knife", "Standard disposable surgical scalpel for emergency incisions", 3.0),
            ("Chest Tube Insertion Tray", "Thoracostomy", prefix, "Cart C", "1", "A", "chest tube tray|thoracostomy set|insertion kit", "Disposable sterile drape, scalpel, curved Rochester Pean, and scissors", 3.0),
            ("Atrium Express Dry Suction Drain", "Thoracostomy", prefix, "Cart C", "2", "A", "chest drain|atrium express|dry suction", "Compact chest drainage unit with visual vacuum indicator", 3.0),
            ("36Fr Argyle Thoracic Catheter", "Thoracostomy", prefix, "Cart C", "3", "A", "36fr chest tube|large chest tube|hemothorax tube", "Large diameter PVC tube for rapid drainage of clotted hemothorax", 3.0),
            ("Cook Melker Cricothyrotomy Kit", "Airway", "Airway Cart", "Top", "A", "cric kit|cricothyrotomy|surgical airway", "Emergency Seldinger percutaneous airway kit for 'Cannot Intubate Cannot Oxygenate'", 3.0),
            ("RSI Medication Tackle Box", "Airway", "ED Pyxis", "Shelf 1", "A", "rsi box|intubation kit|airway drugs", "Sealed kit containing Etomidate, Rocuronium, Succinylcholine, and syringes", 3.0),
            ("McGRATH MAC Video Laryngoscope", "Airway", prefix, "Stand", "1", "A", "mcgrath|video scope|mac scope", "Portable direct and indirect video laryngoscope with disposable blades", 3.0),
            ("MacIntosh Blade #3 & #4 Fiberoptic", "Airway", "Airway Cart", "1", "A", "mac blade|curved blade|macintosh", "Traditional curved stainless steel blade for direct visualization", 3.0),
            ("Miller Blade #2 & #3 Straight", "Airway", "Airway Cart", "1", "B", "miller blade|straight blade|pediatric blade", "Straight blade for lifting the epiglottis in anterior airways and pediatrics", 3.0),
            ("Endotracheal Tube 7.5mm with Stylet", "Airway", "Airway Cart", "2", "A", "7.5 ett|endotracheal tube|cuffed ett", "Pre-loaded with malleable aluminum stylet for rapid placement", 3.0),
            ("Easy Cap II CO2 Detector", "Airway", "Airway Cart", "3", "A", "co2 detector|easy cap|colorimetric indicator", "Purple-to-yellow chemical indicator verifying tracheal tube placement", 3.0),
            ("Ambu Spur II Adult Bag-Valve-Mask", "Airway", prefix, "Hook", "1", "A", "ambu bag|bvm|bag valve mask", "Single-use manual resuscitator with oxygen reservoir and pressure relief", 3.0),
            ("LMA Supreme #4 Adult Mask", "Airway", "Airway Cart", "4", "A", "lma|laryngeal mask|supraglottic airway", "Second-generation supraglottic airway with integral gastric drain tube", 3.0),
            ("Etomidate (Amidate) 20mg/10mL", "Medications", "ED Pyxis", "RSI", "1", "A", "etomidate|amidate|induction agent", "Cardiostable non-barbiturate hypnotic agent for emergency RSI", 3.0),
            ("Rocuronium (Zemuron) 100mg/10mL", "Medications", "ED Refrig", "1", "A", "rocuronium|zemuron|paralytic", "Intermediate-acting paralytic; 1.2 mg/kg provides paralysis in 60 sec", 3.0),
            ("Succinylcholine (Anectine) 200mg", "Medications", "ED Refrig", "1", "B", "sux|succinylcholine|depolarizing paralytic", "Depolarizing blocker; avoid in crush injury, burns > 24h, and hyperkalemia", 3.0),
            ("Ketamine (Ketalar) 500mg/10mL", "Medications", "Narcotic Vault", "Safe", "3", "A", "ketamine|ketalar|dissociative anesthetic", "Dissociative anesthetic providing bronchodilation and hemodynamically stable sedation", 3.0),
            ("Kcentra 4-Factor PCC 1000u", "Medications", "Blood Bank", "Satellite", "1", "A", "kcentra|pcc|warfarin reversal", "Non-activated 4-factor prothrombin complex concentrate for urgent INR reversal", 3.0),
            ("Andexanet Alfa (Andexxa) Kit", "Medications", "Pharmacy", "Vault", "A", "andexxa|eliquis reversal|xarelto reversal", "Specific recombinant reversal agent for Factor Xa inhibitor hemorrhage", 3.0),
            ("Praxbind (Idarucizumab) 5g IV", "Medications", "Pharmacy", "Vault", "B", "praxbind|idarucizumab|pradaxa reversal", "Humanized monoclonal antibody fragment reversing dabigatran within minutes", 3.0),
            ("Glucagon Emergency Kit 1mg", "Medications", "ED Pyxis", "Endocrine", "2", "A", "glucagon|hypo kit|beta blocker antidote", "Parenteral treatment for severe hypoglycemia and refractory beta-blocker toxicity", 3.0),
            ("Narcan (Naloxone) 4mg Nasal Spray", "Medications", "Triage Pyxis", "Rapid", "1", "A", "nasal narcan|naloxone spray|opioid antidote", "Pre-packaged needle-free intranasal opioid antagonist for rapid triage", 3.0),
            ("Cyanokit (Hydroxocobalamin) 5g", "Medications", "Hazmat Cart", "1", "A", "cyanokit|cyanide antidote|hydroxocobalamin", "First-line cyanide antidote binding cyanide ions to form harmless cyanocobalamin", 3.0),
            ("CroFab Crotalidae Antivenin", "Medications", "ED Refrig", "Antivenin", "1", "A", "crofab|snake bite antivenin|pit viper antidote", "Ovine-derived polyvalent antivenin for North American pit viper envenomation", 3.0),
            ("Dextrose 10% in Water 500mL", "IV Fluids", prefix, "Fluid Warm", "1", "A", "d10|d10w|pediatric dextrose", "Continuous infusion for neonatal hypoglycemia and hyperinsulinemic states", 3.0),
            ("0.9% Normal Saline 1000mL Bag", "IV Fluids", prefix, "Fluid Warm", "2", "A", "normal saline|ns|saline bag", "Isotonic crystalloid replacement solution warmed to 37.0°C", 3.0),
            ("Lactated Ringer's 1000mL Bag", "IV Fluids", prefix, "Fluid Warm", "2", "B", "lactated ringers|lr|hartmanns solution", "Balanced crystalloid solution preferred for burn and trauma resuscitation", 3.0),
            ("SonoSite X-Porte Ultrasound System", "Imaging", prefix, "Ultrasound", "1", "A", "ultrasound|sonosite|fast scan machine", "Point-of-care ultrasound with C60 curvilinear and HFL50 linear transducers", 3.0),
            ("Level 1 Fast-Flow Warmer H-1200", "Resuscitation", "Trauma Bay 2", "Cart R", "1", "A", "level 1|fluid warmer|rapid warmer", "Dry heat fluid warmer delivering 38°C normothermic fluids up to 30 L/hr", 3.0),
            ("SAM Splint 36in Malleable Foam", "Orthopedics", "Fracture Cart", "1", "A", "sam splint|foam splint|malleable splint", "Radiolucent structural aluminum foam splint for limb fracture immobilization", 3.0),
            ("Biacore Splinting Plaster 4x15in", "Orthopedics", "Fracture Cart", "2", "A", "plaster splint|casting plaster|ortho splint", "Fast-setting water-activated plaster for volar and posterior leg splints", 3.0),
            ("Castroviejo Eye Speculum", "Ophthalmology", "Eye Cart", "Drawer 1", "A", "eye speculum|lid retractor|eye clamp", "Self-retaining wire speculum for emergency lateral canthotomy", 3.0),
            ("Morgan Lens Sterile Eye Delivery Set", "Ophthalmology", "Eye Cart", "Drawer 2", "A", "morgan lens|eye wash lens|chemical burn lens", "Continuous ocular irrigation lens for caustic acid and alkali chemical exposures", 3.0),
            ("Tonopen XL Tonometer", "Ophthalmology", "Eye Cart", "Drawer 1", "B", "tonopen|intraocular pressure|iop pen", "Electronic handheld tonometer assessing acute angle closure glaucoma", 3.0),
            ("Wood's UV Lamp with Fluorescein", "Ophthalmology", "Eye Cart", "Top", "A", "woods lamp|fluorescein light|corneal abrasion light", "Ultraviolet light source detecting corneal abrasions and dendritic ulcers", 3.0),
        ]
    else:  # pacu
        items = [
            ("Trumpet Airway Kit (NPA 28Fr)", "Airway", prefix, "A", "1", "A", "nasal trumpet|npa|nasopharyngeal airway|trumpet airway kit", "Soft flexible airway lubricated with surgical jelly for somnolent patients", 3.0),
            ("Oropharyngeal Airway (Guedel) 90mm", "Airway", prefix, "A", "1", "B", "oral airway|opa|guedel airway", "Rigid bite block holding tongue forward; use only in unconscious patients", 3.0),
            ("Non-Rebreather Oxygen Mask Adult", "Respiratory", prefix, "A", "2", "A", "nrb|non-rebreather|high flow mask", "Mask with reservoir bag delivering 80-90% FiO2 at 15 L/min flow", 3.0),
            ("Optiflow High-Flow Nasal Cannula", "Respiratory", "Resp Bay", "1", "A", "optiflow|high flow nasal|hfnc cannula", "Soft contoured nasal prongs for heated humidified oxygen therapy", 3.0),
            ("Yankauer Suction Wand Assembly", "Airway", prefix, "Hook", "1", "A", "yankauer|oral suction|tonsil tip suction", "Rigid suction tip with 6ft non-conductive medical vacuum tubing", 3.0),
            ("Ambu Bag-Valve-Mask with PEEP", "Resuscitation", "Emerg Cart", "Top", "1", "ambu bag|peep bvm|resuscitation bag", "Manual resuscitator equipped with adjustable 0-20 cmH2O PEEP valve", 3.0),
            ("Succinylcholine 20mg/mL Syringe", "Emergency Meds", "Med Pyxis", "STAT", "1", "sux syringe|succinylcholine|laryngospasm drug", "Rapid-acting depolarizing paralytic for emergency post-extubation laryngospasm", 3.0),
            ("Atropine Sulfate 0.4mg/mL Vial", "Emergency Meds", "Med Pyxis", "STAT", "2", "atropine|anticholinergic|bradycardia drug", "Vagolytic agent for profound sinus bradycardia following reversal", 3.0),
            ("3M Bair Hugger Model 775 Unit", "Thermal Control", "Clean Core", "Bay 3", "1", "bair hugger unit|forced air warmer|patient warmer", "High-efficiency blower with temperature settings 32°C, 38°C, and 43°C", 3.0),
            ("Bair Hugger Full Body Blanket 30000", "Thermal Control", prefix, "B", "1", "A", "bair hugger blanket|warming blanket|full blanket", "Adult disposable full-body warming blanket with convective air channels", 3.0),
            ("Bair Hugger Lower Body Blanket 52500", "Thermal Control", prefix, "B", "1", "B", "lower body blanket|lap warming blanket|leg blanket", "Convective blanket designed for thoracic and abdominal surgical patients", 3.0),
            ("Nellcor OxiMax SpO2 Finger Sensor", "Monitoring", prefix, "B", "2", "A", "pulse oximeter|spo2 probe|finger probe", "Reusable adult photoelectric pulse oximetry clip sensor", 3.0),
            ("Welch Allyn DuraShock BP Cuff Large", "Monitoring", prefix, "B", "2", "B", "blood pressure cuff|bp cuff|large adult cuff", "Durable latex-free blood pressure cuff for arms 32-43 cm", 3.0),
            ("Dinamap Patient Monitor Cables", "Monitoring", prefix, "B", "2", "C", "ecg cables|monitor leadwires|telemetry wires", "3-lead shielded ECG cables with universal snap connectors", 3.0),
            ("Alaris Infusion Pump 8100 Channel", "Infusion", "Pump Core", "Rack 1", "1", "alaris pump|iv pump channel|infusion pump", "Modular IV pump channel with Guardrails software protection", 3.0),
            ("Alaris PCA Module 8120 Lockbox", "Infusion", "Pump Core", "Rack 2", "1", "pca pump|alaris pca|pain pump", "Patient-controlled analgesia module with dedicated security lock", 3.0),
            ("Sugammadex (Bridion) 200mg/2mL", "Reversal Agents", "Med Pyxis", "Reversal", "1", "bridion|sugammadex|rocuronium reversal|sugammadex reversal kit", "Modified gamma cyclodextrin reversing rocuronium and vecuronium neuromuscular block", 3.0),
            ("Neostigmine Methylsulfate 1mg/mL", "Reversal Agents", "Med Pyxis", "Reversal", "2", "neostigmine|prostigmin|acetylcholinesterase inhibitor", "Cholinesterase inhibitor; always co-administer with glycopyrrolate", 3.0),
            ("Glycopyrrolate (Robinul) 0.2mg/mL", "Reversal Agents", "Med Pyxis", "Reversal", "2", "glycopyrrolate|robinul|antimuscarinic", "Synthetic antimuscarinic preventing neostigmine-induced severe bradycardia", 3.0),
            ("Naloxone (Narcan) 0.4mg/mL Ampule", "Reversal Agents", "Med Pyxis", "STAT", "1", "narcan|naloxone|narcotic reversal", "Competitive pure opioid receptor antagonist for acute respiratory depression", 3.0),
            ("Flumazenil (Romazicon) 0.5mg/5mL", "Reversal Agents", "Med Pyxis", "STAT", "2", "flumazenil|romazicon|benzodiazepine reversal", "Specific antagonist for midazolam and other benzodiazepines", 3.0),
            ("Ondansetron (Zofran) 4mg/2mL Vial", "Antiemetics", "Med Pyxis", "Antiemetic", "1", "zofran|ondansetron|nausea drug", "5-HT3 receptor antagonist; administer slowly over 2 minutes", 3.0),
            ("Metoclopramide (Reglan) 10mg/2mL", "Antiemetics", "Med Pyxis", "Antiemetic", "2", "reglan|metoclopramide|prokinetic", "Dopamine antagonist antiemetic with upper gastrointestinal prokinetic properties", 3.0),
            ("Promethazine (Phenergan) 25mg/mL", "Antiemetics", "Med Pyxis", "Antiemetic", "3", "phenergan|promethazine|antihistamine antiemetic", "Phenothiazine antihistamine; deep IM preferred over IV to avoid tissue necrosis", 3.0),
            ("Dexamethasone (Decadron) 4mg/mL", "Antiemetics", "Med Pyxis", "Antiemetic", "4", "decadron|dexamethasone|corticosteroid antiemetic", "Corticosteroid providing prolonged antiemetic effect and reduced airway edema", 3.0),
            ("Hydromorphone (Dilaudid) 1mg/mL", "Analgesics", "Narcotic Vault", "Safe", "1", "dilaudid|hydromorphone|opioid", "Semisynthetic morphine derivative approximately 7x more potent than morphine", 3.0),
            ("Morphine Sulfate 4mg/mL Carpuject", "Analgesics", "Narcotic Vault", "Safe", "2", "morphine|morphine carpuject|opioid analgesic", "Standard opioid analgesic for acute post-operative visceral and bone pain", 3.0),
            ("Fentanyl 100mcg/2mL Ampule", "Analgesics", "Narcotic Vault", "Safe", "3", "fentanyl|sublimaze|short acting opioid", "Rapid-onset lipophilic opioid ideal for acute emergence incisional pain", 3.0),
            ("Ketorolac (Toradol) 30mg/mL Vial", "Analgesics", "Med Pyxis", "NSAID", "1", "toradol|ketorolac|iv nsaid", "Potent injectable NSAID; verify normal renal function and surgical hemostasis", 3.0),
            ("Acetaminophen (Ofirmev) 1000mg/100mL", "Analgesics", "Med Pyxis", "Non-Opioid", "1", "ofirmev|iv tylenol|iv acetaminophen", "Intravenous non-opioid analgesic; infuse over 15 minutes", 3.0),
            ("Meperidine (Demerol) 25mg/mL", "Analgesics", "Narcotic Vault", "Safe", "4", "demerol|meperidine|shivering drug", "Kappa-opioid agonist uniquely effective for treating post-anesthetic shivering", 3.0),
            ("Ultrasound Nerve Block Tray & Needles", "Regional Anesthesia", "Block Cart", "1", "A", "nerve block needle|echogenic needle|block needle|ultrasound nerve block tray", "Echogenic non-cutting needle for ultrasound-guided nerve block catheters", 3.0),
            ("0.5% Ropivacaine 100mL Infusion Bag", "Regional Anesthesia", "Block Cart", "2", "A", "ropivacaine|naropin|nerve block drug", "Long-acting amide local anesthetic with reduced cardiotoxicity", 3.0),
            ("On-Q PainBall 2mL/hr Elastomeric", "Regional Anesthesia", "Block Cart", "3", "A", "pain pump|on-q ball|elastomeric pump", "Non-electronic balloon pump for continuous post-op surgical site wound infiltration", 3.0),
            ("Jackson-Pratt 100mL Silicone Bulb", "Drainage", prefix, "C", "1", "A", "jp bulb|wound bulb|suction bulb", "Closed wound suction evacuator with built-in anti-reflux valve", 3.0),
            ("Jackson-Pratt 10mm Flat Drain", "Drainage", prefix, "C", "1", "B", "jp drain|flat drain|silicone drain", "Radiopaque flat silicone drain with multiple side perforations", 3.0),
            ("Hemovac 400mL Evacuator with Drain", "Drainage", prefix, "C", "1", "C", "hemovac|ortho drain|accordion drain", "Spring-activated high-volume closed suction system for orthopedic arthroplasty", 3.0),
            ("Foley Catheter 16Fr with Temp Sensor", "Urology", prefix, "C", "2", "A", "temp foley|temperature catheter|foley", "Dual-purpose Foley catheter measuring continuous bladder core temperature", 3.0),
            ("Bard StatLock Foley Stabilization Device", "Urology", prefix, "C", "2", "B", "statlock|foley anchor|catheter lock", "Adhesive leg anchor preventing urethral shear traction injuries", 3.0),
            ("Urimeter Drainage Bag 400mL", "Urology", prefix, "C", "2", "C", "urimeter|hourly urine bag|measuring foley bag", "Precision measuring chamber for accurate hourly urine output monitoring", 3.0),
            ("Benzoin Tincture Swabsticks", "Dressings", prefix, "C", "3", "A", "benzoin|skin adhesive|sticky swab", "Topical skin adherent promoting enhanced adhesion of Steri-Strips", 3.0),
            ("Steri-Strip 1/2in x 4in Closures", "Dressings", prefix, "C", "3", "B", "steri strips|wound strips|skin closures", "Reinforced porous non-woven skin closure tape strips", 3.0),
            ("Aquacel Ag Silver Ribbon Dressing", "Dressings", prefix, "C", "3", "C", "aquacel|silver dressing|antimicrobial ribbon", "Hydrofiber dressing with 1.2% ionic silver for surgical cavity packing", 3.0),
            ("Coban Self-Adherent Wrap 3in", "Dressings", prefix, "C", "4", "A", "coban|cohesive wrap|self sticking bandage", "Elastic cohesive bandage sticking only to itself, not to skin or hairs", 3.0),
            ("Ace Elastic Bandage 4in with Clips", "Dressings", prefix, "C", "4", "B", "ace wrap|compression wrap|elastic bandage", "Graduated compression wrap for extremity edema and splint securement", 3.0),
            ("Abdominal ABD Combine Pad 8x10in", "Dressings", prefix, "C", "4", "C", "abd pad|combine pad|large dressing", "Multi-layer thick absorbent pad for high-exudate surgical incision coverage", 3.0),
            ("Curaplex Emergency Eye Wash Bottle", "Safety", "Wall Station", "Eye", "1", "A", "eye wash|saline eye flush|emergency wash", "Sterile isotonic buffered solution for immediate ocular decontamination", 3.0),
            ("Sharps Container 5 Quart Wall Mount", "Safety", prefix, "Wall", "1", "A", "sharps box|needle box|biohazard container", "Puncture-resistant container with counterbalanced drop door for needle disposal", 3.0),
            ("Purell Advanced Gel Dispenser 1200mL", "Infection Control", prefix, "Entrance", "1", "A", "hand sanitizer|purell|foam dispenser", "70% ethyl alcohol hand sanitizer active against hospital pathogens", 3.0),
            ("BleedCEASE First Aid Clotting Gauze", "Hemostatics", prefix, "D", "1", "A", "nasal packing|epistaxis packing|hemostatic gauze", "Calcium alginate fiber dressing for fast control of mucosal bleeding", 3.0),
        ]

    for row in items:
        if len(row) == 9:
            item, cat, rm, cab, sh, cont, aliases, notes, score = row
        elif len(row) == 8:
            item, cat, rm, cab, sh, aliases, notes, score = row
            cont = "A"
        else:
            continue
        # build clean human alias
        h_alias = f"{rm} · Cart {cab} · Shelf {sh} · Bin {cont}"
        # escape notes
        esc_notes = f'"{notes}"' if (',' in notes or ';' in notes) else notes
        rows.append(f"{item},{cat},{rm},{cab},{sh},{cont},{aliases},,0,{esc_notes},{h_alias},{score},verified,2026-10-27T12:00:00Z")

    return "\n".join(rows) + "\n"

# ==============================================================================
# MASTER SEED EXECUTION
# ==============================================================================

def main():
    print("=" * 70)
    print("PHASE 30: SEEDING COMPREHENSIVE CLINICAL KNOWLEDGE PACKS (FICTIONAL HOSPITALS)")
    print("=" * 70)

    facilities = ["sacred_heart", "princeton_plainsboro", "county_general"]
    departments = ["or", "icu", "er", "pacu"]

    facility_titles = {
        "sacred_heart": "Sacred Heart Hospital",
        "princeton_plainsboro": "Princeton-Plainsboro Teaching Hospital",
        "county_general": "County General Hospital",
    }

    # 1. Write Tier 1 Handbooks
    for fac_id, handbook_content in FACILITY_HANDBOOKS.items():
        fac_dir = HOSPITALS_DIR / fac_id
        fac_dir.mkdir(parents=True, exist_ok=True)
        hb_file = fac_dir / "facility_handbook.md"
        hb_file.write_text(handbook_content.strip() + "\n", encoding="utf-8")
        print(f"✓ Tier 1 Handbook: {hb_file.relative_to(ROOT)} ({len(handbook_content)} chars)")

    # 2. Write Tier 2 Department Inventories & Preference Cards
    for fac_id in facilities:
        for dept_id in departments:
            dept_dir = HOSPITALS_DIR / fac_id / dept_id
            dept_dir.mkdir(parents=True, exist_ok=True)

            # A. Inventory CSV (50+ rows)
            inv_csv = generate_department_inventory(fac_id, dept_id)
            inv_file = dept_dir / "inventory.csv"
            inv_file.write_text(inv_csv, encoding="utf-8")
            line_count = len(inv_csv.strip().split("\n"))
            print(f"✓ Tier 2 Inventory: {inv_file.relative_to(ROOT)} ({line_count - 1} items)")

            # B. Preference Cards JSON
            cards_data = []
            if dept_id == "or":
                cards_data = OR_PREFERENCE_CARDS
            elif dept_id == "icu":
                cards_data = ICU_PREFERENCE_CARDS
            elif dept_id == "er":
                cards_data = ER_PREFERENCE_CARDS
            elif dept_id == "pacu":
                cards_data = PACU_PREFERENCE_CARDS

            cards_file = dept_dir / "preference_cards.json"
            cards_json = json.dumps(cards_data, indent=2) + "\n"
            cards_file.write_text(cards_json, encoding="utf-8")
            print(f"✓ Tier 2 Preference Cards: {cards_file.relative_to(ROOT)} ({len(cards_data)} procedures)")

    # 3. Write Tier 3 Role Guides
    for fac_id in facilities:
        # OR roles
        or_roles_dir = HOSPITALS_DIR / fac_id / "or" / "roles"
        or_roles_dir.mkdir(parents=True, exist_ok=True)
        for role_key in ["scrub", "circulator", "crna"]:
            role_file = or_roles_dir / f"{role_key}.md"
            role_file.write_text(ROLE_GUIDES[role_key].strip() + "\n", encoding="utf-8")
            print(f"[OK] Tier 3 OR Role: {role_file.relative_to(ROOT)} ({len(ROLE_GUIDES[role_key])} chars)")

        # ICU role
        icu_roles_dir = HOSPITALS_DIR / fac_id / "icu" / "roles"
        icu_roles_dir.mkdir(parents=True, exist_ok=True)
        (icu_roles_dir / "icu_rn.md").write_text(ROLE_GUIDES["icu_rn"].strip() + "\n", encoding="utf-8")
        print(f"[OK] Tier 3 ICU Role: {fac_id}/icu/roles/icu_rn.md")

        # ER role
        er_roles_dir = HOSPITALS_DIR / fac_id / "er" / "roles"
        er_roles_dir.mkdir(parents=True, exist_ok=True)
        (er_roles_dir / "er_rn.md").write_text(ROLE_GUIDES["er_rn"].strip() + "\n", encoding="utf-8")
        print(f"[OK] Tier 3 ER Role: {fac_id}/er/roles/er_rn.md")

        # PACU role
        pacu_roles_dir = HOSPITALS_DIR / fac_id / "pacu" / "roles"
        pacu_roles_dir.mkdir(parents=True, exist_ok=True)
        (pacu_roles_dir / "pacu_rn.md").write_text(ROLE_GUIDES["pacu_rn"].strip() + "\n", encoding="utf-8")
        print(f"[OK] Tier 3 PACU Role: {fac_id}/pacu/roles/pacu_rn.md")

    # Also synchronize root legacy / fallback departments for maximum compatibility
    sync_map = {
        "or_main": ("sacred_heart", "or"),
        "general_memorial_cvor": ("sacred_heart", "or"),
        "icu_critical_care": ("sacred_heart", "icu"),
        "er_trauma": ("sacred_heart", "er"),
        "pacu_periop": ("sacred_heart", "pacu"),
    }
    for root_dept, (src_fac, src_dept) in sync_map.items():
        target_dir = HOSPITALS_DIR / root_dept
        target_dir.mkdir(parents=True, exist_ok=True)
        src_dir = HOSPITALS_DIR / src_fac / src_dept
        
        # copy inventory.csv
        (target_dir / "inventory.csv").write_text((src_dir / "inventory.csv").read_text(encoding="utf-8"), encoding="utf-8")
        # copy preference_cards.json
        (target_dir / "preference_cards.json").write_text((src_dir / "preference_cards.json").read_text(encoding="utf-8"), encoding="utf-8")
        print(f"[OK] Synced root legacy department: hospitals/{root_dept}")

    # Synchronize legacy multi-tenant facility directories for full backward compatibility
    legacy_fac_map = {
        "general_memorial": "sacred_heart",
        "duke_regional": "princeton_plainsboro",
        "metro_medical": "county_general",
    }
    for old_fac, new_fac in legacy_fac_map.items():
        src_fac_dir = HOSPITALS_DIR / new_fac
        dst_fac_dir = HOSPITALS_DIR / old_fac
        dst_fac_dir.mkdir(parents=True, exist_ok=True)
        (dst_fac_dir / "facility_handbook.md").write_text((src_fac_dir / "facility_handbook.md").read_text(encoding="utf-8"), encoding="utf-8")
        for dept in ["or", "icu", "er", "pacu"]:
            dst_dept = dst_fac_dir / dept
            dst_dept.mkdir(parents=True, exist_ok=True)
            src_dept = src_fac_dir / dept
            (dst_dept / "inventory.csv").write_text((src_dept / "inventory.csv").read_text(encoding="utf-8"), encoding="utf-8")
            (dst_dept / "preference_cards.json").write_text((src_dept / "preference_cards.json").read_text(encoding="utf-8"), encoding="utf-8")
            dst_roles = dst_dept / "roles"
            dst_roles.mkdir(parents=True, exist_ok=True)
            for r_file in (src_dept / "roles").glob("*.md"):
                (dst_roles / r_file.name).write_text(r_file.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"[OK] Synced legacy facility alias: hospitals/{old_fac} -> {new_fac}")

    # 4. Generate Master hospitals/manifest.json
    print("\nRebuilding hospitals/manifest.json...")
    packs = []

    # A. Hospital Handbooks
    for fac_id in facilities:
        hb_path = HOSPITALS_DIR / fac_id / "facility_handbook.md"
        if hb_path.exists():
            content = hb_path.read_bytes()
            v_hash = hashlib.md5(content).hexdigest()[:12]
            fac_title = facility_titles.get(fac_id, fac_id.replace('_', ' ').title())
            title = f"{fac_title} — Facility Handbook & Emergency Policies"
            packs.append({
                "packId": f"{fac_id}::handbook",
                "facilityId": fac_id,
                "title": title,
                "category": "hospital",
                "filePath": f"hospitals/{fac_id}/facility_handbook.md",
                "sizeBytes": len(content),
                "versionHash": v_hash,
                "updatedAt": "2026-10-27"
            })

    # B. Department Preference Cards & Inventories
    for fac_id in facilities:
        fac_title = facility_titles.get(fac_id, fac_id.replace('_', ' ').title())
        for dept_id in departments:
            # Preference cards
            cards_path = HOSPITALS_DIR / fac_id / dept_id / "preference_cards.json"
            if cards_path.exists():
                content = cards_path.read_bytes()
                v_hash = hashlib.md5(content).hexdigest()[:12]
                title = f"{fac_title} ({dept_id.upper()}) — Clinical Preference Cards"
                packs.append({
                    "packId": f"{fac_id}::{dept_id}::preference_cards",
                    "facilityId": fac_id,
                    "departmentId": dept_id,
                    "title": title,
                    "category": "department",
                    "filePath": f"hospitals/{fac_id}/{dept_id}/preference_cards.json",
                    "sizeBytes": len(content),
                    "versionHash": v_hash,
                    "updatedAt": "2026-10-27"
                })

            # Inventory CSV
            inv_path = HOSPITALS_DIR / fac_id / dept_id / "inventory.csv"
            if inv_path.exists():
                content = inv_path.read_bytes()
                v_hash = hashlib.md5(content).hexdigest()[:12]
                title = f"{fac_title} ({dept_id.upper()}) — Master Inventory & Coordinates"
                packs.append({
                    "packId": f"{fac_id}::{dept_id}::inventory",
                    "facilityId": fac_id,
                    "departmentId": dept_id,
                    "title": title,
                    "category": "department",
                    "filePath": f"hospitals/{fac_id}/{dept_id}/inventory.csv",
                    "sizeBytes": len(content),
                    "versionHash": v_hash,
                    "updatedAt": "2026-10-27"
                })

    # C. Role Guides
    for fac_id in facilities:
        fac_title = facility_titles.get(fac_id, fac_id.replace('_', ' ').title())
        for role_key in ["scrub", "circulator", "crna"]:
            rg_path = HOSPITALS_DIR / fac_id / "or" / "roles" / f"{role_key}.md"
            if rg_path.exists():
                content = rg_path.read_bytes()
                v_hash = hashlib.md5(content).hexdigest()[:12]
                role_label = "Scrub Tech" if role_key == "scrub" else ("Circulating RN" if role_key == "circulator" else "CRNA & Anesthesia")
                title = f"{fac_title} (OR) — {role_label} — Case Setup & Protocols"
                packs.append({
                    "packId": f"{fac_id}::or::role_{role_key}",
                    "facilityId": fac_id,
                    "departmentId": "or",
                    "roleId": role_key,
                    "title": title,
                    "category": "role",
                    "filePath": f"hospitals/{fac_id}/or/roles/{role_key}.md",
                    "sizeBytes": len(content),
                    "versionHash": v_hash,
                    "updatedAt": "2026-10-27"
                })

        for dept_id, role_key, role_label in [
            ("icu", "icu_rn", "Critical Care RN"),
            ("er", "er_rn", "Emergency Trauma RN"),
            ("pacu", "pacu_rn", "PACU Recovery RN"),
        ]:
            rg_path = HOSPITALS_DIR / fac_id / dept_id / "roles" / f"{role_key}.md"
            if rg_path.exists():
                content = rg_path.read_bytes()
                v_hash = hashlib.md5(content).hexdigest()[:12]
                title = f"{fac_title} ({dept_id.upper()}) — {role_label} Protocols"
                packs.append({
                    "packId": f"{fac_id}::{dept_id}::role_{role_key}",
                    "facilityId": fac_id,
                    "departmentId": dept_id,
                    "roleId": role_key,
                    "title": title,
                    "category": "role",
                    "filePath": f"hospitals/{fac_id}/{dept_id}/roles/{role_key}.md",
                    "sizeBytes": len(content),
                    "versionHash": v_hash,
                    "updatedAt": "2026-10-27"
                })

    manifest = {
        "version": "1.1",
        "updatedAt": "2026-10-27",
        "repository": "kogeki88/or-nav",
        "rawBaseUrl": "https://raw.githubusercontent.com/kogeki88/or-nav/main",
        "packsCount": len(packs),
        "packs": packs
    }

    manifest_path = HOSPITALS_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"\n[OK] Successfully compiled hospitals/manifest.json with {len(packs)} verified knowledge packs!")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Sync master inventory CSVs and preference cards from hospitals/sacred_heart
to frontend/src/lib/seedData.ts, legacy hospital folders, and recalculate
hospitals/manifest.json MD5 checksums & byte sizes.
"""
import csv
import hashlib
import io
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOSPITALS_DIR = ROOT / "hospitals"
SEED_DATA_FILE = ROOT / "frontend" / "src" / "lib" / "seedData.ts"


def main():
    # 1. Propagate sacred_heart/or/preference_cards.json to princeton_plainsboro/or, county_general/or, and legacy folders
    sh_or_pref_path = HOSPITALS_DIR / "sacred_heart" / "or" / "preference_cards.json"
    for target_pref in [
        HOSPITALS_DIR / "princeton_plainsboro" / "or" / "preference_cards.json",
        HOSPITALS_DIR / "county_general" / "or" / "preference_cards.json",
        HOSPITALS_DIR / "or_main" / "preference_cards.json",
        HOSPITALS_DIR / "general_memorial_cvor" / "preference_cards.json",
    ]:
        if target_pref.parent.exists():
            shutil.copyfile(sh_or_pref_path, target_pref)

    for dept, legacy_dir in [
        ("icu", "icu_critical_care"),
        ("er", "er_trauma"),
        ("pacu", "pacu_periop"),
    ]:
        src_p = HOSPITALS_DIR / "sacred_heart" / dept / "preference_cards.json"
        dst_p = HOSPITALS_DIR / legacy_dir / "preference_cards.json"
        if src_p.exists() and dst_p.parent.exists():
            shutil.copyfile(src_p, dst_p)

    # 2. Recalculate hospitals/manifest.json sizes & MD5 hashes
    manifest_path = HOSPITALS_DIR / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for pack in manifest.get("packs", []):
            fp = ROOT / pack["filePath"]
            if fp.exists():
                raw_bytes = fp.read_bytes()
                pack["sizeBytes"] = len(raw_bytes)
                pack["versionHash"] = hashlib.md5(raw_bytes).hexdigest()[:12]
        manifest_text = json.dumps(manifest, indent=2) + "\n"
        manifest_path.write_text(manifest_text, encoding="utf-8")
        pub_manifest = ROOT / "frontend" / "public" / "hospitals" / "manifest.json"
        if pub_manifest.parent.exists():
            pub_manifest.write_text(manifest_text, encoding="utf-8")
        print("Updated hospitals/manifest.json checksums and byte sizes.")

    sh_or_csv = (HOSPITALS_DIR / "sacred_heart" / "or" / "inventory.csv").read_text(encoding="utf-8")
    sh_icu_csv = (HOSPITALS_DIR / "sacred_heart" / "icu" / "inventory.csv").read_text(encoding="utf-8")
    sh_er_csv = (HOSPITALS_DIR / "sacred_heart" / "er" / "inventory.csv").read_text(encoding="utf-8")
    sh_pacu_csv = (HOSPITALS_DIR / "sacred_heart" / "pacu" / "inventory.csv").read_text(encoding="utf-8")

    sh_pref_cards = json.loads((HOSPITALS_DIR / "sacred_heart" / "or" / "preference_cards.json").read_text(encoding="utf-8"))
    pp_pref_cards = json.loads((HOSPITALS_DIR / "princeton_plainsboro" / "or" / "preference_cards.json").read_text(encoding="utf-8"))
    cg_pref_cards = json.loads((HOSPITALS_DIR / "county_general" / "or" / "preference_cards.json").read_text(encoding="utf-8"))
    icu_pref_cards = json.loads((HOSPITALS_DIR / "sacred_heart" / "icu" / "preference_cards.json").read_text(encoding="utf-8"))
    er_pref_cards = json.loads((HOSPITALS_DIR / "sacred_heart" / "er" / "preference_cards.json").read_text(encoding="utf-8"))
    pacu_pref_cards = json.loads((HOSPITALS_DIR / "sacred_heart" / "pacu" / "preference_cards.json").read_text(encoding="utf-8"))

    pref_cards_dict = {
        "or_main": sh_pref_cards,
        "general_memorial_cvor": sh_pref_cards,
        "sacred_heart::or": sh_pref_cards,
        "princeton_plainsboro::or": pp_pref_cards,
        "county_general::or": cg_pref_cards,
        "icu_critical_care": icu_pref_cards,
        "sacred_heart::icu": icu_pref_cards,
        "princeton_plainsboro::icu": icu_pref_cards,
        "county_general::icu": icu_pref_cards,
        "er_trauma": er_pref_cards,
        "sacred_heart::er": er_pref_cards,
        "princeton_plainsboro::er": er_pref_cards,
        "county_general::er": er_pref_cards,
        "pacu_periop": pacu_pref_cards,
        "sacred_heart::pacu": pacu_pref_cards,
        "princeton_plainsboro::pacu": pacu_pref_cards,
        "county_general::pacu": pacu_pref_cards,
    }

    def parse_csv_items(csv_text: str):
        reader = csv.DictReader(io.StringIO(csv_text.strip()))
        items = []
        for r in reader:
            item_name = r.get("item", "").strip()
            if not item_name:
                continue
            rm = r.get("room", "")
            cab = r.get("cabinet", "")
            sh = r.get("shelf", "")
            cont = r.get("container", "")
            h_alias = r.get("human_alias", "") or f"{rm} · Cart {cab} · Shelf {sh} · Bin {cont}"
            items.append({
                "item": item_name,
                "category": r.get("category", ""),
                "room": rm,
                "cabinet": cab,
                "shelf": sh,
                "container": cont,
                "full_code": f"{rm} {cab} {sh} {cont}".strip(),
                "human_alias": h_alias,
                "aliases": r.get("aliases", ""),
                "pending_location": r.get("pending_location", ""),
                "verify_count": int(r.get("verify_count", 0) or 0),
                "surgeon_notes": r.get("surgeon_notes", ""),
                "verification_score": float(r.get("verification_score", 3.0) or 3.0),
                "status": r.get("status", "verified") or "verified",
                "last_verified_at": r.get("last_verified_at", "2026-10-27T12:00:00Z"),
            })
        return items

    or_items = parse_csv_items(sh_or_csv)
    icu_items = parse_csv_items(sh_icu_csv)
    er_items = parse_csv_items(sh_er_csv)
    pacu_items = parse_csv_items(sh_pacu_csv)

    print(f"Parsed items: OR={len(or_items)}, ICU={len(icu_items)}, ER={len(er_items)}, PACU={len(pacu_items)}")

    inventories_dict = {
        "or_main": sh_or_csv.strip(),
        "general_memorial_cvor": sh_or_csv.strip(),
        "sacred_heart::or": sh_or_csv.strip(),
        "princeton_plainsboro::or": sh_or_csv.strip(),
        "county_general::or": sh_or_csv.strip(),
        "icu_critical_care": sh_icu_csv.strip(),
        "sacred_heart::icu": sh_icu_csv.strip(),
        "princeton_plainsboro::icu": sh_icu_csv.strip(),
        "county_general::icu": sh_icu_csv.strip(),
        "er_trauma": sh_er_csv.strip(),
        "sacred_heart::er": sh_er_csv.strip(),
        "princeton_plainsboro::er": sh_er_csv.strip(),
        "county_general::er": sh_er_csv.strip(),
        "pacu_periop": sh_pacu_csv.strip(),
        "sacred_heart::pacu": sh_pacu_csv.strip(),
        "princeton_plainsboro::pacu": sh_pacu_csv.strip(),
        "county_general::pacu": sh_pacu_csv.strip(),
    }

    items_dict = {
        "or_main": or_items,
        "general_memorial_cvor": or_items,
        "sacred_heart::or": or_items,
        "princeton_plainsboro::or": or_items,
        "county_general::or": or_items,
        "icu_critical_care": icu_items,
        "sacred_heart::icu": icu_items,
        "princeton_plainsboro::icu": icu_items,
        "county_general::icu": icu_items,
        "er_trauma": er_items,
        "sacred_heart::er": er_items,
        "princeton_plainsboro::er": er_items,
        "county_general::er": er_items,
        "pacu_periop": pacu_items,
        "sacred_heart::pacu": pacu_items,
        "princeton_plainsboro::pacu": pacu_items,
        "county_general::pacu": pacu_items,
    }

    # Extract SEED_ORIENTATIONS and SEED_QUESTIONS from current seedData.ts
    head_ts = SEED_DATA_FILE.read_text(encoding="utf-8")
    import re
    orientations_match = re.search(r"export const SEED_ORIENTATIONS: Record<string, string> = ({[\s\S]+?});\n\nexport const SEED_QUESTIONS", head_ts)
    questions_match = re.search(r"export const SEED_QUESTIONS: Record<string, DepartmentQuestion\[\]> = ({[\s\S]+?});\n\nexport const SEED_ITEMS_BY_DEPT", head_ts)
    baseline_match = re.search(r"export const SEED_BASELINE_MD = ([\s\S]+?);\n\nexport const SEED_INVENTORIES", head_ts)

    orientations_block = orientations_match.group(1) if orientations_match else "{}"
    questions_block = questions_match.group(1) if questions_match else "{}"
    baseline_val = baseline_match.group(1) if baseline_match else '""'

    new_ts = f"""import type {{ CoordinateCardData, DepartmentQuestion }} from "./api";

export const DEFAULT_TENANT = "or_main";

export const SEED_BASELINE_MD = {baseline_val};

export const SEED_INVENTORIES: Record<string, string> = {json.dumps(inventories_dict, indent=2)};

export const SEED_ORIENTATIONS: Record<string, string> = {orientations_block};

export const SEED_QUESTIONS: Record<string, DepartmentQuestion[]> = {questions_block};

export const SEED_ITEMS_BY_DEPT: Record<string, CoordinateCardData[]> = {json.dumps(items_dict, indent=2)};

export const SEED_PREFERENCE_CARDS: Record<string, any[]> = {json.dumps(pref_cards_dict, indent=2)};

export const SEED_INVENTORY_CSV = SEED_INVENTORIES.or_main;
export const SEED_ORIENTATION_MD = SEED_ORIENTATIONS.or_main;
export const SEED_UNANSWERED_QUESTIONS = SEED_QUESTIONS.or_main;
export const SEED_INVENTORY_ITEMS = SEED_ITEMS_BY_DEPT.or_main;

export function getSeedInventoryCsv(tenantId?: string): string {{
  const key = tenantId && SEED_INVENTORIES[tenantId] ? tenantId : "or_main";
  return SEED_INVENTORIES[key] || SEED_INVENTORIES.or_main;
}}

export function getSeedOrientationMd(tenantId?: string): string {{
  const key = tenantId && SEED_ORIENTATIONS[tenantId] ? tenantId : "or_main";
  return SEED_ORIENTATIONS[key] || SEED_ORIENTATIONS.or_main;
}}

export function getSeedQuestions(tenantId?: string): DepartmentQuestion[] {{
  const key = tenantId && SEED_QUESTIONS[tenantId] ? tenantId : "or_main";
  return SEED_QUESTIONS[key] || SEED_QUESTIONS.or_main || [];
}}

export function getSeedInventoryItems(tenantId?: string): CoordinateCardData[] {{
  const key = tenantId && SEED_ITEMS_BY_DEPT[tenantId] ? tenantId : "or_main";
  return SEED_ITEMS_BY_DEPT[key] || SEED_ITEMS_BY_DEPT.or_main;
}}

export function getSeedPreferenceCards(tenantId?: string): any[] {{
  const key = tenantId && SEED_PREFERENCE_CARDS[tenantId] ? tenantId : "or_main";
  return SEED_PREFERENCE_CARDS[key] || SEED_PREFERENCE_CARDS.or_main || [];
}}
"""
    SEED_DATA_FILE.write_text(new_ts, encoding="utf-8")
    print(f"Successfully updated {SEED_DATA_FILE}!")


if __name__ == "__main__":
    main()

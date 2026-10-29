/**
 * OR-Nav Client-Side PHI Scrubber (TypeScript)
 *
 * Defense-in-depth: mirrors backend/app/scrubber.py regex patterns.
 * Runs in-browser BEFORE any fetch() call to the backend.
 * PHI never leaves the client if caught here.
 *
 * CVOR-SAFE: Does NOT redact suture sizes (3-0, 4-0), blade numbers (#10),
 * device sizes (32Fr), OR coordinates (OR 21 A 2 C), drug doses, or extensions.
 */

const REDACTION = "[REDACTED_PHI]";

// Public phone numbers that should NOT be redacted
const PUBLIC_PHONE_WHITELIST = new Set(["18006449737"]); // MHAUS MH Hotline

// Eponymous surgical instruments & anatomical terms named after physicians
const EPONYMOUS_INSTRUMENTS = new Set([
  "debakey", "mayo", "metzenbaum", "adson", "weitlaner", "castaneda",
  "satinsky", "cooley", "bookwalter", "fogarty", "babcock", "kocher",
  "allis", "senn", "army navy", "army-navy", "kelly", "crile",
  "richardson", "deaver", "heaney", "poole", "yankauer", "foerster",
  "halsted", "cushing", "gerald", "potts", "carmalt", "duval", "gelpi",
]);

interface ScrubResult {
  text: string;
  redactionCount: number;
}

// --- Pattern definitions ---

// MRN: "MRN 1234567", "MRN: 12345678", "MRN#1234567890", "M.R.N. 998877", "MRN# 12-34-56"
const MRN_PATTERN = /\bM\.?R\.?N\.?\s*[#:]?\s*\d{2,10}(?:[-.]\d{2,10})*\b/gi;

// SSN: 123-45-6789 or 123 45 6789
const SSN_PATTERN = /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g;

// DOB: "DOB 01/15/1980", "DOB: 1-15-1980", "date of birth 12/25/90", "born on March 4th 1982"
const DOB_PATTERN = /(?:DOB|date\s+of\s+birth|born\s+on)\s*[:\s]\s*(?:\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\s*\d{4})/gi;

// External phone: (555) 123-4567, 555-123-4567, 555.123.4567
// Does NOT match internal extensions like x4-25663
const PHONE_PATTERN = /(?<!\w)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?!\w)/g;

// Patient names: "patient John Smith", "patient named Sarah Connor", "pt Jane Doe", "pt. Mary Johnson", "patient Mary-Jane Parker"
const PATIENT_NAME_PATTERN = /\b(?:patient|pt\.?)\s+(?:named\s+|called\s+)?([A-Z][a-z]+(?:-[A-Z][a-z]+)?(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+(?:-[A-Z][a-z]+)?)/g;

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Scrub PHI from text before sending to the backend.
 *
 * @param text - Raw user input text
 * @returns ScrubResult with cleaned text and redaction count
 */
export function scrubPhi(text: string): ScrubResult {
  if (!text) {
    return { text: "", redactionCount: 0 };
  }

  let count = 0;
  let result = text;

  // Pass 1: MRN
  result = result.replace(MRN_PATTERN, () => {
    count++;
    return REDACTION;
  });

  // Pass 2: SSN
  result = result.replace(SSN_PATTERN, () => {
    count++;
    return REDACTION;
  });

  // Pass 3: DOB
  result = result.replace(DOB_PATTERN, () => {
    count++;
    return REDACTION;
  });

  // Pass 4: Phone numbers (with whitelist)
  result = result.replace(PHONE_PATTERN, (match) => {
    const digits = normalizePhone(match);
    if (PUBLIC_PHONE_WHITELIST.has(digits)) {
      return match; // Preserve public hotline numbers
    }
    count++;
    return REDACTION;
  });

  // Pass 5: Patient names (heuristic)
  const clinicalFalsePositives = new Set([
    "patient positioning",
    "patient transport",
    "patient draping",
    "patient education",
    "patient safety",
    "patient warming",
    "patient transfer",
    "patient identification",
  ]);

  result = result.replace(PATIENT_NAME_PATTERN, (fullMatch, name) => {
    const fullLower = fullMatch.toLowerCase();
    if (clinicalFalsePositives.has(fullLower)) {
      return fullMatch;
    }
    const nameLower = name.toLowerCase();
    for (const inst of EPONYMOUS_INSTRUMENTS) {
      if (nameLower.includes(inst)) {
        return fullMatch;
      }
    }
    if (/\b(?:dr\.?|doctor)\b/i.test(fullMatch)) {
      return fullMatch;
    }

    count++;
    const prefix = fullMatch.slice(0, fullMatch.indexOf(name));
    return prefix + REDACTION;
  });

  return { text: result, redactionCount: count };
}

export { REDACTION };
export type { ScrubResult };

/**
 * Direct Client-to-Gemini 2.5 Flash Serverless Gateway
 * Enables 100% standalone execution without PC/VPS server.
 */

import { scrubPhi } from "./scrubClient";
import { normalizeAcousticSpeech } from "./surgicalOntology";
import { SEED_ORIENTATION_MD, SEED_BASELINE_MD, getSeedOrientationMd } from "./seedData";
import { getDepartment, getActiveDepartmentId } from "./departments";
import { getUserProfile, getRoleScope, type UserProfile } from "./userProfile";
import type { ChatResponse } from "./api";

const GEMINI_REST_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export function getClientGeminiApiKey(): string | null {
  if (typeof window !== "undefined") {
    const customKey = localStorage.getItem("ornav_gemini_api_key");
    if (customKey && customKey.trim().length > 0) {
      return customKey.trim();
    }
  }
  return process.env.NEXT_PUBLIC_GEMINI_API_KEY || null;
}

export function setClientGeminiApiKey(apiKey: string): void {
  if (typeof window !== "undefined") {
    if (apiKey && apiKey.trim()) {
      localStorage.setItem("ornav_gemini_api_key", apiKey.trim());
    } else {
      localStorage.removeItem("ornav_gemini_api_key");
    }
  }
}

export function isGeminiDirectAvailable(): boolean {
  return !!getClientGeminiApiKey();
}

/**
 * Direct Audio Transcription via Gemini 2.5 Flash on-device REST API.
 * Converts recorded blob to base64, invokes Gemini with department-adapted prompt,
 * scrubs PHI, and frees memory immediately.
 */
export async function directTranscribeAudio(
  audioBlob: Blob,
  departmentId?: string
): Promise<string | null> {
  const apiKey = getClientGeminiApiKey();
  if (!apiKey) {
    throw new Error("No Gemini API key available for standalone audio transcription.");
  }

  const dept = getDepartment(departmentId || getActiveDepartmentId());

  const arrayBuffer = await audioBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Data = btoa(binary);

  const mimeType = audioBlob.type && audioBlob.type.includes("audio")
    ? audioBlob.type.split(";")[0]
    : "audio/webm";

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          {
            text:
              `You are an expert Operating Room and Surgical Scrub Nurse transcriber. Transcribe the spoken audio verbatim. Accurately identify surgical instruments, eponyms, sutures, and OR terminology: Adson, DeBakey, Gerald, Russian, Metzenbaum, Mayo, Iris, Tenotomy, Crile, Kelly, Pean, Kocher, Allis, Babcock, Mixter, Schnidt, Satinsky, Cooley, Mayo-Hegar, Crile-Wood, Ryder, Castroviejo, Army-Navy, Senn, Richardson, Deaver, Malleable, Weitlaner, Gelpi, Bookwalter, Omni-Tract, Balfour, Finochietto, Kerrison, Leksell, Cobb, Freer, Penfield, Kittner, Ray-Tec, Yankauer, Frazier, Poole, Prolene, Vicryl, Monocryl, Ethibond, Silk, Bovie, snaps, pickups, metz, peanut, etc. If the audio is silent, background static, empty, or incomprehensible noise, output strictly '[SILENCE]'. Output ONLY the verbatim transcription or '[SILENCE]'.`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 250,
    },
  };

  const response = await fetch(`${GEMINI_REST_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Direct Gemini transcription failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

  if (!rawText || rawText.toUpperCase().includes("[SILENCE]")) {
    return null;
  }

  // Client-side HIPAA PHI Scrub and Acoustic Normalization (preserving user slang)
  const { text: scrubbed } = scrubPhi(rawText);
  const normalized = normalizeAcousticSpeech(scrubbed);
  return normalized.trim() || null;
}

/**
 * Direct Gemini 2.5 Flash Tier-2 Protocol & Baseline RAG on-device.
 * Scoped hierarchically by Facility, Department, and Clinical Role.
 */
export async function directGeminiRAG(
  query: string,
  orientationText?: string,
  baselineText: string = SEED_BASELINE_MD,
  departmentId?: string,
  customProfile?: UserProfile
): Promise<ChatResponse> {
  const t0 = performance.now();
  const apiKey = getClientGeminiApiKey();
  const profile = customProfile || getUserProfile();
  const dept = getDepartment(departmentId || profile.departmentId || getActiveDepartmentId());
  const roleScope = getRoleScope(dept.id, profile.clinicalRole);
  const actualOrientation = orientationText || getSeedOrientationMd(dept.id);
  const facilityName = profile.facilityName || "General Memorial Hospital";

  if (!apiKey) {
    // Return baseline guidance if no live API key is set
    const elapsed = Math.max(1, Math.round(performance.now() - t0));
    return {
      reply_text: `📘 [Standard Clinical Reference]\n\n${facilityName} · ${dept.name} (${roleScope.name})\nProtocols & Orientation:\n${actualOrientation}\n\n(Tip: Enter a Gemini API key in System to activate live role-scoped generative clinical guidance).`,
      routing_tier: "TIER_2_GEMINI_RAG",
      scrubbed_query: query,
      phi_detected: false,
      latency_ms: elapsed,
      is_educational_baseline: true,
      coordinate_card: null,
      move_widget: null,
    };
  }

  const { text: scrubbedQuery, redactionCount } = scrubPhi(query);

  const systemInstruction = `You are OR-Nav, an expert clinical navigation assistant at ${facilityName} within the ${dept.name} department (${dept.rolePrompt}).
You are actively assisting a ${roleScope.name}.

ROLE PERSPECTIVE & SCOPE:
${roleScope.ragInstruction}
Focus: ${roleScope.focusSummary}

CLINICAL FORMATTING RULES:
1. Keep answers concise (under 4 sentences or bullet points), factual, and directly actionable for patient care.
2. Prioritize ${facilityName} ${dept.name} institutional guidelines, inventory, and equipment first.
3. Tailor procedural guidance to the clinician's role (${roleScope.name}).
4. Never include patient-identifying data.

### ${facilityName} - ${dept.name} Orientation & Protocols:
${actualOrientation}

### Global Clinical Standards (AORN / CNOR / CST / Emergency):
${baselineText}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: systemInstruction },
          { text: `Nurse Query: ${scrubbedQuery}` },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 600,
    },
  };

  const response = await fetch(`${GEMINI_REST_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const elapsed = Math.max(1, Math.round(performance.now() - t0));

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Direct Gemini RAG failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "No response generated.";

  return {
    reply_text: reply,
    routing_tier: "TIER_2_GEMINI_RAG",
    scrubbed_query: scrubbedQuery,
    phi_detected: redactionCount > 0,
    latency_ms: elapsed,
    is_educational_baseline: false,
    coordinate_card: null,
    move_widget: null,
  };
}

/**
 * OR-Nav API Client & Typed Interface Contracts
 *
 * Centralized backend communication. All outbound text is scrubbed
 * client-side before transmission (defense-in-depth).
 * Includes Layer-1 Offline PWA Tier-0 fallback via Dexie.js (`offlineDb.ts`).
 */

import { scrubPhi } from "./scrubClient";
import { searchOfflineTier0 } from "./offlineDb";

// Single-port relative path by default so Next.js proxies to backend without CORS or port 8000 mobile issues
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export interface CoordinateCardData {
  item: string;
  room: string;
  cabinet: string;
  shelf: string;
  container: string;
  full_code: string;
  human_alias?: string;
  aliases?: string;
  category: string;
  surgeon_notes: string;
  pending_location: string;
  verify_count: number;
  verification_score?: number;
  status?: "verified" | "provisional" | "needs_reverification" | string;
  last_verified_at?: string;
  phonetic_code?: string;
  match_stage?: string;
  surgeon_filter?: string | null;
  highlighted_surgeon_note?: string | null;
}

export interface MoveWidgetData {
  item: string;
  new_location: string;
  verify_count: number;
  committed: boolean;
}

export interface ChatResponse {
  scrubbed_query: string;
  phi_detected: boolean;
  routing_tier: "TIER_1_LOCAL_CSV" | "TIER_2_GEMINI_RAG" | "MOVE_REPORTED";
  latency_ms: number;
  is_educational_baseline?: boolean;
  reply_text: string;
  coordinate_card: CoordinateCardData | null;
  coordinate_cards?: CoordinateCardData[];
  move_widget: MoveWidgetData | null;
}

export interface VerifyMoveResponse {
  item: string;
  new_location?: string;
  full_code?: string;
  pending_location?: string;
  verify_count: number;
  committed: boolean;
  superseded?: boolean;
  reply_text: string;
  coordinate_card?: CoordinateCardData;
}

export interface IngestResponse {
  file_type: "csv" | "md" | "markdown";
  rows_loaded?: number;
  characters_loaded?: number;
  message?: string;
}

export interface TenantsResponse {
  tenants: string[];
  default: string;
}

export interface VoiceStatusResponse {
  livekit_configured: boolean;
  livekit_url: string | null;
  mode: "LIVEKIT_WEBRTC" | "BROWSER_WEB_SPEECH";
}

export interface VoiceTokenResponse {
  token: string;
  room_name: string;
  livekit_url: string;
  tenant_id: string;
}

export interface NetworkInfoResponse {
  lan_ip: string;
  mobile_url: string;
  lan_url?: string;
  https_url?: string | null;
  https_active?: boolean;
}

export interface GeminiStatusResponse {
  configured: boolean;
  masked_key: string | null;
  model: string;
}

export interface QuestionAnswerItem {
  id: string;
  responder_role: string;
  answer_text: string;
  confidence: "confident" | "tentative_unsure";
  created_at: string;
}

export interface DepartmentQuestion {
  id: string;
  hospital_id: string;
  question_text: string;
  asked_by_role: string;
  status: "open" | "answered_tentative" | "answered_confident" | "verified";
  created_at: string;
  verified_at: string | null;
  answers: QuestionAnswerItem[];
}

export interface QuestionsListResponse {
  tenant_id: string;
  open_count: number;
  questions: DepartmentQuestion[];
}

/**
 * Fetch current Gemini 2.5 Flash API key status.
 */
export async function fetchGeminiStatus(): Promise<GeminiStatusResponse> {
  const res = await fetch(`${API_BASE}/api/config/gemini-status`);
  if (!res.ok) throw new Error(`Failed to fetch Gemini status: ${res.status}`);
  return res.json();
}

/**
 * Save and hot-reload Gemini API key in backend/.env.
 */
export async function saveGeminiKey(apiKey: string): Promise<GeminiStatusResponse> {
  const res = await fetch(`${API_BASE}/api/config/gemini-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Failed to save Gemini key (${res.status}): ${err}`);
  }
  return res.json();
}

/**
 * Fetch local LAN IPv4 network info for mobile QR pairing.
 */
export async function fetchNetworkInfo(): Promise<NetworkInfoResponse> {
  const res = await fetch(`${API_BASE}/api/network-info`);
  if (!res.ok) throw new Error(`Failed to check network info: ${res.status}`);
  return res.json();
}

/**
 * Fetch LiveKit Voice Server Status.
 */
export async function fetchVoiceStatus(): Promise<VoiceStatusResponse> {
  const res = await fetch(`${API_BASE}/api/voice/status`);
  if (!res.ok) throw new Error(`Failed to check voice status: ${res.status}`);
  return res.json();
}

/**
 * Mint a JWT Access Token for joining LiveKit CVOR WebRTC Room.
 */
export async function fetchVoiceToken(
  tenantId: string,
  participantName: string = "cvor_clinician"
): Promise<VoiceTokenResponse> {
  const res = await fetch(`${API_BASE}/api/voice/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_id: tenantId,
      participant_name: participantName,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Failed to mint voice token (${res.status}): ${err}`);
  }
  return res.json();
}

/**
 * Fetch available hospital tenants from the backend.
 */
export async function fetchTenants(): Promise<TenantsResponse> {
  const res = await fetch(`${API_BASE}/api/tenants`);
  if (!res.ok) throw new Error(`Failed to load tenants: ${res.status}`);
  return res.json();
}

/**
 * Send a chat message to the backend.
 * Runs client-side PHI scrubber before sending, and falls back to Tier-0
 * local IndexedDB (`offlineDb.ts`) if the browser is offline.
 */
export async function sendChatMessage(
  message: string,
  tenantId: string,
  signal?: AbortSignal
): Promise<{ response: ChatResponse; clientPhiRedacted: boolean; clientScrubbedText: string }> {
  const { text: clientScrubbedText, redactionCount } = scrubPhi(message);
  const clientPhiRedacted = redactionCount > 0;

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        message: clientScrubbedText,
        tenant_id: tenantId,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new Error(`Chat request failed (${res.status}): ${errorBody}`);
    }

    const response: ChatResponse = await res.json();
    return { response, clientPhiRedacted, clientScrubbedText };
  } catch (err) {
    if (signal?.aborted) {
      throw err;
    }
    // Layer 1 Offline PWA Fallback: Try Tier-0 IndexedDB lookup in <5ms
    const t0 = performance.now();
    const offlineCard = await searchOfflineTier0(clientScrubbedText, tenantId);
    if (offlineCard) {
      const elapsed = Math.max(1, Math.round(performance.now() - t0));
      return {
        clientPhiRedacted,
        clientScrubbedText,
        response: {
          scrubbed_query: clientScrubbedText,
          phi_detected: clientPhiRedacted,
          routing_tier: "TIER_1_LOCAL_CSV",
          latency_ms: elapsed,
          reply_text: `${offlineCard.item} is in ${offlineCard.room}, Cabinet ${offlineCard.cabinet}, Shelf ${offlineCard.shelf}, Bin ${offlineCard.container}. (Offline Cache)`,
          coordinate_card: offlineCard,
          move_widget: null,
        },
      };
    }
    throw err;
  }
}

/**
 * Confirm / verify a pending item relocation (+1).
 * Vector 3: Passes expectedLocation to guard against split-brain confirmations.
 */
export async function verifyMove(
  tenantId: string,
  item: string,
  expectedLocation?: string
): Promise<VerifyMoveResponse> {
  const res = await fetch(`${API_BASE}/api/inventory/verify-move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_id: tenantId,
      item,
      expected_location: expectedLocation,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(`Verify move failed (${res.status}): ${errorBody}`);
  }

  return res.json();
}

/**
 * Flag an item location as empty, moved, or needing re-verification.
 */
export async function flagItemWrong(
  tenantId: string,
  item: string,
  reason: string = "Flagged empty or moved by clinician"
): Promise<CoordinateCardData> {
  const res = await fetch(`${API_BASE}/api/inventory/flag-wrong`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_id: tenantId,
      item,
      reason,
    }),
  });
  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(`Flag item failed (${res.status}): ${errorBody}`);
  }
  return res.json();
}

/**
 * Fetch department unanswered & tentative questions.
 */
export async function fetchQuestions(tenantId: string): Promise<QuestionsListResponse> {
  const res = await fetch(
    `${API_BASE}/api/questions?tenant_id=${encodeURIComponent(tenantId)}`
  );
  if (!res.ok) throw new Error(`Failed to fetch questions: ${res.status}`);
  return res.json();
}

/**
 * Create a new unanswered orientee question.
 */
export async function createQuestion(
  tenantId: string,
  questionText: string,
  askedByRole: string = "CVOR Orientee RN"
): Promise<DepartmentQuestion> {
  const res = await fetch(`${API_BASE}/api/questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_id: tenantId,
      question_text: questionText,
      asked_by_role: askedByRole,
    }),
  });
  if (!res.ok) throw new Error(`Failed to create question: ${res.status}`);
  return res.json();
}

/**
 * Submit a peer answer ('confident' | 'tentative_unsure') or promote to 'verified'.
 */
export async function answerQuestion(
  tenantId: string,
  questionId: string,
  options: {
    answerText?: string;
    confidence?: "confident" | "tentative_unsure" | "verified";
    responderRole?: string;
    promoteToVerified?: boolean;
  }
): Promise<DepartmentQuestion> {
  const res = await fetch(`${API_BASE}/api/questions/${encodeURIComponent(questionId)}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_id: tenantId,
      answer_text: options.answerText,
      confidence: options.confidence || "confident",
      responder_role: options.responderRole || "CVOR Peer RN",
      promote_to_verified: Boolean(options.promoteToVerified),
    }),
  });
  if (!res.ok) throw new Error(`Failed to answer question: ${res.status}`);
  return res.json();
}

export interface VoiceQueryResponse extends Partial<ChatResponse> {
  safe_transcript: string;
  silence: boolean;
}

/**
 * Upload an in-RAM recorded audio blob (MediaRecorder or mobile capture)
 * to POST /api/v1/voice-query (powered by faster-whisper / Gemini 2.5 Flash Audio).
 * Returns `{ silence: true, safe_transcript: "" }` when no speech is detected.
 */
export async function sendVoiceAudioQuery(
  audioBlob: Blob | File,
  tenantId: string
): Promise<VoiceQueryResponse> {
  const formData = new FormData();
  const filename =
    audioBlob instanceof File
      ? audioBlob.name
      : audioBlob.type.includes("mp4")
      ? "ptt_clip.mp4"
      : audioBlob.type.includes("wav")
      ? "ptt_clip.wav"
      : "ptt_clip.webm";

  formData.append("file", audioBlob, filename);
  formData.append("tenant_id", tenantId);

  const res = await fetch(`${API_BASE}/api/v1/voice-query`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(`Voice audio query failed (${res.status}): ${errorBody}`);
  }

  return res.json();
}

/**
 * Upload an inventory CSV or orientation MD file to update the tenant's knowledge base.
 */
export async function ingestFile(tenantId: string, file: File): Promise<IngestResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("tenant_id", tenantId);

  const res = await fetch(`${API_BASE}/api/ingest`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(`Ingest failed (${res.status}): ${errorBody}`);
  }

  return res.json();
}

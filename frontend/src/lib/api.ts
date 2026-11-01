/**
 * OR-Nav API Client & Typed Interface Contracts
 *
 * Centralized backend communication. All outbound text is scrubbed
 * client-side before transmission (defense-in-depth).
 * Includes Layer-1 Offline PWA Tier-0 fallback via Dexie.js (`offlineDb.ts`).
 */

import { scrubPhi } from "./scrubClient";
import {
  searchOfflineTier0,
  fetchQuestionsOffline,
  createQuestionOffline,
  answerQuestionOffline,
} from "./offlineDb";
import {
  executeStandaloneSearch,
  verifyMoveStandalone,
  flagWrongStandalone,
} from "./standaloneEngine";
import {
  directTranscribeAudio,
  getClientGeminiApiKey,
  setClientGeminiApiKey,
} from "./directGemini";

// Single-port relative path by default so Next.js proxies to backend without CORS or port 8000 mobile issues
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" && (window.location.port === "3000" || window.location.hostname === "localhost")
    ? "http://localhost:8000"
    : "");

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface CoordinateCardData {
  item: string;
  user_preferred_term?: string;
  facility_aliases?: string[];
  facility_name?: string;
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
  current_location?: string;
  required_count?: number;
}

export interface QuickAddWidgetData {
  item: string;
  suggested_location?: string;
  notes?: string;
  category?: string;
}

export interface ChatResponse {
  scrubbed_query: string;
  phi_detected: boolean;
  routing_tier: "TIER_1_LOCAL_CSV" | "TIER_2_GEMINI_RAG" | "MOVE_REPORTED" | "RBAC_RESTRICTED";
  latency_ms: number;
  is_educational_baseline?: boolean;
  reply_text: string;
  coordinate_card: CoordinateCardData | null;
  coordinate_cards?: CoordinateCardData[];
  move_widget: MoveWidgetData | null;
  spoken_transcript_correction?: string;
  disambiguation_chips?: string[];
  quick_add_widget?: QuickAddWidgetData | null;
  implicit_learn_prompt?: {
    slang_term: string;
    canonical_item: string;
    facility_id?: string;
    department_id?: string;
    message: string;
  } | null;
  teaching_card?: {
    slang: string;
    canonical: string;
    facility: string;
    xp_awarded: number;
  } | null;
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
  try {
    const res = await fetch(`${API_BASE}/api/config/gemini-status`);
    if (res.ok) return (await res.json()) as GeminiStatusResponse;
  } catch {}
  const clientKey = getClientGeminiApiKey();
  return {
    configured: !!clientKey,
    masked_key: clientKey ? `${clientKey.slice(0, 6)}...${clientKey.slice(-4)}` : null,
    model: "gemini-2.5-flash (Standalone Serverless)",
  };
}

/**
 * Save and hot-reload Gemini API key in local storage & backend/.env if available.
 */
export async function saveGeminiKey(apiKey: string): Promise<GeminiStatusResponse> {
  setClientGeminiApiKey(apiKey);
  try {
    const res = await fetch(`${API_BASE}/api/config/gemini-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (res.ok) return (await res.json()) as GeminiStatusResponse;
  } catch {}
  const key = apiKey.trim();
  return {
    configured: !!key,
    masked_key: key ? `${key.slice(0, 6)}...${key.slice(-4)}` : null,
    model: "gemini-2.5-flash (Standalone Serverless)",
  };
}

/**
 * Fetch local LAN IPv4 network info for mobile QR pairing.
 */
export async function fetchNetworkInfo(): Promise<NetworkInfoResponse> {
  const res = await fetch(`${API_BASE}/api/network-info`);
  if (!res.ok) throw new ApiError(res.status, `Failed to check network info: ${res.status}`);
  return (await res.json()) as NetworkInfoResponse;
}

/**
 * Fetch LiveKit Voice Server Status.
 */
export async function fetchVoiceStatus(): Promise<VoiceStatusResponse> {
  const res = await fetch(`${API_BASE}/api/voice/status`);
  if (!res.ok) throw new ApiError(res.status, `Failed to check voice status: ${res.status}`);
  return (await res.json()) as VoiceStatusResponse;
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
    throw new ApiError(res.status, `Failed to mint voice token (${res.status}): ${err}`);
  }
  return (await res.json()) as VoiceTokenResponse;
}

/**
 * Fetch available hospital tenants from the backend.
 */
export async function fetchTenants(): Promise<TenantsResponse> {
  const res = await fetch(`${API_BASE}/api/tenants`);
  if (!res.ok) throw new ApiError(res.status, `Failed to load tenants: ${res.status}`);
  return (await res.json()) as TenantsResponse;
}

/**
 * Send a chat message to the backend.
 * Runs client-side PHI scrubber before sending, and falls back to
 * on-device standaloneEngine (IndexedDB + Direct Gemini 2.5 Flash) if server is offline.
 */
export async function sendChatMessage(
  message: string,
  tenantId: string,
  signal?: AbortSignal,
  userProfile?: import("./userProfile").UserProfile
): Promise<{ response: ChatResponse; clientPhiRedacted: boolean; clientScrubbedText: string }> {
  const { text: clientScrubbedText, redactionCount } = scrubPhi(message);
  const clientPhiRedacted = redactionCount > 0;
  const profile = userProfile || (await import("./userProfile")).getUserProfile();

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        message: clientScrubbedText,
        tenant_id: tenantId,
        facility_name: profile.facilityName,
        clinical_role: profile.clinicalRole,
      }),
    });

    if (res.ok) {
      const response = (await res.json()) as ChatResponse;
      return { response, clientPhiRedacted, clientScrubbedText };
    }
  } catch (err) {
    if (signal?.aborted) throw err;
  }

  // Pure Zero-Server Standalone On-Device Fallback (Phase 21 & 27)
  try {
    const response = await executeStandaloneSearch(clientScrubbedText, tenantId, profile);
    return { response, clientPhiRedacted, clientScrubbedText };
  } catch {
    // Ultimate fallback to basic Tier-0
    const offlineCard = await searchOfflineTier0(clientScrubbedText, tenantId);
    if (offlineCard) {
      return {
        clientPhiRedacted,
        clientScrubbedText,
        response: {
          scrubbed_query: clientScrubbedText,
          phi_detected: clientPhiRedacted,
          routing_tier: "TIER_1_LOCAL_CSV",
          latency_ms: 1,
          reply_text: `${offlineCard.item} is in ${offlineCard.room}, Cabinet ${offlineCard.cabinet}, Shelf ${offlineCard.shelf}, Bin ${offlineCard.container}. (Offline Standalone)`,
          coordinate_card: offlineCard,
          move_widget: null,
        },
      };
    }
    throw new Error("Unable to execute query in standalone offline mode.");
  }
}

/**
 * Add a new item to inventory via backend API or fallback to IndexedDB.
 */
export async function addInventoryItemApi(
  item: string,
  location: string,
  tenantId: string,
  category: string = "Supplies",
  surgeonNotes: string = ""
): Promise<CoordinateCardData> {
  const aliases: string[] = [];
  if (surgeonNotes) {
    const mAl = surgeonNotes.match(/(?:also\s+called|aka|alias)[:\s]+([^;\.]+)/i);
    if (mAl) {
      const parsedAl = mAl[1].trim();
      if (parsedAl) aliases.push(parsedAl);
    }
  }

  try {
    const res = await fetch(`${API_BASE}/api/inventory/add-item`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        item,
        location,
        category,
        surgeon_notes: surgeonNotes,
        learned_aliases: aliases,
      }),
    });
    if (res.ok) {
      return (await res.json()) as CoordinateCardData;
    }
  } catch {}

  const { addInventoryItemStandalone } = await import("./standaloneEngine");
  return addInventoryItemStandalone(item, location, tenantId, category, surgeonNotes, aliases.join("|"));
}

/**
 * Confirm / verify a pending item relocation (+1).
 * Falls back to standalone on-device IndexedDB governance if server is offline.
 */
export async function verifyMove(
  tenantId: string,
  item: string,
  expectedLocation?: string
): Promise<VerifyMoveResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/inventory/verify-move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        item,
        expected_location: expectedLocation,
      }),
    });

    if (res.ok) {
      return (await res.json()) as VerifyMoveResponse;
    }
  } catch {}

  // Pure Zero-Server Standalone On-Device Relocation (Phase 21)
  return await verifyMoveStandalone(item, expectedLocation, tenantId);
}

/**
 * Flag an item location as empty, moved, or needing re-verification.
 * Falls back to standalone on-device IndexedDB governance if server is offline.
 */
export async function flagItemWrong(
  tenantId: string,
  item: string,
  reason: string = "Flagged empty or moved by clinician"
): Promise<CoordinateCardData> {
  try {
    const res = await fetch(`${API_BASE}/api/inventory/flag-wrong`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        item,
        reason,
      }),
    });
    if (res.ok) {
      return (await res.json()) as CoordinateCardData;
    }
  } catch {}

  // Pure Zero-Server Standalone On-Device Flagging (Phase 21)
  return await flagWrongStandalone(item, reason, tenantId);
}

/**
 * Fetch department unanswered & tentative questions.
 * Falls back to local IndexedDB store if server is offline.
 */
export async function fetchQuestions(tenantId: string): Promise<QuestionsListResponse> {
  try {
    const res = await fetch(
      `${API_BASE}/api/questions?tenant_id=${encodeURIComponent(tenantId)}`
    );
    if (res.ok) return (await res.json()) as QuestionsListResponse;
  } catch {}

  // Pure Zero-Server Standalone Questions Fallback (Phase 21)
  return await fetchQuestionsOffline(tenantId);
}

/**
 * Create a new unanswered orientee question.
 * Falls back to local IndexedDB store if server is offline.
 */
export async function createQuestion(
  tenantId: string,
  questionText: string,
  askedByRole: string = "Clinical Orientee RN"
): Promise<DepartmentQuestion> {
  try {
    const res = await fetch(`${API_BASE}/api/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        question_text: questionText,
        asked_by_role: askedByRole,
      }),
    });
    if (res.ok) return (await res.json()) as DepartmentQuestion;
  } catch {}

  // Pure Zero-Server Standalone Question Creation (Phase 21)
  return await createQuestionOffline(tenantId, questionText, askedByRole);
}

/**
 * Submit a peer answer ('confident' | 'tentative_unsure') or promote to 'verified'.
 * Falls back to local IndexedDB store if server is offline.
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
  try {
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
    if (res.ok) return (await res.json()) as DepartmentQuestion;
  } catch {}

  // Pure Zero-Server Standalone Question Answering (Phase 21)
  return await answerQuestionOffline(tenantId, questionId, options);
}

export interface VoiceQueryResponse extends Partial<ChatResponse> {
  safe_transcript: string;
  silence: boolean;
}

/**
 * Upload an in-RAM recorded audio blob (MediaRecorder or mobile capture).
 * When server is offline, runs direct on-device transcription via Gemini 2.5 Flash
 * and executes query through standaloneEngine.
 */
export async function sendVoiceAudioQuery(
  audioBlob: Blob | File,
  tenantId: string
): Promise<VoiceQueryResponse> {
  try {
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

    if (res.ok) {
      return (await res.json()) as VoiceQueryResponse;
    }
  } catch {}

  // Pure Zero-Server Direct Client Voice Processing (Phase 21 & Phase 22)
  try {
    const transcript = await directTranscribeAudio(audioBlob, tenantId);
    if (!transcript) {
      return { silence: true, safe_transcript: "" };
    }

    const chatResponse = await executeStandaloneSearch(transcript, tenantId);
    return {
      ...chatResponse,
      safe_transcript: transcript,
      silence: false,
    };
  } catch (err) {
    console.warn("Direct standalone voice query failed:", err);
    return { silence: true, safe_transcript: "" };
  }
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
    throw new ApiError(res.status, `Ingest failed (${res.status}): ${errorBody}`);
  }

  return (await res.json()) as IngestResponse;
}

/**
 * Fetch remote version manifest with robust fallback cascade for OTA update checking.
 */
export async function fetchVersionManifest(): Promise<import("./version").VersionManifest> {
  const { fetchRemoteVersionManifest } = await import("@/hooks/useAppUpdate");
  const res = await fetchRemoteVersionManifest();
  return res.manifest;
}

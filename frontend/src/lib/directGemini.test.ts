import { test, describe, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import 'fake-indexeddb/auto';
import {
  isGeminiDirectAvailable,
  getClientGeminiApiKey,
  setClientGeminiApiKey,
  directTranscribeAudio,
  directGeminiRAG
} from './directGemini';
import { sendVoiceAudioQuery } from './api';
import 'jsdom-global/register';

class LocalStorageMock {
  private store: Record<string, string> = {};
  getItem(key: string): string | null { return this.store[key] || null; }
  setItem(key: string, value: string): void { this.store[key] = value.toString(); }
  removeItem(key: string): void { delete this.store[key]; }
  clear(): void { this.store = {}; }
}

describe('directGemini', () => {
  let originalWindow: unknown;
  let originalFetch: unknown;
  let originalBtoa: unknown;

  beforeEach(() => {
    originalWindow = global.window;
    originalFetch = global.fetch;
    originalBtoa = global.btoa;

    const mockLocalStorage = new LocalStorageMock();
    (global as { window?: unknown }).window = {
      dispatchEvent: () => {},
    };
    (global as { localStorage?: unknown }).localStorage = mockLocalStorage;

    global.btoa = (str: string) => Buffer.from(str, 'binary').toString('base64');
  });

  afterEach(() => {
    (global as { window?: unknown }).window = originalWindow;
    if (originalWindow === undefined) {
      delete (global as { localStorage?: unknown }).localStorage;
    }
    global.fetch = originalFetch as typeof fetch;
    global.btoa = originalBtoa as typeof btoa;
  });

  test('getClientGeminiApiKey returns custom key from localStorage', () => {
    localStorage.setItem("ornav_gemini_api_key", "test-api-key");
    assert.strictEqual(getClientGeminiApiKey(), "test-api-key");
  });

  test('setClientGeminiApiKey sets and removes key from localStorage', () => {
    setClientGeminiApiKey("new-test-key");
    assert.strictEqual(localStorage.getItem("ornav_gemini_api_key"), "new-test-key");
    setClientGeminiApiKey("");
    assert.strictEqual(localStorage.getItem("ornav_gemini_api_key"), null);
  });

  test('isGeminiDirectAvailable returns true when key is present', () => {
    setClientGeminiApiKey("test-key");
    assert.strictEqual(isGeminiDirectAvailable(), true);
  });

  test('isGeminiDirectAvailable returns false when key is absent', () => {
    setClientGeminiApiKey("");
    assert.strictEqual(isGeminiDirectAvailable(), false);
  });

  test('directTranscribeAudio throws error when no API key is available', async () => {
    setClientGeminiApiKey("");
    const blob = new Blob(["test"], { type: "audio/webm" });
    await assert.rejects(
      () => directTranscribeAudio(blob),
      /No Gemini API key available for standalone audio transcription/
    );
  });

  test('directTranscribeAudio successfully transcribes audio', async () => {
    setClientGeminiApiKey("test-api-key");
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Hello world" }] } }]
      })
    } as unknown as Response);
    global.fetch = mockFetch;

    const blob = new Blob(["test"], { type: "audio/webm" });
    const result = await directTranscribeAudio(blob);
    assert.strictEqual(result, "Hello world");
  });

  test('directTranscribeAudio handles silence', async () => {
    setClientGeminiApiKey("test-api-key");
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "[SILENCE]" }] } }]
      })
    } as unknown as Response);
    global.fetch = mockFetch;

    const blob = new Blob(["test"], { type: "audio/webm" });
    const result = await directTranscribeAudio(blob);
    assert.strictEqual(result, null);
  });

  test('directGeminiRAG returns baseline when no API key is available', async () => {
    setClientGeminiApiKey("");
    const response = await directGeminiRAG("test query");
    assert.strictEqual(response.routing_tier, "TIER_2_GEMINI_RAG");
    assert.strictEqual(response.is_educational_baseline, true);
    assert.match(response.reply_text, /Standard Clinical Reference/);
  });

  test('directGeminiRAG queries Gemini successfully', async () => {
    setClientGeminiApiKey("test-api-key");
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Mocked Gemini Response" }] } }]
      })
    } as unknown as Response);
    global.fetch = mockFetch;

    const response = await directGeminiRAG("test query");
    assert.strictEqual(response.routing_tier, "TIER_2_GEMINI_RAG");
    assert.strictEqual(response.is_educational_baseline, false);
    assert.strictEqual(response.reply_text, "Mocked Gemini Response");
    assert.strictEqual(response.phi_detected, false);
  });

  test('sendVoiceAudioQuery falls back to direct Gemini API on LiveKit / backend failure', async () => {
    setClientGeminiApiKey("test-api-key");
    const calledEndpoints: string[] = [];

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      calledEndpoints.push(url);

      if (url.includes('/api/v1/voice-query')) {
        throw new TypeError('Failed to fetch');
      }

      if (url.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "Mocked fallback transcript" }] } }]
          }),
          text: async () => "{}",
        } as unknown as Response;
      }

      return { ok: true, json: async () => ({}) } as unknown as Response;
    };

    global.fetch = mockFetch;

    const blob = new Blob(["test audio"], { type: "audio/webm" });
    const response = await sendVoiceAudioQuery(blob, "tenant-123");

    assert.ok(calledEndpoints.some(e => e.includes('/api/v1/voice-query')), 'Should try backend first');
    assert.ok(calledEndpoints.some(e => e.includes('generativelanguage.googleapis.com')), 'Should fallback to direct Gemini API');

    assert.strictEqual(response.safe_transcript, "Mocked fallback transcript");
    assert.strictEqual(response.silence, false);
  });

  test('Multi-tenant isolation: directGeminiRAG yields different context for different departments', async () => {
    setClientGeminiApiKey("test-api-key");
    const capturedPayloads: any[] = [];

    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init && init.body) {
        capturedPayloads.push(JSON.parse(init.body as string));
      }
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "Mock response" }] } }]
        })
      } as unknown as Response;
    };

    await directGeminiRAG("query", undefined, undefined, "or_main");
    await directGeminiRAG("query", undefined, undefined, "icu_critical_care");

    assert.strictEqual(capturedPayloads.length, 2);

    const orPrompt = capturedPayloads[0].contents[0].parts[0].text;
    const icuPrompt = capturedPayloads[1].contents[0].parts[0].text;

    assert.match(orPrompt, /Operating Room \(OR\)/);
    assert.match(icuPrompt, /ICU \/ Critical Care/);
    assert.notStrictEqual(orPrompt, icuPrompt);
  });

  test('Offline-first invariant: directGeminiRAG throws when offline', async () => {
    setClientGeminiApiKey("test-key");

    global.fetch = async () => {
      throw new Error("Network offline");
    };

    await assert.rejects(
      () => directGeminiRAG("test query"),
      /Network offline/
    );
  });
});

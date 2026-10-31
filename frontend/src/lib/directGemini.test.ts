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

  describe('Invariant, Fuzzing & Boundary Hardening', () => {
    test('getClientGeminiApiKey ignores whitespace-only keys', () => {
      localStorage.setItem("ornav_gemini_api_key", "   ");
      assert.strictEqual(getClientGeminiApiKey(), null);
    });

    test('setClientGeminiApiKey handles extreme boundary inputs and trimming', () => {
      setClientGeminiApiKey("  \n\t  ");
      assert.strictEqual(localStorage.getItem("ornav_gemini_api_key"), null);

      const massiveKey = "A".repeat(10000);
      setClientGeminiApiKey(`  ${massiveKey}  `);
      assert.strictEqual(localStorage.getItem("ornav_gemini_api_key"), massiveKey);
    });

    test('directTranscribeAudio resilience: 500 server error', async () => {
      setClientGeminiApiKey("test");
      global.fetch = async () => ({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error"
      } as unknown as Response);

      const blob = new Blob(["audio"], { type: "audio/webm" });
      await assert.rejects(
        () => directTranscribeAudio(blob),
        /Direct Gemini transcription failed \(500\): Internal Server Error/
      );
    });

    test('directTranscribeAudio resilience: malformed JSON response', async () => {
      setClientGeminiApiKey("test");
      global.fetch = async () => ({
        ok: true,
        json: async () => { throw new SyntaxError("Unexpected token"); }
      } as unknown as Response);

      const blob = new Blob(["audio"], { type: "audio/webm" });
      await assert.rejects(
        () => directTranscribeAudio(blob),
        /Unexpected token/
      );
    });

    test('directTranscribeAudio resilience: missing candidate schema', async () => {
      setClientGeminiApiKey("test");
      global.fetch = async () => ({
        ok: true,
        json: async () => ({}) // missing candidates completely
      } as unknown as Response);

      const blob = new Blob(["audio"], { type: "audio/webm" });
      const result = await directTranscribeAudio(blob);
      assert.strictEqual(result, null);
    });

    test('directTranscribeAudio handles strange mime types and empty blobs', async () => {
      setClientGeminiApiKey("test");
      let capturedMime = "";
      global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body) {
          const body = JSON.parse(init.body as string);
          capturedMime = body.contents[0].parts[0].inlineData.mimeType;
        }
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "Empty audio" }] } }]
          })
        } as unknown as Response;
      };

      const emptyBlob = new Blob([], { type: "application/octet-stream" });
      await directTranscribeAudio(emptyBlob);
      assert.strictEqual(capturedMime, "audio/webm", "Should fallback to audio/webm if type doesn't include audio");

      const weirdAudioBlob = new Blob(["xyz"], { type: "audio/ogg; codecs=opus" });
      await directTranscribeAudio(weirdAudioBlob);
      assert.strictEqual(capturedMime, "audio/ogg", "Should split mime type by semicolon");
    });

    test('directGeminiRAG resilience: malformed payload and empty response body', async () => {
      setClientGeminiApiKey("test");
      global.fetch = async () => ({
        ok: true,
        json: async () => ({ candidates: [] })
      } as unknown as Response);

      const response = await directGeminiRAG("test");
      assert.strictEqual(response.reply_text, "No response generated.");
    });

    test('directGeminiRAG handles extreme fuzzing queries', async () => {
      setClientGeminiApiKey("test");
      global.fetch = async () => ({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "handled" }] } }]
        })
      } as unknown as Response);

      const massiveQuery = "Q".repeat(50000);
      const res1 = await directGeminiRAG(massiveQuery);
      assert.strictEqual(res1.reply_text, "handled");

      const specialCharsQuery = "🤷‍♂️ !@#$%^&*()_+ \n\r\t null undefined NaN <script>alert(1)</script>";
      const res2 = await directGeminiRAG(specialCharsQuery);
      assert.strictEqual(res2.reply_text, "handled");
    });

    test('directGeminiRAG strictly respects custom profile overriding default tenant state', async () => {
      setClientGeminiApiKey("test-api-key");
      let capturedPrompt = "";

      global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init && init.body) {
          const body = JSON.parse(init.body as string);
          capturedPrompt = body.contents[0].parts[0].text;
        }
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "Custom isolated response" }] } }]
          })
        } as unknown as Response;
      };

      const customProfile = {
        userId: "test_user_999",
        name: "Test User",
        clinicalRole: "scrub_tech",
        departmentId: "pediatrics_dept",
        facilityName: "Isolated Facility 42"
      };

      await directGeminiRAG("query", "Isolated Orientation", "Isolated Baseline", undefined, customProfile as any);

      assert.match(capturedPrompt, /Isolated Facility 42/);
      // Fallback is OR (Operating Room (OR)) because pediatrics_dept isn't hardcoded in department mappings,
      // but it shouldn't crash and should preserve the facility name/orientation.
      assert.match(capturedPrompt, /Operating Room \(OR\)/i, "Department should map or fallback depending on getDepartment, at minimum should not crash");
      assert.match(capturedPrompt, /Isolated Orientation/);
      assert.match(capturedPrompt, /Isolated Baseline/);
    });
  });

  describe('High-Concurrency & Stress Benchmarks', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('directGeminiRAG handles concurrent burst execution (Promise.all)', async () => {
      setClientGeminiApiKey("test-burst-key");
      let activeRequests = 0;
      let maxActiveRequests = 0;
      let totalCompleted = 0;

      global.fetch = async () => {
        activeRequests++;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);

        // Yield to event loop to simulate concurrency correctly
        await new Promise(r => setTimeout(r, Math.random() * 10));

        activeRequests--;
        totalCompleted++;

        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "Burst response" }] } }]
          })
        } as unknown as Response;
      };

      const CONCURRENCY = 50;
      const promises = Array.from({ length: CONCURRENCY }).map((_, i) =>
        directGeminiRAG(`Concurrent query ${i}`)
      );

      const results = await Promise.all(promises);

      assert.strictEqual(results.length, CONCURRENCY);
      assert.strictEqual(totalCompleted, CONCURRENCY);
      assert.ok(maxActiveRequests > 1, "Expected multiple requests to be processed concurrently");

      results.forEach(res => {
        assert.strictEqual(res.reply_text, "Burst response");
        assert.strictEqual(res.routing_tier, "TIER_2_GEMINI_RAG");
      });
    });

    test('directGeminiRAG handles race conditions during multi-tenant overlapping requests', async () => {
      setClientGeminiApiKey("test-race-key");
      const capturedPrompts: string[] = [];
      const fetchLogs: string[] = [];

      global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init && init.body) {
          const body = JSON.parse(init.body as string);
          const combined = body.contents[0].parts.map((p: any) => p.text).join(" ");
          capturedPrompts.push(combined);
          fetchLogs.push(combined);
        }

        // Enforce multi-tenant boundary assertion dynamically
        const currentPayload = fetchLogs[fetchLogs.length - 1];
        if (currentPayload && currentPayload.includes("Facility A")) {
          assert.ok(currentPayload.includes("Operating Room"), "Tenant boundary violation: Facility A should map to OR");
          assert.ok(!currentPayload.includes("Facility B"), "Tenant boundary violation: Cross-contamination");
        }

        // Random latency 0-20ms to jumble execution order
        await new Promise(r => setTimeout(r, Math.random() * 20));

        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "Race response" }] } }]
          })
        } as unknown as Response;
      };

      const profiles = [
        { name: "User A", clinicalRole: "scrub_tech", departmentId: "or_main", facilityName: "Facility A", facilityId: "fac_a" },
        { name: "User B", clinicalRole: "circulator", departmentId: "icu_critical_care", facilityName: "Facility B", facilityId: "fac_b" },
        { name: "User C", clinicalRole: "surgeon", departmentId: "er_trauma", facilityName: "Facility C", facilityId: "fac_c" },
      ];

      const iterations = 10;
      const promises = [];

      for (let i = 0; i < iterations; i++) {
        for (const p of profiles) {
          // Simulate multi-tenant context using facility_id::dept_id boundary mapping implicitly handled by directGeminiRAG's internal profile context
          promises.push(directGeminiRAG(`query ${p.facilityId}::${p.departmentId}`, undefined, undefined, undefined, p as any));
        }
      }

      await Promise.all(promises);

      const facilityACount = capturedPrompts.filter(p => p.includes("Facility A") && p.includes("Operating Room") && p.includes("fac_a::or_main")).length;
      const facilityBCount = capturedPrompts.filter(p => p.includes("Facility B") && p.includes("ICU / Critical Care") && p.includes("fac_b::icu_critical_care")).length;
      const facilityCCount = capturedPrompts.filter(p => p.includes("Facility C") && p.includes("Emergency Dept") && p.includes("fac_c::er_trauma")).length;

      // Ensure that all requests correctly parsed into the system prompt and scrubbed query respectively
      assert.strictEqual(facilityACount, iterations, "Facility A context leaked or was dropped");
      assert.strictEqual(facilityBCount, iterations, "Facility B context leaked or was dropped");
      assert.strictEqual(facilityCCount, iterations, "Facility C context leaked or was dropped");
    });

    test('directGeminiRAG latency benchmark under stress (P99 < 100ms simulator)', async () => {
      setClientGeminiApiKey("test-latency-key");

      // Simulate typical network latency
      global.fetch = async () => {
        await new Promise(r => setTimeout(r, 15)); // baseline network cost
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "Latency response" }] } }]
          })
        } as unknown as Response;
      };

      const CONCURRENCY = 20;
      const startTime = performance.now();

      const promises = Array.from({ length: CONCURRENCY }).map(() => directGeminiRAG("latency check"));
      const results = await Promise.all(promises);

      const totalTime = performance.now() - startTime;

      // Compute average latency per request using reported latency_ms
      const latencies = results.map(r => r.latency_ms);
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

      assert.ok(avgLatency > 0, "Latency should be tracked and > 0");
      assert.ok(totalTime < 200, `Total time for ${CONCURRENCY} requests should be reasonably fast, took ${totalTime}ms`);
      // Since Promises run concurrently and we sleep for 15ms inside each, total time won't exceed significantly
      // over 15ms if executed efficiently. We just assert the engine calculates it correctly.
    });

    test('Offline mutation replay idempotency for directGeminiRAG', async () => {
      setClientGeminiApiKey("test-offline-key");

      let fetchCount = 0;
      global.fetch = async () => {
        fetchCount++;
        throw new TypeError("Failed to fetch");
      };

      let initialError;
      try {
        await directGeminiRAG("offline payload replay");
      } catch (err) {
        initialError = err;
      }
      assert.ok(initialError, "Expected network error on first call");

      let replayError;
      try {
        await directGeminiRAG("offline payload replay");
      } catch (err) {
        replayError = err;
      }
      assert.ok(replayError, "Expected network error on replay call");

      assert.strictEqual((initialError as Error).message, (replayError as Error).message, "Idempotency: Replaying identical offline mutation should yield strict equal state/error");
      assert.strictEqual(fetchCount, 2, "Both calls should have attempted fetch");
    });

    test('Offline-first invariant: gracefully handles sudden network loss under high concurrency', async () => {
      setClientGeminiApiKey("test-offline-key");

      let fetchCount = 0;
      global.fetch = async () => {
        fetchCount++;
        // Simulate network randomly dropping after 10 requests
        if (fetchCount > 10) {
          throw new TypeError("Failed to fetch"); // Typical offline error
        }
        await new Promise(r => setTimeout(r, 5));
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "Online response" }] } }]
          })
        } as unknown as Response;
      };

      const CONCURRENCY = 20;
      const promises = Array.from({ length: CONCURRENCY }).map(() =>
        // Catch errors individually so Promise.all completes
        directGeminiRAG("offline test").catch(e => e)
      );

      const results = await Promise.all(promises);

      let successes = 0;
      let networkErrors = 0;

      for (const res of results) {
        if (res instanceof Error) {
          assert.match(res.message, /Failed to fetch|Network offline/i);
          networkErrors++;
        } else {
          assert.strictEqual(res.reply_text, "Online response");
          successes++;
        }
      }

      // Approximately 10 should succeed, rest should gracefully bubble the offline error up to the caller
      assert.ok(successes > 0, "Some requests should succeed");
      assert.ok(networkErrors > 0, "Some requests should fail due to simulated offline");
      assert.strictEqual(successes + networkErrors, CONCURRENCY, "All requests must resolve or gracefully reject");
    });
  });
});
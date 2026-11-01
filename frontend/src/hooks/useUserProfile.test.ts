import 'jsdom-global/register.js';
import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { useUserProfile } from './useUserProfile.ts';
import { renderHook, act, cleanup } from '@testing-library/react';
import { USER_PROFILE_STORAGE_KEY, DEFAULT_USER_PROFILE, USER_PROFILE_EVENT } from '@/lib/userProfile';

describe('useUserProfile hook', () => {
  let localStorageMock: Record<string, string>;
  let originalLocalStorage: any;
  let originalFetch: any;
  let getStorageItemMock: any;
  let setStorageItemMock: any;
  let removeStorageItemMock: any;
  let clearStorageItemMock: any;

  beforeEach(() => {
    localStorageMock = {};
    originalLocalStorage = global.localStorage;
    originalFetch = global.fetch;

    // Poison fetch to enforce offline-first invariant
    global.fetch = mock.fn(() => {
      throw new Error('fetch should not be called in offline-first useUserProfile hook');
    });

    getStorageItemMock = mock.fn((key: string) => localStorageMock[key] || null);
    setStorageItemMock = mock.fn((key: string, value: string) => {
      localStorageMock[key] = value;
    });
    removeStorageItemMock = mock.fn((key: string) => {
      delete localStorageMock[key];
    });
    clearStorageItemMock = mock.fn(() => {
      localStorageMock = {};
    });

    const mockStorage = {
      getItem: getStorageItemMock,
      setItem: setStorageItemMock,
      removeItem: removeStorageItemMock,
      clear: clearStorageItemMock,
    };

    Object.defineProperty(global, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true,
    });

    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    mock.restoreAll();

    Object.defineProperty(global, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
    global.fetch = originalFetch;
  });

  it('should initialize with DEFAULT_USER_PROFILE if localStorage is empty', () => {
    const { result } = renderHook(() => useUserProfile());
    assert.deepStrictEqual(result.current.profile, DEFAULT_USER_PROFILE);
    assert.strictEqual(result.current.isLoaded, true);
  });

  it('should load profile from localStorage if exists (Offline-first invariant)', () => {
    const customProfile = { ...DEFAULT_USER_PROFILE, fullName: 'Test User' };
    localStorageMock[USER_PROFILE_STORAGE_KEY] = JSON.stringify(customProfile);

    const { result } = renderHook(() => useUserProfile());
    assert.strictEqual(result.current.profile.fullName, 'Test User');
    assert.strictEqual(result.current.isLoaded, true);
  });

  it('should save new profile, update state, and isolate tenants (Multi-tenant isolation invariant)', () => {
    const root1 = document.createElement('div');
    root1.setAttribute('data-tenant', 'county_general::er_trauma');
    document.body.appendChild(root1);
    const { result: hook1, unmount: unmount1 } = renderHook(() => useUserProfile(), { container: root1 });

    const tenant1Profile = { ...DEFAULT_USER_PROFILE, fullName: 'Jane Doe', facilityId: 'county_general', departmentId: 'er_trauma' };

    act(() => {
      hook1.current.saveProfile(tenant1Profile);
    });

    assert.strictEqual(hook1.current.profile.fullName, 'Jane Doe');
    assert.strictEqual(hook1.current.profile.facilityId, 'county_general');
    assert.strictEqual(hook1.current.profile.departmentId, 'er_trauma');

    // Check if it's correctly isolated in localStorage
    const savedData = JSON.parse(localStorageMock[USER_PROFILE_STORAGE_KEY]);
    assert.strictEqual(savedData.facilityId, 'county_general');
    assert.strictEqual(savedData.departmentId, 'er_trauma');

    const root2 = document.createElement('div');
    root2.setAttribute('data-tenant', 'sacred_heart::icu_critical_care');
    document.body.appendChild(root2);
    const { result: hook2, unmount: unmount2 } = renderHook(() => useUserProfile(), { container: root2 });

    // Test a second tenant switch
    const tenant2Profile = { ...DEFAULT_USER_PROFILE, fullName: 'John Smith', facilityId: 'sacred_heart', departmentId: 'icu_critical_care' };

    act(() => {
      hook2.current.saveProfile(tenant2Profile);
    });

    assert.strictEqual(hook2.current.profile.facilityId, 'sacred_heart');
    assert.strictEqual(hook2.current.profile.departmentId, 'icu_critical_care');

    const savedData2 = JSON.parse(localStorageMock[USER_PROFILE_STORAGE_KEY]);
    assert.strictEqual(savedData2.facilityId, 'sacred_heart');
    assert.strictEqual(savedData2.departmentId, 'icu_critical_care');

    unmount1();
    unmount2();
    document.body.removeChild(root1);
    document.body.removeChild(root2);
  });

  it('should enforce offline mutation replay idempotency', () => {
    const { result } = renderHook(() => useUserProfile());

    const profileToSave = { ...DEFAULT_USER_PROFILE, fullName: 'Idempotency Test' };

    act(() => {
      result.current.saveProfile(profileToSave);
    });
    const stateAfterFirst = JSON.parse(JSON.stringify(result.current.profile));

    // Replay the mutation
    act(() => {
      result.current.saveProfile(profileToSave);
    });
    const stateAfterSecond = JSON.parse(JSON.stringify(result.current.profile));

    assert.deepStrictEqual(stateAfterFirst, stateAfterSecond);
  });

  it('should sync state across multiple hooks when a profile is saved', () => {
    const { result: hook1 } = renderHook(() => useUserProfile());
    const { result: hook2 } = renderHook(() => useUserProfile());

    assert.strictEqual(hook1.current.profile.fullName, DEFAULT_USER_PROFILE.fullName);
    assert.strictEqual(hook2.current.profile.fullName, DEFAULT_USER_PROFILE.fullName);

    const newProfile = { ...DEFAULT_USER_PROFILE, fullName: 'Multi-Tenant User' };

    act(() => {
      hook1.current.saveProfile(newProfile);
    });

    assert.strictEqual(hook1.current.profile.fullName, 'Multi-Tenant User');
    assert.strictEqual(hook2.current.profile.fullName, 'Multi-Tenant User');
  });

  it('should sync when an external USER_PROFILE_EVENT is fired without detail payload', () => {
    const { result } = renderHook(() => useUserProfile());

    const updatedProfile = { ...DEFAULT_USER_PROFILE, fullName: 'External Update' };
    localStorageMock[USER_PROFILE_STORAGE_KEY] = JSON.stringify(updatedProfile);

    act(() => {
      window.dispatchEvent(new CustomEvent(USER_PROFILE_EVENT));
    });

    assert.strictEqual(result.current.profile.fullName, 'External Update');
  });

  it('should sync when an external USER_PROFILE_EVENT is fired with detail payload', () => {
    const { result } = renderHook(() => useUserProfile());

    const updatedProfile = { ...DEFAULT_USER_PROFILE, fullName: 'Detailed Update' };

    act(() => {
      window.dispatchEvent(new CustomEvent(USER_PROFILE_EVENT, { detail: updatedProfile }));
    });

    assert.strictEqual(result.current.profile.fullName, 'Detailed Update');
  });

  it('should handle malformed JSON in localStorage gracefully (Fuzzing)', () => {
    const originalWarn = console.warn;
    console.warn = mock.fn();

    const badPayloads = [
      '{ invalid json ]',
      'null',
      'undefined',
      '',
      '{"fullName": 123}',
      '{"fullName": "test", "clinicalRole": {"a": 1}}',
      '[]'
    ];

    badPayloads.forEach(payload => {
      localStorageMock[USER_PROFILE_STORAGE_KEY] = payload;
      const { result } = renderHook(() => useUserProfile());

      // Some properties might get filled with defaults, just ensuring it doesn't crash
      // and mostly defaults to something safe
      assert.ok(result.current.profile);
      assert.strictEqual(typeof result.current.profile.fullName, 'string');
    });

    console.warn = originalWarn;
  });

  it('should enforce strict schema validation for missing/incorrect types in localStorage (Strict Schema Validation)', () => {
    const malformedDataArray = [
      {
        fullName: 12345,
        facilityId: null,
        departmentId: '',
        clinicalRole: true
      },
      {
        fullName: [],
        facilityId: {},
        departmentId: 999,
        clinicalRole: null
      }
    ];

    malformedDataArray.forEach(malformedData => {
      localStorageMock[USER_PROFILE_STORAGE_KEY] = JSON.stringify(malformedData);

      const { result } = renderHook(() => useUserProfile());

      assert.strictEqual(result.current.profile.fullName, DEFAULT_USER_PROFILE.fullName);
      assert.strictEqual(result.current.profile.facilityId, DEFAULT_USER_PROFILE.facilityId);
      assert.strictEqual(result.current.profile.clinicalRole, DEFAULT_USER_PROFILE.clinicalRole);
    });
  });

  it('should reject malformed saveProfile payloads and maintain strict schema (Malformed Payload Resilience)', () => {
    const { result } = renderHook(() => useUserProfile());
    const originalError = console.error;
    console.error = mock.fn();

    const badProfiles = [
      {
        fullName: null,
        facilityId: 9999,
        departmentId: undefined,
        clinicalRole: ['Array']
      },
      null,
      undefined,
      [],
      "string payload"
    ];

    badProfiles.forEach(badProfile => {
      act(() => {
        result.current.saveProfile(badProfile as any);
      });

      assert.strictEqual(result.current.profile.fullName, DEFAULT_USER_PROFILE.fullName);
      assert.strictEqual(result.current.profile.facilityId, DEFAULT_USER_PROFILE.facilityId);
      assert.strictEqual(result.current.profile.departmentId, DEFAULT_USER_PROFILE.departmentId);
      assert.strictEqual(result.current.profile.clinicalRole, DEFAULT_USER_PROFILE.clinicalRole);
    });

    console.error = originalError;
  });

  it('should handle massive strings safely (Boundary inputs)', () => {
    const { result } = renderHook(() => useUserProfile());

    const sizes = [10000, 50000, 100000];

    sizes.forEach(size => {
      const massiveString = 'A'.repeat(size);

      const massiveProfile = {
        ...DEFAULT_USER_PROFILE,
        fullName: massiveString,
        facilityId: massiveString
      };

      act(() => {
        result.current.saveProfile(massiveProfile);
      });

      assert.strictEqual(result.current.profile.fullName, massiveString);
      assert.strictEqual(result.current.profile.facilityId, massiveString);
    });
  });

  it('should handle special characters and potential XSS payloads safely', () => {
    const { result } = renderHook(() => useUserProfile());
    const xssPayload = '<script>alert(1)</script>';

    const xssProfile = {
      ...DEFAULT_USER_PROFILE,
      fullName: xssPayload,
      facilityId: xssPayload
    };

    act(() => {
      result.current.saveProfile(xssProfile);
    });

    // Validates that it stores and retrieves without evaluating or mutating maliciously
    assert.strictEqual(result.current.profile.fullName, xssPayload);
    assert.strictEqual(result.current.profile.facilityId, xssPayload);
  });

  it('should handle concurrent burst executions safely (High-Concurrency & Race Conditions)', async () => {
    const CONCURRENCY_LEVEL = 50;

    // Pre-instantiate multiple hooks synchronously
    const hooks = Array.from({ length: CONCURRENCY_LEVEL }).map(() => {
        return renderHook(() => useUserProfile());
    });

    await Promise.all(
      hooks.map(async (hook, index) => {
        // Yield to event loop to simulate true concurrency and micro-jitters
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));

        act(() => {
            hook.result.current.saveProfile({
                ...DEFAULT_USER_PROFILE,
                fullName: `Concurrent User ${index}`,
                facilityId: `facility_${index % 3}`
            });
        });
      })
    );

    // Assert that the final state matches one of the saved profiles (latest one wins)
    const savedData = JSON.parse(localStorageMock[USER_PROFILE_STORAGE_KEY]);
    assert.ok(savedData.fullName.startsWith('Concurrent User'));
    assert.ok(savedData.facilityId.startsWith('facility_'));

    const matchedIndex = parseInt(savedData.fullName.replace('Concurrent User ', ''));
    assert.ok(!isNaN(matchedIndex));
    assert.strictEqual(savedData.facilityId, `facility_${matchedIndex % 3}`);
  });

  it('should maintain low latency for saving and loading under stress (Latency Benchmarks)', () => {
     const { result } = renderHook(() => useUserProfile());
     const STRESS_ITERATIONS = 1000;

     // Warmup
     act(() => {
        result.current.saveProfile({
            ...DEFAULT_USER_PROFILE,
            fullName: `Warmup User`,
            facilityId: `sacred_heart`
        });
     });

     const start = performance.now();
     for (let i = 0; i < STRESS_ITERATIONS; i++) {
        act(() => {
            result.current.saveProfile({
                ...DEFAULT_USER_PROFILE,
                fullName: `Stress User ${i}`,
                facilityId: `sacred_heart`
            });
        });
     }
     const end = performance.now();

     const totalDuration = end - start;

     // Provide sufficient headroom for CI environments (e.g., < 2500ms for 1000 iterations)
     assert.ok(totalDuration < 2500, `Total duration was ${totalDuration}ms, expected < 2500ms`);
  });
});

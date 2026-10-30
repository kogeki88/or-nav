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
    const { result } = renderHook(() => useUserProfile());

    const tenant1Profile = { ...DEFAULT_USER_PROFILE, fullName: 'Jane Doe', facilityId: 'county_general', departmentId: 'er_trauma' };

    act(() => {
      result.current.saveProfile(tenant1Profile);
    });

    assert.strictEqual(result.current.profile.fullName, 'Jane Doe');
    assert.strictEqual(result.current.profile.facilityId, 'county_general');
    assert.strictEqual(result.current.profile.departmentId, 'er_trauma');

    // Check if it's correctly isolated in localStorage
    const savedData = JSON.parse(localStorageMock[USER_PROFILE_STORAGE_KEY]);
    assert.strictEqual(savedData.facilityId, 'county_general');
    assert.strictEqual(savedData.departmentId, 'er_trauma');

    // Test a second tenant switch
    const tenant2Profile = { ...DEFAULT_USER_PROFILE, fullName: 'John Smith', facilityId: 'sacred_heart', departmentId: 'icu_critical_care' };

    act(() => {
      result.current.saveProfile(tenant2Profile);
    });

    assert.strictEqual(result.current.profile.facilityId, 'sacred_heart');
    assert.strictEqual(result.current.profile.departmentId, 'icu_critical_care');

    const savedData2 = JSON.parse(localStorageMock[USER_PROFILE_STORAGE_KEY]);
    assert.strictEqual(savedData2.facilityId, 'sacred_heart');
    assert.strictEqual(savedData2.departmentId, 'icu_critical_care');
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
});

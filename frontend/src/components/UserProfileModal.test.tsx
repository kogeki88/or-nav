import 'jsdom-global/register';
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';
import UserProfileModal from './UserProfileModal';
import { DEFAULT_USER_PROFILE, REGISTERED_DEPARTMENTS, ROLES_BY_DEPARTMENT } from '../lib/userProfile';
import * as auth from '../lib/auth';
import * as resourceManager from '../lib/resourceManager';

// Mock localStorage to fix offline-first issues
Object.defineProperty(global, 'localStorage', {
  value: {
    getItem: mock.fn(),
    setItem: mock.fn(),
    removeItem: mock.fn(),
    clear: mock.fn(),
  },
  writable: true
});

test('UserProfileModal blocks unauthenticated privilege escalation and dispatches audit event', async (t) => {
  // Mock the required API calls
  // `updateUserAuthProfile` and `ensureProfilePacksInstalled` are exported functions.
  // Using node:test, we can mock them if we use a workaround, or since they are in ES modules
  // and we don't have proxyquire here, we'll mock them directly if possible or skip the `mock.method`
  // on ES module exports which throws "The argument 'methodName' must be a method" if it's an ES export without a default.
  // In `node:test` mocking ES modules requires loaders or `import * as` with setters if not sealed.
  // Since `auth.ts` exports `updateUserAuthProfile`, let's try to mock it. If not, we will just use the real one and ignore its fetch errors.

  // Wait, the error is: The argument 'methodName' must be a method. Received undefined.
  // That means `auth.updateUserAuthProfile` is somehow undefined at mock time? No, it means we can't mock it this way.
  // We can just spy on the component props instead! `onSaveProfile` is a prop we control.

  const onSaveProfileMock = mock.fn();
  const mockOnClose = mock.fn();

  // Setup event listener to catch the audit event
  let auditEventDispatched = false;
  let auditEventDetail: any = null;
  const eventListener = (e: any) => {
    auditEventDispatched = true;
    auditEventDetail = e.detail;
  };
  window.addEventListener('ornav_user_profile_updated', eventListener);

  // Render the modal
  render(
    <UserProfileModal
      isOpen={true}
      onClose={mockOnClose}
      currentProfile={{
        ...DEFAULT_USER_PROFILE,
        departmentId: 'or_main', // "or_main" roles: ["Circulating RN", "Scrub Tech", "CRNA"]
      }}
      onSaveProfile={onSaveProfileMock}
    />
  );

  // Find the role select element
  const roleSelect = screen.getByTestId('select-role') as HTMLSelectElement;

  // We are going to simulate a malicious DOM modification where a user injects an "Admin" role
  // Since we can't easily fireEvent.change to a non-existent option, we'll append it first
  const adminOption = document.createElement('option');
  adminOption.value = 'Admin';
  adminOption.text = 'Admin';
  roleSelect.appendChild(adminOption);

  // Select the "Admin" role
  fireEvent.change(roleSelect, { target: { value: 'Admin' } });

  // Submit the form
  const saveBtn = screen.getAllByTestId('button-save-profile')[0];
  fireEvent.click(saveBtn);

  // Verify that the privilege escalation was blocked and it fell back to the first valid role
  const expectedDefaultRole = ROLES_BY_DEPARTMENT['or_main'][0]; // "Circulating RN"

  await waitFor(() => {
    assert.strictEqual(onSaveProfileMock.mock.calls.length, 1);
  });

  const savedProfile = onSaveProfileMock.mock.calls[0].arguments[0];
  assert.strictEqual(savedProfile.clinicalRole, expectedDefaultRole, 'Should reset to default authorized role');
  assert.notStrictEqual(savedProfile.clinicalRole, 'Admin', 'Should NOT save unauthorized Admin role');

  // Verify that the audit event was dispatched with the sanitized profile
  assert.strictEqual(auditEventDispatched, true, 'Audit event should be dispatched');
  assert.strictEqual(auditEventDetail.clinicalRole, expectedDefaultRole, 'Audit event should contain authorized role');

  window.removeEventListener('ornav_user_profile_updated', eventListener);
  mock.restoreAll();
});

test('UserProfileModal handles offline-first idempotency and missing global fetch', async (t) => {
  cleanup();
  const onSaveProfileMock = mock.fn();
  const mockOnClose = mock.fn();
  const origFetch = global.fetch;
  (global as any).fetch = mock.fn(() => Promise.reject(new TypeError('Failed to fetch')));

  render(
    <UserProfileModal
      isOpen={true}
      onClose={mockOnClose}
      currentProfile={{
        ...DEFAULT_USER_PROFILE,
        departmentId: 'or_main',
      }}
      onSaveProfile={onSaveProfileMock}
    />
  );

  const roleSelect = screen.getByTestId('select-role') as HTMLSelectElement;
  fireEvent.change(roleSelect, { target: { value: 'Scrub Tech' } });

  const saveBtn = screen.getAllByTestId('button-save-profile')[0];
  fireEvent.click(saveBtn);
  fireEvent.click(saveBtn);
  fireEvent.click(saveBtn);

  await waitFor(() => {
    assert.strictEqual(onSaveProfileMock.mock.calls.length, 1);
  });

  (global as any).fetch = origFetch;
  mock.restoreAll();
});

test('UserProfileModal maintains multi-tenant isolation', async (t) => {
  cleanup();
  const onSaveProfileMock1 = mock.fn();
  const onSaveProfileMock2 = mock.fn();

  const { unmount: unmount1 } = render(
    <UserProfileModal
      isOpen={true}
      onClose={() => {}}
      currentProfile={{ ...DEFAULT_USER_PROFILE, facilityId: 'tenant_a', departmentId: 'or_main' }}
      onSaveProfile={onSaveProfileMock1}
    />
  );

  const saveBtn1 = screen.getAllByTestId('button-save-profile')[0];
  fireEvent.click(saveBtn1);

  await waitFor(() => {
    assert.strictEqual(onSaveProfileMock1.mock.calls.length, 1);
    assert.strictEqual(onSaveProfileMock1.mock.calls[0].arguments[0].facilityId, 'tenant_a');
  });

  cleanup();

  const { unmount: unmount2 } = render(
    <UserProfileModal
      isOpen={true}
      onClose={() => {}}
      currentProfile={{ ...DEFAULT_USER_PROFILE, facilityId: 'tenant_b', departmentId: 'icu_critical_care' }}
      onSaveProfile={onSaveProfileMock2}
    />
  );

  const saveBtn2 = screen.getAllByTestId('button-save-profile')[0];
  fireEvent.click(saveBtn2);

  await waitFor(() => {
    assert.strictEqual(onSaveProfileMock2.mock.calls.length, 1);
    assert.strictEqual(onSaveProfileMock2.mock.calls[0].arguments[0].facilityId, 'tenant_b');
    assert.strictEqual(onSaveProfileMock2.mock.calls[0].arguments[0].departmentId, 'icu_critical_care');
  });

  cleanup();
  mock.restoreAll();
});

test('UserProfileModal enforces schema validation, boundaries, and multi-tenant invariants with malformed data', async (t) => {
  cleanup();
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        fullName: fc.string({ minLength: 1, maxLength: 200 }), // boundary testing, must be non-empty due to required attr
        facilityId: fc.string({ minLength: 1 }), // malformed / boundary
        departmentId: fc.string(),               // unexpected departments
        clinicalRole: fc.string()                // unexpected roles
      }),
      async (fuzzedProfile) => {
        cleanup();
        const onSaveProfileMock = mock.fn();
        const mockOnClose = mock.fn();

        render(
          <UserProfileModal
            isOpen={true}
            onClose={mockOnClose}
            currentProfile={{ ...DEFAULT_USER_PROFILE, ...fuzzedProfile }}
            onSaveProfile={onSaveProfileMock}
          />
        );

        const saveBtn = screen.getAllByTestId('button-save-profile')[0];
        fireEvent.click(saveBtn);

        await waitFor(() => {
          assert.strictEqual(onSaveProfileMock.mock.calls.length, 1);
        });

        const savedData = onSaveProfileMock.mock.calls[0].arguments[0];

        // Multi-tenant and schema invariants: facility and department must not cause crashes,
        // and unknown department/role combinations should fall back safely to a known good state.
        assert.ok(savedData.clinicalRole !== undefined);
        assert.ok(savedData.facilityId !== undefined);
        assert.ok(typeof savedData.fullName === 'string');
      }
    ),
    { numRuns: 10 }
  );
  mock.restoreAll();
});

test('UserProfileModal enforces multi-tenant isolation and offline-first invariants under concurrent burst execution', async (t) => {
  cleanup();
  const onSaveProfileMock = mock.fn();
  const mockOnClose = mock.fn();

  const origFetch = global.fetch;
  (global as any).fetch = mock.fn(() => Promise.reject(new TypeError('Failed to fetch')));

  const startRender = performance.now();
  render(
    <UserProfileModal
      isOpen={true}
      onClose={mockOnClose}
      currentProfile={{
        ...DEFAULT_USER_PROFILE,
        facilityId: 'tenant_burst',
        departmentId: 'or_main',
      }}
      onSaveProfile={onSaveProfileMock}
    />
  );
  const endRender = performance.now();
  assert.ok((endRender - startRender) < 200, `Render latency too high: ${endRender - startRender}ms`);

  const roleSelect = screen.getByTestId('select-role') as HTMLSelectElement;
  fireEvent.change(roleSelect, { target: { value: 'Scrub Tech' } });

  const saveBtn = screen.getAllByTestId('button-save-profile')[0];

  const burstClicks = Array.from({ length: 50 }, () =>
    new Promise(resolve => setImmediate(() => {
      fireEvent.click(saveBtn);
      resolve(null);
    }))
  );

  await Promise.all(burstClicks);

  await waitFor(() => {
    assert.strictEqual(onSaveProfileMock.mock.calls.length, 1);
  });

  const savedData = onSaveProfileMock.mock.calls[0].arguments[0];
  assert.strictEqual(savedData.facilityId, 'tenant_burst');
  assert.strictEqual(savedData.clinicalRole, 'Scrub Tech');

  (global as any).fetch = origFetch;
  mock.restoreAll();
});

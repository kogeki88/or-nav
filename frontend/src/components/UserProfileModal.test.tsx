import 'jsdom-global/register';
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UserProfileModal from './UserProfileModal';
import { DEFAULT_USER_PROFILE, REGISTERED_DEPARTMENTS, ROLES_BY_DEPARTMENT } from '../lib/userProfile';
import * as auth from '../lib/auth';
import * as resourceManager from '../lib/resourceManager';

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
  const saveBtn = screen.getByTestId('button-save-profile');
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

import React from 'react';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResourceInspectorModal from './ResourceInspectorModal';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/offlineDb', () => ({
  offlineDb: {},
  getOfflineInventory: vi.fn(() => Promise.resolve([])),
  updateOfflineInventoryItem: vi.fn(),
  deleteOfflineInventoryItem: vi.fn(),
  createOfflineInventoryItem: vi.fn(),
  getOfflinePreferenceCards: vi.fn(() => Promise.resolve([])),
  saveOfflinePreferenceCard: vi.fn(),
  deleteOfflinePreferenceCard: vi.fn(),
  getOfflineLexiconAliases: vi.fn(() => Promise.resolve([])),
  saveOfflineLexiconAlias: vi.fn(),
  deleteOfflineLexiconAlias: vi.fn(),
  getOfflineDepartmentGuideline: vi.fn(() => Promise.resolve(null)),
  saveOfflineDepartmentGuideline: vi.fn(),
  exportTenantResourcesJson: vi.fn(),
  importTenantResourcesJson: vi.fn(),
  hydrateOrUpgradeOfflineInventory: vi.fn(),
}));

vi.mock('@/lib/userProfile', () => ({
  getUserProfile: vi.fn(() => ({
    facilityId: 'sacred_heart',
    departmentId: 'or_main'
  })),
}));

describe('ResourceInspectorModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('renders the modal when isOpen is true', async () => {
    await act(async () => {
      render(<ResourceInspectorModal isOpen={true} onClose={() => {}} />);
    });
    expect(screen.getByText(/Installed Resources Explorer & Studio/i)).toBeTruthy();
  });

  it('does not render when isOpen is false', () => {
    render(<ResourceInspectorModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText(/Installed Resources Explorer & Studio/i)).toBeNull();
  });

  it('calls onClose when close button is clicked', async () => {
    const handleClose = vi.fn();
    await act(async () => {
      render(<ResourceInspectorModal isOpen={true} onClose={handleClose} />);
    });

    const closeBtn = screen.getByTestId('btn-close-resource-inspector');
    await userEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalled();
  });

  it('verifies offline-first isolated queries for multi-tenant environment', async () => {
    const { getOfflineInventory } = await import('@/lib/offlineDb');
    await act(async () => {
      render(<ResourceInspectorModal isOpen={true} onClose={() => {}} />);
    });
    expect(getOfflineInventory).toHaveBeenCalledWith('sacred_heart::or_main');
  });
});

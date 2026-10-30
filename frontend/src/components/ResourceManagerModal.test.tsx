import 'jsdom-global/register';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const proxyquire = require('proxyquire');

const dummyProfile = {
  id: 'u1',
  fullName: 'Test Nurse',
  clinicalRole: 'Circulating RN',
  facilityId: 'facility-1',
  departmentId: 'dept-1'
};

const dummyManifest = {
  version: "1.1",
  updatedAt: "2024-01-01T00:00:00Z",
  repository: "kogeki88/or-nav",
  rawBaseUrl: "https://raw.githubusercontent.com/kogeki88/or-nav/main",
  packsCount: 1,
  packs: [
    {
      packId: "pack-1",
      facilityId: "facility-1",
      departmentId: "dept-1",
      title: "Test Pack 1",
      category: "department",
      filePath: "hospitals/facility-1/dept-1/inventory.csv",
      sizeBytes: 1024,
      versionHash: "hash123",
      updatedAt: "2024-01-01T00:00:00Z"
    }
  ]
};

const dummyInstalledPack = {
  packId: 'pack-1',
  facilityId: 'facility-1',
  departmentId: 'dept-1',
  roleId: undefined,
  title: 'Test Pack 1',
  category: 'department',
  filePath: 'hospitals/facility-1/dept-1/inventory.csv',
  sizeBytes: 1024,
  versionHash: 'hash123',
  installedAt: new Date().toISOString(),
  content: 'raw_content_here'
};

// Create mocks
const fetchPacksManifestMock = mock.fn(async () => dummyManifest);
const getInstalledPacksMock = mock.fn(async () => [dummyInstalledPack]);
const installPackMock = mock.fn(async () => dummyInstalledPack);
const deletePackMock = mock.fn(async () => {});
const purgeUnassignedHospitalPacksMock = mock.fn(async () => 0);
const getResourceStorageSummaryMock = mock.fn(async () => ({
  totalPacksCount: 1,
  totalSizeBytes: 1024,
  formattedSize: '1 KB'
}));
const getRequiredPacksForProfileMock = mock.fn(() => dummyManifest.packs);
const formatBytesMock = mock.fn(() => '1 KB');

// We use proxyquire for ResourceManagerModal, mocking its dependencies
const ResourceManagerModalMod = proxyquire('./ResourceManagerModal', {
    '@/lib/resourceManager': {
        fetchPacksManifest: fetchPacksManifestMock,
        getInstalledPacks: getInstalledPacksMock,
        installPack: installPackMock,
        deletePack: deletePackMock,
        purgeUnassignedHospitalPacks: purgeUnassignedHospitalPacksMock,
        getResourceStorageSummary: getResourceStorageSummaryMock,
        getRequiredPacksForProfile: getRequiredPacksForProfileMock,
        formatBytes: formatBytesMock,
    },
    '@/lib/gamification': {
        awardClinicalXP: mock.fn()
    },
    '@/lib/userProfile': {
        getUserProfile: mock.fn(() => dummyProfile)
    }
});

const ResourceManagerModal = ResourceManagerModalMod.default;

beforeEach(() => {
    fetchPacksManifestMock.mock.resetCalls();
    getInstalledPacksMock.mock.resetCalls();
    installPackMock.mock.resetCalls();
    deletePackMock.mock.resetCalls();
    purgeUnassignedHospitalPacksMock.mock.resetCalls();
    getResourceStorageSummaryMock.mock.resetCalls();
    getRequiredPacksForProfileMock.mock.resetCalls();
});

afterEach(() => {
  cleanup();
});

test('ResourceManagerModal renders correctly and displays installed packs', async () => {
    const onCloseMock = mock.fn();
    render(<ResourceManagerModal isOpen={true} onClose={onCloseMock} activeProfile={dummyProfile} />);

    // Check for title
    await waitFor(() => {
        assert.ok(screen.getByText('Installed Resources'));
    });

    // Check for the pack item
    await waitFor(() => {
        assert.ok(screen.getByTestId('pack-item-pack-1'));
    });

    // Check storage summary banner
    await waitFor(() => {
        assert.ok(screen.getByText('1 Packs Installed'));
    });
});

test('ResourceManagerModal handles install/update', async () => {
    const onCloseMock = mock.fn();
    render(<ResourceManagerModal isOpen={true} onClose={onCloseMock} activeProfile={dummyProfile} />);

    await waitFor(() => {
        assert.ok(screen.getByTestId('pack-item-pack-1'));
    });

    const updateBtn = screen.getByTitle('Reinstall / Update');
    fireEvent.click(updateBtn);

    await waitFor(() => {
        assert.strictEqual(installPackMock.mock.callCount(), 1);
    });
});

test('ResourceManagerModal handles sync all required', async () => {
    const onCloseMock = mock.fn();
    render(<ResourceManagerModal isOpen={true} onClose={onCloseMock} activeProfile={dummyProfile} />);

    await waitFor(() => {
        assert.ok(screen.getByTestId('pack-item-pack-1'));
    });

    const syncAllBtn = screen.getByText('Sync All Required');
    fireEvent.click(syncAllBtn);

    await waitFor(() => {
        assert.ok(installPackMock.mock.callCount() >= 1);
    });
});

test('ResourceManagerModal handles delete', async () => {
    const onCloseMock = mock.fn();
    render(<ResourceManagerModal isOpen={true} onClose={onCloseMock} activeProfile={dummyProfile} />);

    await waitFor(() => {
        assert.ok(screen.getByTestId('pack-item-pack-1'));
    });

    const deleteBtn = screen.getByTitle('Delete Pack');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
        assert.strictEqual(deletePackMock.mock.callCount(), 1);
        assert.strictEqual(deletePackMock.mock.calls[0].arguments[0], 'pack-1');
    });
});

test('ResourceManagerModal handles purge unassigned', async () => {
    const onCloseMock = mock.fn();
    // Use an unassigned installed pack to enable the button
    const unassignedPack = { ...dummyInstalledPack, packId: 'pack-2', facilityId: 'facility-2' };
    getInstalledPacksMock.mock.mockImplementation(async () => [dummyInstalledPack, unassignedPack]);

    render(<ResourceManagerModal isOpen={true} onClose={onCloseMock} activeProfile={dummyProfile} />);

    await waitFor(() => {
        assert.ok(screen.getByText('Other Cached Facility / Unit Packs (1)'));
    });

    const purgeBtn = screen.getByText('Purge Unassigned');
    fireEvent.click(purgeBtn);

    await waitFor(() => {
        assert.strictEqual(purgeUnassignedHospitalPacksMock.mock.callCount(), 1);
        assert.strictEqual(purgeUnassignedHospitalPacksMock.mock.calls[0].arguments[0], dummyProfile.facilityId);
    });
});

test('ResourceManagerModal correctly handles error during checksum verification or malformed schemas', async () => {
    const onCloseMock = mock.fn();

    installPackMock.mock.mockImplementation(async () => {
        throw new Error('Invalid JSON checksum in resource pack');
    });

    render(<ResourceManagerModal isOpen={true} onClose={onCloseMock} activeProfile={dummyProfile} />);

    await waitFor(() => {
        assert.ok(screen.getByTestId('pack-item-pack-1'));
    });

    const updateBtn = screen.getByTitle('Reinstall / Update');
    fireEvent.click(updateBtn);

    // Verify proper error banners display on malformed schemas / invalid checksums
    await waitFor(() => {
        assert.ok(screen.getByText('Error: Invalid JSON checksum in resource pack'));
    });
});

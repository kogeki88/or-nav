import "fake-indexeddb/auto";
import "jsdom-global/register.js";
import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";

// Mock localStorage globally before requiring modules
global.localStorage = {
  getItem: mock.fn(() => null),
  setItem: mock.fn(),
  removeItem: mock.fn(),
  clear: mock.fn(),
  length: 0,
  key: mock.fn(),
} as any;

import * as resourceManager from "./resourceManager";
import { offlineDb } from "./offlineDb";

describe("ResourceManagerChecksum", () => {
  beforeEach(async () => {
    if (offlineDb) {
      await offlineDb.installedPacks.clear();
      await offlineDb.inventoryItems.clear();
    }
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test("mapRoleToKey", () => {
    assert.strictEqual(resourceManager.mapRoleToKey("Circulator"), "circulator");
    assert.strictEqual(resourceManager.mapRoleToKey("Scrub Tech"), "scrub");
    assert.strictEqual(resourceManager.mapRoleToKey("CRNA"), "crna");
    assert.strictEqual(resourceManager.mapRoleToKey("ER Nurse"), "er_rn");
  });

  test("formatBytes", () => {
    assert.strictEqual(resourceManager.formatBytes(0), "0 B");
    assert.strictEqual(resourceManager.formatBytes(500), "500 B");
    assert.strictEqual(resourceManager.formatBytes(1024), "1.0 KB");
    assert.strictEqual(resourceManager.formatBytes(1024 * 1024), "1.0 MB");
  });

  test("installPack stores pack and hydrates inventory correctly with offline-first support", async () => {
    const csvContent = "item,room,cabinet,shelf,container,full_code,phonetic_code,surgeon_notes,category\nScalpel,Main OR,A,1,A,Main OR A 1 A,S K A L P E L,Sharp,instruments\n";
    mock.method(global, 'fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => csvContent
    }));

    const pack = await resourceManager.installPack({
      packId: "pack_1",
      facilityId: "fac1",
      departmentId: "or",
      title: "Test Pack",
      category: "department",
      filePath: "fac1/or/inventory.csv",
      sizeBytes: 100,
      versionHash: "v1",
      updatedAt: "2023-01-01T00:00:00Z",
    });

    assert.strictEqual(pack.packId, "pack_1");
    assert.strictEqual(pack.content, csvContent);
    assert.strictEqual(pack.versionHash, "v1");

    const installed = await resourceManager.getInstalledPacks();
    assert.strictEqual(installed.length, 1);
    assert.strictEqual(installed[0].packId, "pack_1");

    const items = await offlineDb?.inventoryItems.where("tenant_id").equals("fac1::or").toArray();
    assert.ok(items && items.length > 0);
    // Find Scalpel because offlineDb might be seeded with other items too
    const scalpel = items.find(i => i.item === "Scalpel");
    assert.ok(scalpel);
    assert.strictEqual(scalpel?.item, "Scalpel");
  });

  test("ensureProfilePacksInstalled handles offline-first operations", async () => {
    mock.method(global, 'fetch', async (url: string) => {
      if (url.includes("manifest.json")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            packs: [
              { packId: "handbook", facilityId: "fac1", category: "hospital", filePath: "handbook.md", versionHash: "v1" },
              { packId: "dept", facilityId: "fac1", departmentId: "or", category: "department", filePath: "inventory.csv", versionHash: "v1" }
            ]
          })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "item,room,cabinet,shelf,container,full_code\nScalpel,Main,A,1,A,Main A 1 A\n"
      };
    });

    const result = await resourceManager.ensureProfilePacksInstalled("fac1", "or", "circulator");
    assert.strictEqual(result.installedCount, 2);
    assert.strictEqual(result.updatedCount, 0);
    assert.strictEqual(result.errors.length, 0);

    const packs = await resourceManager.getInstalledPacks();
    assert.strictEqual(packs.length, 2);
  });

  test("ensureProfilePacksInstalled upgrades pack based on versionHash (ResourceManagerChecksum)", async () => {
    // Initial install
    mock.method(global, 'fetch', async (url: string) => {
      if (url.includes("manifest.json")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            packs: [
              { packId: "handbook", facilityId: "fac1", category: "hospital", filePath: "handbook.md", versionHash: "v1" }
            ]
          })
        };
      }
      return { ok: true, status: 200, text: async () => "v1 content" };
    });

    await resourceManager.ensureProfilePacksInstalled("fac1", "or", "circulator");

    let packs = await resourceManager.getInstalledPacks();
    assert.strictEqual(packs.length, 1);
    assert.strictEqual(packs[0].versionHash, "v1");
    assert.strictEqual(packs[0].content, "v1 content");

    mock.restoreAll();

    // Update install with v2
    mock.method(global, 'fetch', async (url: string) => {
      if (url.includes("manifest.json")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            packs: [
              { packId: "handbook", facilityId: "fac1", category: "hospital", filePath: "handbook.md", versionHash: "v2" }
            ]
          })
        };
      }
      return { ok: true, status: 200, text: async () => "v2 content" };
    });

    const result = await resourceManager.ensureProfilePacksInstalled("fac1", "or", "circulator");
    assert.strictEqual(result.updatedCount, 1);
    assert.strictEqual(result.installedCount, 0);

    packs = await resourceManager.getInstalledPacks();
    assert.strictEqual(packs.length, 1);
    assert.strictEqual(packs[0].versionHash, "v2");
    assert.strictEqual(packs[0].content, "v2 content");
  });

  test("ensureProfilePacksInstalled multi-tenant isolation invariant (ResourceManagerChecksum)", async () => {
    // Test that packs for fac1 don't overwrite fac2 and purging unassigned works
    mock.method(global, 'fetch', async (url: string) => {
      return {
        ok: true,
        status: 200,
        text: async () => "dummy content"
      };
    });

    await resourceManager.installPack({
      packId: "fac1_handbook",
      facilityId: "fac1",
      category: "hospital",
      title: "Fac1",
      filePath: "fac1.md",
      sizeBytes: 10,
      versionHash: "v1",
      updatedAt: "2023-01-01"
    });

    await resourceManager.installPack({
      packId: "fac2_handbook",
      facilityId: "fac2",
      category: "hospital",
      title: "Fac2",
      filePath: "fac2.md",
      sizeBytes: 10,
      versionHash: "v1",
      updatedAt: "2023-01-01"
    });

    let packs = await resourceManager.getInstalledPacks();
    assert.strictEqual(packs.length, 2);

    // Purge fac1, keeping fac2
    const purged = await resourceManager.purgeUnassignedHospitalPacks("fac2");
    assert.strictEqual(purged, 1);

    packs = await resourceManager.getInstalledPacks();
    assert.strictEqual(packs.length, 1);
    assert.strictEqual(packs[0].facilityId, "fac2");
  });

  test("getResourceStorageSummary calculates total size correctly", async () => {


    mock.method(global, 'fetch', async (url: string) => {
      return {
        ok: true,
        status: 200,
        text: async () => "dummy" // 5 bytes
      };
    });

    await resourceManager.installPack({
      packId: "pack_a", facilityId: "fac1", category: "hospital", title: "A", filePath: "a", sizeBytes: 1024, versionHash: "v1", updatedAt: "2023-01-01"
    });

    await resourceManager.installPack({
      packId: "pack_b", facilityId: "fac1", category: "hospital", title: "B", filePath: "b", sizeBytes: 2048, versionHash: "v1", updatedAt: "2023-01-01"
    });

    const summary = await resourceManager.getResourceStorageSummary();
    assert.strictEqual(summary.totalPacksCount, 2);
    assert.strictEqual(summary.totalSizeBytes, 10);
    assert.strictEqual(summary.formattedSize, "10 B");
  });

  test("downloadPackContent throws error when all candidate URLs fail", async () => {
    mock.method(global, 'fetch', async () => ({
      ok: false,
      status: 404,
      text: async () => ""
    }));

    await assert.rejects(
      resourceManager.downloadPackContent("some/file.md"),
      /Failed to download pack file: some\/file.md/
    );
  });

  test("downloadPackContent returns content on successful fetch", async () => {
    let callCount = 0;
    mock.method(global, 'fetch', async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 404, text: async () => "" };
      }
      return { ok: true, status: 200, text: async () => "success content" };
    });

    const content = await resourceManager.downloadPackContent("some/file.md");
    assert.strictEqual(content, "success content");
  });

  test("fetchPacksManifest returns parsed manifest", async () => {
    const mockManifest = { packs: [{ packId: "1", versionHash: "hash" }] };
    mock.method(global, 'fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockManifest)
    }));

    const manifest = await resourceManager.fetchPacksManifest();
    assert.deepStrictEqual(manifest, mockManifest);
  });

  test("fetchPacksManifest throws error when fetch fails", async () => {
    mock.method(global, 'fetch', async () => ({
      ok: false,
      status: 404,
      text: async () => ""
    }));

    await assert.rejects(
      resourceManager.fetchPacksManifest(),
      /Unable to fetch hospital knowledge packs manifest/
    );
  });

  test("deletePack removes pack and associated inventory items", async () => {
    mock.method(global, 'fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => "item,room,cabinet,shelf,container,full_code,phonetic_code,surgeon_notes,category\nTestItem,OR,A,1,A,OR A 1 A,T E S T,None,tools\n"
    }));

    await resourceManager.installPack({
      packId: "pack_to_delete",
      facilityId: "fac3",
      departmentId: "dept3",
      title: "Test Delete Pack",
      category: "department",
      filePath: "fac3/dept3/inventory.csv",
      sizeBytes: 100,
      versionHash: "v1",
      updatedAt: "2023-01-01T00:00:00Z",
    });

    let packs = await resourceManager.getInstalledPacks();
    assert.strictEqual(packs.find(p => p.packId === "pack_to_delete") !== undefined, true);

    let items = await offlineDb?.inventoryItems.where("tenant_id").equals("fac3::dept3").toArray();
    assert.ok(items && items.length > 0);

    // Delete the pack
    await resourceManager.deletePack("pack_to_delete");

    packs = await resourceManager.getInstalledPacks();
    assert.strictEqual(packs.find(p => p.packId === "pack_to_delete") === undefined, true);

    items = await offlineDb?.inventoryItems.where("tenant_id").equals("fac3::dept3").toArray();
    assert.strictEqual(items?.find(i => i.item === "TestItem") === undefined, true);
  });

  test("getRequiredPacksForProfile selects correct packs", () => {
    const manifest = {
      packs: [
        { packId: "hb", facilityId: "f1", category: "hospital", filePath: "a", versionHash: "1" },
        { packId: "d1", facilityId: "f1", departmentId: "or", category: "department", filePath: "b", versionHash: "1" },
        { packId: "r1", facilityId: "f1", departmentId: "or", roleId: "circulator", category: "role", filePath: "c", versionHash: "1" },
        { packId: "other", facilityId: "f2", category: "hospital", filePath: "d", versionHash: "1" }
      ]
    } as any;

    const required = resourceManager.getRequiredPacksForProfile(manifest, "f1", "or", "Circulator");
    assert.strictEqual(required.length, 3);
    const packIds = required.map(p => p.packId);
    assert.ok(packIds.includes("hb"));
    assert.ok(packIds.includes("d1"));
    assert.ok(packIds.includes("r1"));
  });

  test("unpackInstalledPacksToDexie returns hydrated count", async () => {
    const res = await resourceManager.unpackInstalledPacksToDexie("f99", "dept99");
    assert.strictEqual(typeof res, "number");
  });

  test("purgeUnassignedHospitalPacks keeps assigned and removes unassigned", async () => {
    mock.method(global, 'fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => "dummy content"
    }));

    await resourceManager.installPack({
      packId: "purge_fac1", facilityId: "keep_fac", category: "hospital", title: "K", filePath: "k", sizeBytes: 10, versionHash: "v1", updatedAt: "2023-01-01"
    });
    await resourceManager.installPack({
      packId: "purge_fac2", facilityId: "toss_fac", category: "hospital", title: "T", filePath: "t", sizeBytes: 10, versionHash: "v1", updatedAt: "2023-01-01"
    });

    const count = await resourceManager.purgeUnassignedHospitalPacks("keep_fac");
    assert.strictEqual(count, 1);

    const packs = await resourceManager.getInstalledPacks();
    assert.strictEqual(packs.length, 1);
    assert.strictEqual(packs[0].facilityId, "keep_fac");
  });
});

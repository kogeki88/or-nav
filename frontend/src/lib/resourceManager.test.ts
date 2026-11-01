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

  test("ResourceManagerChecksum high-concurrency burst execution and race condition resistance", async () => {
    // 1. Setup multi-tenant data
    const csvContentFac1 = "item,room,cabinet,shelf,container,full_code\nScalpel,Main OR,A,1,A,Main OR A 1 A\n";
    const csvContentFac2 = "item,room,cabinet,shelf,container,full_code\nForceps,ER,B,2,C,ER B 2 C\n";
    let fetchCount = 0;

    mock.method(global, 'fetch', async (url) => {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        text: async () => url.includes("fac2") ? csvContentFac2 : csvContentFac1
      };
    });

    const burstSize = 50;
    const startTime = Date.now();

    // Fire installs concurrently for both tenants
    await Promise.all(
      Array.from({ length: burstSize }).map(async (_, i) => {
        // Yield to event loop to simulate true concurrency
        await new Promise(r => setTimeout(r, Math.random() * 10));

        const isFac2 = i % 2 !== 0;
        const facId = isFac2 ? "fac2" : "fac1";
        const deptId = isFac2 ? "er" : "or";

        return resourceManager.installPack({
          packId: `pack_${facId}_${i}`,
          facilityId: facId,
          departmentId: deptId,
          title: `Test Pack ${i}`,
          category: "department",
          filePath: `${facId}/${deptId}/inventory.csv`,
          sizeBytes: 100,
          versionHash: `v${i}`,
          updatedAt: "2023-01-01T00:00:00Z",
        });
      })
    );

    const latency = Date.now() - startTime;
    assert.ok(latency < 5000, `Latency too high: ${latency}ms`); // Expect burst to finish within 5 seconds

    // Verify all packs are installed
    const packs = await resourceManager.getInstalledPacks();
    assert.strictEqual(packs.length, burstSize, `Expected ${burstSize} packs to be installed, got ${packs.length}`);

    // Firing multiple installs should trigger fetch for each
    assert.strictEqual(fetchCount, burstSize, `Expected ${burstSize} fetches, got ${fetchCount}`);

    // Verify items are isolated and data consistency is maintained
    let itemsFac1 = await offlineDb?.inventoryItems.where("tenant_id").equals("fac1::or").toArray();
    let itemsFac2 = await offlineDb?.inventoryItems.where("tenant_id").equals("fac2::er").toArray();

    assert.ok(itemsFac1 && itemsFac1.some(i => i.item === "Scalpel"));
    assert.ok(itemsFac1 && !itemsFac1.some(i => i.item === "Forceps")); // No Fac2 data

    assert.ok(itemsFac2 && itemsFac2.some(i => i.item === "Forceps"));
    assert.ok(itemsFac2 && !itemsFac2.some(i => i.item === "Scalpel")); // No Fac1 data

    mock.restoreAll();
  });





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

    // Fuzzing mapRoleToKey
    assert.strictEqual(resourceManager.mapRoleToKey(undefined as any), "circulator");
    assert.strictEqual(resourceManager.mapRoleToKey(null as any), "circulator");
    assert.strictEqual(resourceManager.mapRoleToKey(""), "circulator");
    assert.strictEqual(resourceManager.mapRoleToKey("   "), "circulator");
    assert.throws(() => resourceManager.mapRoleToKey([] as any));
  });

  test("formatBytes", () => {
    assert.strictEqual(resourceManager.formatBytes(0), "0 B");
    assert.strictEqual(resourceManager.formatBytes(500), "500 B");
    assert.strictEqual(resourceManager.formatBytes(1024), "1.0 KB");
    assert.strictEqual(resourceManager.formatBytes(1024 * 1024), "1.0 MB");

    // Fuzzing formatBytes
    assert.strictEqual(resourceManager.formatBytes(-100), "0 B");
    assert.strictEqual(resourceManager.formatBytes(NaN), "0 B");
    assert.strictEqual(resourceManager.formatBytes(Infinity), "Infinity MB");
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


  test("ResourceManagerChecksum malformed payload resilience and fuzzing", async () => {
    // 1. Fuzzing downloadPackContent
    // empty string
    mock.method(global, 'fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => ""
    }));

    await assert.rejects(
      async () => {
        await resourceManager.downloadPackContent("empty_file.md");
      },
      /Failed to download pack file: empty_file\.md/
    );
    mock.restoreAll();

    // whitespace string
    mock.method(global, 'fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => "   \n  \t  "
    }));

    await assert.rejects(
      async () => {
        await resourceManager.downloadPackContent("whitespace_file.md");
      },
      /Failed to download pack file: whitespace_file\.md/
    );
    mock.restoreAll();

    // 2. Schema validation with offline db
    // Installing a pack missing critical manifest fields
    await assert.rejects(
      async () => {
        await resourceManager.installPack({
          packId: "pack_missing_fields",
          facilityId: null as any,
          category: "hospital",
          title: "Title",
          filePath: "path.md",
          sizeBytes: 0,
          versionHash: "v1",
          updatedAt: "2023-01-01"
        });
      },
      // Depending on dexie validation, it might throw a different error, but we expect an error to be thrown when facilityId is null
      (err) => err instanceof Error
    );

    await assert.rejects(
      async () => {
        await resourceManager.installPack({
          packId: "pack_undefined_fields",
          facilityId: undefined as any,
          category: "hospital",
          title: "Title",
          filePath: "path.md",
          sizeBytes: 0,
          versionHash: "v1",
          updatedAt: "2023-01-01"
        });
      },
      (err) => err instanceof Error
    );
    mock.restoreAll();

    // Fuzzing CSV parsing
    mock.method(global, 'fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => "random string that is not a csv\nno headers\n1,2,3"
    }));
    await assert.doesNotReject(
      async () => {
        await resourceManager.installPack({
          packId: "pack_fuzz_csv",
          facilityId: "fac1",
          departmentId: "or",
          title: "Title",
          category: "department",
          filePath: "path.csv",
          sizeBytes: 10,
          versionHash: "v1",
          updatedAt: "2023-01-01"
        });
      }
    );
    mock.restoreAll();

    // Cleanup mid-test
    if (offlineDb) {
      await offlineDb.installedPacks.clear();
      await offlineDb.inventoryItems.clear();
    }

    // 3. ensureProfilePacksInstalled missing/malformed manifest fields
    mock.method(global, 'fetch', async (url) => {
      if (url.includes("manifest.json")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            packs: [
              // valid pack
              { packId: "handbook", facilityId: "fac1", category: "hospital", filePath: "handbook.md", versionHash: "v2" },
              // missing facilityId
              { packId: "bad1", category: "hospital", filePath: "bad1.md", versionHash: "v2" },
              // missing category
              { packId: "bad2", facilityId: "fac1", filePath: "bad2.md", versionHash: "v2" }
            ]
          })
        };
      }
      return { ok: true, status: 200, text: async () => "v2 content" };
    });

    const result = await resourceManager.ensureProfilePacksInstalled("fac1", "or", "circulator");

    // Only the valid handbook should be installed. bad1 and bad2 might be ignored or fail.
    const packs = await resourceManager.getInstalledPacks();
    assert.strictEqual(packs.length, 1);
    assert.strictEqual(packs[0].packId, "handbook");
    mock.restoreAll();
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

  test("ResourceManagerChecksum ensures multi-tenant isolation and data consistency", async () => {
    // 1. Setup multi-tenant data
    const csvContentFac1 = "item,room,cabinet,shelf,container,full_code\nScalpel,Main OR,A,1,A,Main OR A 1 A\n";
    const csvContentFac2 = "item,room,cabinet,shelf,container,full_code\nForceps,ER,B,2,C,ER B 2 C\n";

    // Install pack for Facility 1 (v1)
    mock.method(global, 'fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => csvContentFac1
    }));
    await resourceManager.installPack({
      packId: "pack_fac1", facilityId: "fac1", departmentId: "or", title: "Test Pack 1", category: "department", filePath: "fac1/or/inventory.csv", sizeBytes: 100, versionHash: "v1", updatedAt: "2023-01-01T00:00:00Z",
    });

    mock.restoreAll();

    // Install pack for Facility 2 (v1)
    mock.method(global, 'fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => csvContentFac2
    }));
    await resourceManager.installPack({
      packId: "pack_fac2", facilityId: "fac2", departmentId: "er", title: "Test Pack 2", category: "department", filePath: "fac2/er/inventory.csv", sizeBytes: 100, versionHash: "v1", updatedAt: "2023-01-01T00:00:00Z",
    });

    // 2. Verify multi-tenant isolation invariant (items for one tenant don't leak to another)
    let itemsFac1 = await offlineDb?.inventoryItems.where("tenant_id").equals("fac1::or").toArray();
    let itemsFac2 = await offlineDb?.inventoryItems.where("tenant_id").equals("fac2::er").toArray();

    assert.ok(itemsFac1 && itemsFac1.some(i => i.item === "Scalpel"));
    assert.ok(itemsFac1 && !itemsFac1.some(i => i.item === "Forceps")); // No Fac2 data

    assert.ok(itemsFac2 && itemsFac2.some(i => i.item === "Forceps"));
    assert.ok(itemsFac2 && !itemsFac2.some(i => i.item === "Scalpel")); // No Fac1 data

    mock.restoreAll();

    // 3. Verify Checksum/versionHash update logic
    // Update Facility 1 pack to v2 with new content (adding Retractor)
    const csvContentFac1_v2 = "item,room,cabinet,shelf,container,full_code\nScalpel,Main OR,A,1,A,Main OR A 1 A\nRetractor,Main OR,A,1,B,Main OR A 1 B\n";
    mock.method(global, 'fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => csvContentFac1_v2
    }));

    await resourceManager.installPack({
      packId: "pack_fac1", facilityId: "fac1", departmentId: "or", title: "Test Pack 1", category: "department", filePath: "fac1/or/inventory.csv", sizeBytes: 100, versionHash: "v2", updatedAt: "2023-01-02T00:00:00Z",
    });

    // Verify v2 is active and replaces v1 data
    itemsFac1 = await offlineDb?.inventoryItems.where("tenant_id").equals("fac1::or").toArray();
    assert.ok(itemsFac1 && itemsFac1.some(i => i.item === "Scalpel"));
    assert.ok(itemsFac1 && itemsFac1.some(i => i.item === "Retractor"));

    // Verify Fac2 data is still isolated and untouched
    itemsFac2 = await offlineDb?.inventoryItems.where("tenant_id").equals("fac2::er").toArray();
    assert.ok(itemsFac2 && itemsFac2.some(i => i.item === "Forceps"));
    assert.ok(itemsFac2 && !itemsFac2.some(i => i.item === "Retractor"));

    // Verify installed packs check
    const packs = await resourceManager.getInstalledPacks();
    const fac1Pack = packs.find(p => p.packId === "pack_fac1");
    assert.strictEqual(fac1Pack?.versionHash, "v2");
    assert.strictEqual(fac1Pack?.content, csvContentFac1_v2);
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

    // Since fetch mock returns "dummy" (length 5), sizeBytes in DB will be 5, overriding the input
    const summary = await resourceManager.getResourceStorageSummary();
    assert.strictEqual(summary.totalPacksCount, 2);
    assert.strictEqual(summary.totalSizeBytes, 10);
    assert.strictEqual(summary.formattedSize, "10 B");
  });

  test("deletePack removes pack from IndexedDB and offline inventory", async () => {
    const csvContent = "item,room,cabinet,shelf,container,full_code\nScalpel,Main OR,A,1,A,Main OR A 1 A\n";
    mock.method(global, 'fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => csvContent
    }));

    await resourceManager.installPack({
      packId: "pack_del_1",
      facilityId: "fac_del",
      departmentId: "or",
      title: "Test Delete Pack",
      category: "department",
      filePath: "fac_del/or/inventory.csv",
      sizeBytes: 100,
      versionHash: "v1",
      updatedAt: "2023-01-01T00:00:00Z",
    });

    let installed = await resourceManager.getInstalledPacks();
    assert.strictEqual(installed.length, 1);

    let items = await offlineDb?.inventoryItems.where("tenant_id").equals("fac_del::or").toArray();
    assert.ok(items && items.length > 0);

    // We expect 1 item (Scalpel) from the CSV, plus whatever getSeedInventoryItems returned (143 items in or_main)
    const scalpel = items?.find(i => i.item === "Scalpel");
    assert.ok(scalpel);

    await resourceManager.deletePack("pack_del_1");

    installed = await resourceManager.getInstalledPacks();
    assert.strictEqual(installed.length, 0);

    items = await offlineDb?.inventoryItems.where("tenant_id").equals("fac_del::or").toArray();

    // Since we delete all tenant items in deletePack and rehydrate, it'll rehydrate from seeds (no scalpel)
    const scalpelAfter = items?.find(i => i.item === "Scalpel");
    assert.strictEqual(scalpelAfter, undefined);
  });

  test("downloadPackContent throws error on fetch failure", async () => {
    mock.method(global, 'fetch', async () => {
      throw new Error("Network offline");
    });

    await assert.rejects(
      async () => {
        await resourceManager.downloadPackContent("test/path.md");
      },
      /Failed to download pack file: test\/path\.md/
    );
  });

  test("unpackInstalledPacksToDexie hydrates inventory successfully", async () => {
    const csvContent = "item,room,cabinet,shelf,container,full_code\nForceps,Main OR,B,2,C,Main OR B 2 C\n";
    mock.method(global, 'fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => csvContent
    }));

    // First, install the pack which hydrates it.
    await resourceManager.installPack({
      packId: "pack_unpack_1",
      facilityId: "fac_unpack",
      departmentId: "or",
      title: "Test Unpack",
      category: "department",
      filePath: "fac_unpack/or/inventory.csv",
      sizeBytes: 100,
      versionHash: "v1",
      updatedAt: "2023-01-01T00:00:00Z",
    });

    // Clear the inventory items to simulate app restart without hydration
    await offlineDb?.inventoryItems.clear();
    let items = await offlineDb?.inventoryItems.where("tenant_id").equals("fac_unpack::or").toArray();
    assert.strictEqual(items?.length, 0);

    // Call unpack to re-hydrate from installed pack (which overlays over base seed data)
    const count = await resourceManager.unpackInstalledPacksToDexie("fac_unpack", "or");

    // Check that we got the overlayed item
    items = await offlineDb?.inventoryItems.where("tenant_id").equals("fac_unpack::or").toArray();
    assert.ok(items && items.length > 0);
    assert.strictEqual(count, items!.length);

    const forceps = items?.find(i => i.item === "Forceps");
    assert.ok(forceps);
  });

  test("ResourceManagerChecksum enforces multi-tenant boundary isolation and offline mutation replay idempotency", async () => {
    const csvContentFac1 = "item,room,cabinet,shelf,container,full_code\nScalpel,Main OR,A,1,A,Main OR A 1 A\n";
    const csvContentFac2 = "item,room,cabinet,shelf,container,full_code\nForceps,ER,B,2,C,ER B 2 C\n";

    // Mock fetch to simulate offline mutation replay idempotency but return specific payloads for each tenant
    mock.method(global, 'fetch', async (url: string) => {
      return {
        ok: true,
        status: 200,
        text: async () => url.includes("fac2") ? csvContentFac2 : csvContentFac1
      };
    });

    const fac1PackMeta = {
      packId: "pack_fac1_1", facilityId: "fac1", departmentId: "or", title: "Test Pack 1", category: "department", filePath: "fac1/or/inventory.csv", sizeBytes: 100, versionHash: "v1", updatedAt: "2023-01-01T00:00:00Z"
    };

    const fac2PackMeta = {
      packId: "pack_fac2_1", facilityId: "fac2", departmentId: "er", title: "Test Pack 2", category: "department", filePath: "fac2/er/inventory.csv", sizeBytes: 100, versionHash: "v1", updatedAt: "2023-01-01T00:00:00Z"
    };

    // Install multiple times sequentially for offline replay idempotency
    await resourceManager.installPack(fac1PackMeta);
    const fac1ItemsAfterFirst = await offlineDb?.inventoryItems.where("tenant_id").equals("fac1::or").toArray();
    const fac1InstalledPacksAfterFirst = await resourceManager.getInstalledPacks();

    await resourceManager.installPack(fac1PackMeta);
    const fac1ItemsAfterSecond = await offlineDb?.inventoryItems.where("tenant_id").equals("fac1::or").toArray();
    const fac1InstalledPacksAfterSecond = await resourceManager.getInstalledPacks();

    assert.deepStrictEqual(fac1ItemsAfterFirst, fac1ItemsAfterSecond);

    // installedAt will differ slightly since it uses new Date().toISOString()
    // but everything else should match
    const stripInstalledAt = (packs: any[]) => packs.map(p => {
      const { installedAt, ...rest } = p;
      return rest;
    });

    assert.deepStrictEqual(stripInstalledAt(fac1InstalledPacksAfterFirst), stripInstalledAt(fac1InstalledPacksAfterSecond));

    // Install for second facility
    await resourceManager.installPack(fac2PackMeta);
    await resourceManager.installPack(fac2PackMeta);

    // Verify multi-tenant boundary isolation
    const fac1Items = await offlineDb?.inventoryItems.where("tenant_id").equals("fac1::or").toArray();
    const fac2Items = await offlineDb?.inventoryItems.where("tenant_id").equals("fac2::er").toArray();

    assert.ok(fac1Items && fac1Items.some(i => i.item === "Scalpel"));
    assert.ok(fac1Items && !fac1Items.some(i => i.item === "Forceps")); // No Fac2 data
    assert.ok(fac2Items && fac2Items.some(i => i.item === "Forceps"));
    assert.ok(fac2Items && !fac2Items.some(i => i.item === "Scalpel")); // No Fac1 data

    // Explicit offline mutation replay strict structural equality checks
    // The items will include the CSV items overlaid on whatever seed data was rehydrated
    // So we just check that the specific item we added is exactly as expected structurally
    // and the lengths remain completely stable across replays.
    assert.strictEqual(fac1Items?.length, fac1ItemsAfterFirst?.length);
    assert.strictEqual(fac1ItemsAfterFirst?.length, fac1ItemsAfterSecond?.length);

    const scalpelItem = fac1Items?.find(i => i.item === "Scalpel");
    assert.ok(scalpelItem);

    const { verify_count, pending_location, ...cleanScalpel } = scalpelItem;
    const expectedCleanScalpel = {
      id: "fac1::or::scalpel",
      tenant_id: "fac1::or",
      item: "Scalpel",
      room: "Main OR",
      cabinet: "A",
      shelf: "1",
      container: "A",
      full_code: "Main OR A 1 A",
      phonetic_code: "Main OR A 1 A",
      surgeon_notes: "",
      category: "",
      normalized_name: "scalpel"
    };
    assert.deepStrictEqual(cleanScalpel, expectedCleanScalpel);
  });
});

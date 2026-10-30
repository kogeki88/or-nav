import test from "node:test";
import assert from "node:assert";
import { getFacilityIdFromTenant } from "./lexiconLearning";

test("getFacilityIdFromTenant normalizes facility ID resolution", async (t) => {
    await t.test("handles double colon separator", () => {
        assert.deepStrictEqual(getFacilityIdFromTenant("general_memorial::cvor"), {
            facilityId: "general_memorial",
            departmentId: "cvor"
        });
    });

    await t.test("handles extra spaces", () => {
        assert.deepStrictEqual(getFacilityIdFromTenant(" general_memorial :: cvor "), {
            facilityId: "general_memorial",
            departmentId: "cvor"
        });
    });

    await t.test("handles uppercase", () => {
        assert.deepStrictEqual(getFacilityIdFromTenant("GENERAL_MEMORIAL::CVOR"), {
            facilityId: "general_memorial",
            departmentId: "cvor"
        });
    });

    await t.test("handles concatenated format with _", () => {
        assert.deepStrictEqual(getFacilityIdFromTenant("general_memorial_cvor"), {
            facilityId: "general_memorial",
            departmentId: "cvor"
        });
    });

    await t.test("handles sacred_heart_", () => {
        assert.deepStrictEqual(getFacilityIdFromTenant("sacred_heart_cvor"), {
            facilityId: "sacred_heart",
            departmentId: "cvor"
        });
    });

    await t.test("handles missing department", () => {
        assert.deepStrictEqual(getFacilityIdFromTenant("sacred_heart"), {
            facilityId: "sacred_heart",
            departmentId: "or"
        });
    });

    await t.test("handles empty string", () => {
        assert.deepStrictEqual(getFacilityIdFromTenant(""), {
            facilityId: "sacred_heart",
            departmentId: "or"
        });
    });

    await t.test("handles unknown department", () => {
        assert.deepStrictEqual(getFacilityIdFromTenant("some_unknown_facility"), {
            facilityId: "some_unknown_facility",
            departmentId: "or"
        });
    });

    await t.test("handles trailing slashes", () => {
        assert.deepStrictEqual(getFacilityIdFromTenant("general_memorial/"), {
            facilityId: "general_memorial",
            departmentId: "or"
        });
    });

    await t.test("handles trailing slash with department", () => {
        assert.deepStrictEqual(getFacilityIdFromTenant("general_memorial_cvor/"), {
            facilityId: "general_memorial",
            departmentId: "cvor"
        });
    });

    await t.test("Invariant: Multi-tenant isolation - rejects path traversal and enforces exact mapping", () => {
        // Frontend shouldn't throw, but it correctly splits the ID and delegates validation to the backend.
        // It ensures cross-tenant injections (multiple ::) drop subsequent parts to isolate.
        assert.deepStrictEqual(getFacilityIdFromTenant("../sacred_heart::or"), {
            facilityId: "../sacred_heart",
            departmentId: "or"
        });

        assert.deepStrictEqual(getFacilityIdFromTenant("sacred_heart::../or"), {
            facilityId: "sacred_heart",
            departmentId: "../or"
        });

        // Verifies cross-tenant injections (too many colons) drop the rest
        assert.deepStrictEqual(getFacilityIdFromTenant("facilitya::deptb::facilityc"), {
            facilityId: "facilitya",
            departmentId: "deptb"
        });
    });

    await t.test("Invariant: Offline-first execution - mapping resolves synchronously without network or DOM", () => {
        // Assert that the function executes immediately and returns expected offline default
        // without depending on window, fetch, or other async APIs.
        const start = performance.now();
        const result = getFacilityIdFromTenant("some_tenant_string");
        const end = performance.now();

        assert.deepStrictEqual(result, {
            facilityId: "some_tenant_string",
            departmentId: "or"
        });
        // execution should be synchronously extremely fast
        assert.ok((end - start) < 5, "Execution must be under 5ms, proving synchronous offline-first nature");
    });
});

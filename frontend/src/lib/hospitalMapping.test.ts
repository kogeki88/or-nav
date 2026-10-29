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
});

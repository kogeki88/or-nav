import { describe, test } from "node:test";
import assert from "node:assert";
import { cn } from "./utils.ts";

describe("cn utility function", () => {
  test("merges basic class names", () => {
    assert.strictEqual(cn("class1", "class2"), "class1 class2");
  });

  test("handles conditional classes", () => {
    assert.strictEqual(cn("class1", true && "class2", false && "class3"), "class1 class2");
  });

  test("resolves tailwind css conflicts properly", () => {
    assert.strictEqual(cn("p-4", "p-8"), "p-8");
    assert.strictEqual(cn("text-red-500", "text-blue-500"), "text-blue-500");
  });

  test("handles arrays of class names", () => {
    assert.strictEqual(cn(["class1", "class2"], "class3"), "class1 class2 class3");
  });

  test("handles objects of class names", () => {
    assert.strictEqual(cn("class1", { class2: true, class3: false }), "class1 class2");
  });

  test("ignores falsy values", () => {
    assert.strictEqual(cn("class1", undefined, null, false, "", 0), "class1");
  });

  test("handles complex combinations", () => {
    assert.strictEqual(
      cn(
        "base-class p-4",
        { "bg-red-500": false, "bg-blue-500": true },
        ["flex", "items-center"],
        "p-8"
      ),
      "base-class bg-blue-500 flex items-center p-8"
    );
  });
});

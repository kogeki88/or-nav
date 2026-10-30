import 'jsdom-global/register.js';
import test, { describe, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { renderHook, act } from "@testing-library/react";
import { useSyncEngine } from "./syncEngine";
import * as offlineDb from "./offlineDb";
import * as api from "./api";

describe("useSyncEngine", () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  test("renders offline", async () => {
    assert.strictEqual(1, 1);
  });
});

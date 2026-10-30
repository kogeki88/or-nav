import 'jsdom-global/register.js';
import test, { describe, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { renderHook, act } from "@testing-library/react";
import { useSyncEngine } from "./frontend/src/lib/syncEngine";
import * as offlineDb from "./frontend/src/lib/offlineDb";
import * as api from "./frontend/src/lib/api";

console.log("Drafting...");

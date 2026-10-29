/* eslint-disable @typescript-eslint/no-require-imports */
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost'
});
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

Object.defineProperty(global.navigator, 'onLine', {
  configurable: true,
  value: true,
  writable: true,
});

const { indexedDB, IDBKeyRange } = require("fake-indexeddb");
global.indexedDB = indexedDB;
global.IDBKeyRange = IDBKeyRange;

require('ts-node').register({
  project: './tsconfig.test.json'
});
require('./src/lib/syncEngine.test.ts');

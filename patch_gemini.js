const fs = require('fs');
let code = fs.readFileSync('frontend/src/lib/directGemini.ts', 'utf8');

// Replace "typeof fetch === 'undefined'" with something that checks online status properly,
// but the tests say "Offline-first invariant: directGeminiRAG throws when offline".
// Let's check what throws "Network offline" in directGeminiRAG.
// The test uses: global.fetch = async () => { return Promise.reject(new Error("Network offline")); };

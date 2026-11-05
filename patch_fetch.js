const fs = require('fs');
let code = fs.readFileSync('frontend/src/lib/directGemini.ts', 'utf8');

// Replace standard network check with comprehensive offline check and fetch catching
const fixedDirectTranscribe = code.replace(
  /if \(typeof fetch === 'undefined'\) \{\n    throw new Error\("Network offline"\);\n  \}/g,
  `if (typeof fetch === 'undefined' || (typeof window !== 'undefined' && window.navigator && window.navigator.onLine === false)) {\n    throw new Error("Network offline");\n  }`
);

fs.writeFileSync('frontend/src/lib/directGemini.ts', fixedDirectTranscribe);
console.log('patched');

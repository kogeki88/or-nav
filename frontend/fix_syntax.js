const fs = require('fs');
let content = fs.readFileSync('src/components/QuestionsDrawer.test.tsx', 'utf8');
const counts = (content.match(/}\);\n/g) || []).length;
console.log('counts', counts)

// Loads the browser engine scripts into Node (they attach to globalThis.FB).
const path = require('path');
for (const f of ['core.js', 'commentary.js', 'engine.js', 'ai.js']) require(path.join(__dirname, '..', 'js', f));
module.exports = globalThis.FB;

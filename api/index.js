// Vercel serverless entry: the whole Express API runs as one function.
// vercel.json rewrites every /api/* request here; server/dist is built by scripts/vercel-build.sh.
const { createApp } = require('../server/dist/app');

module.exports = createApp();

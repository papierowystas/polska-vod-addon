'use strict';
// Punkt wejścia dla Vercel (serverless). Wszystkie ścieżki trafiają tutaj przez vercel.json.
const { handler } = require('../lib/addon');
module.exports = handler;

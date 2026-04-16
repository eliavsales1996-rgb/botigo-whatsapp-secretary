'use strict';

require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Step 1: just persona + claude (no Twilio)
let claudeReady = false;
let claudeError = null;
try {
  require('../src/claude');
  claudeReady = true;
} catch (e) {
  claudeError = e.message;
}

let twilioReady = false;
let twilioError = null;
try {
  require('../src/twilio');
  twilioReady = true;
} catch (e) {
  twilioError = e.message;
}

app.use((req, res) => {
  res.json({
    ok: true,
    twilio_env: !!process.env.TWILIO_ACCOUNT_SID,
    anthropic_env: !!process.env.ANTHROPIC_API_KEY,
    claude_module: claudeReady ? 'ok' : claudeError,
    twilio_module: twilioReady ? 'ok' : twilioError,
  });
});

module.exports = app;

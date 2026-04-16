'use strict';

const express = require('express');
const app = express();

app.use((req, res) => {
  res.json({
    ok: true,
    path: req.path,
    twilio_set: !!process.env.TWILIO_ACCOUNT_SID,
    anthropic_set: !!process.env.ANTHROPIC_API_KEY,
  });
});

module.exports = app;

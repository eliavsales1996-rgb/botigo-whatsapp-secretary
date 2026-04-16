'use strict';

const express = require('express');
const { getReply, FALLBACK_MESSAGE } = require('./claude');

const router = express.Router();

router.post('/', async (req, res) => {
  const { Body: incomingBody, From: sender } = req.body;
  const timestamp = new Date().toISOString();

  // Validate required fields
  if (!incomingBody || !sender) {
    console.error(`[${timestamp}] Webhook received invalid payload:`, req.body);
    return res.status(400).send('Bad Request: missing Body or From fields');
  }

  console.log(`[${timestamp}] Incoming message from ${sender}: "${incomingBody}"`);

  // In serverless environments (Vercel), execution stops after res.send().
  // So we generate the reply FIRST and return it directly via TwiML.
  let replyText;
  try {
    replyText = await getReply(incomingBody);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Claude failed for ${sender}:`, err.message);
    replyText = FALLBACK_MESSAGE;
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(replyText)}</Message></Response>`;
  res.set('Content-Type', 'text/xml');
  res.status(200).send(twiml);
});

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = router;

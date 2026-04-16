'use strict';

const express = require('express');
const { waitUntil } = require('@vercel/functions');
const { getReply, FALLBACK_MESSAGE } = require('./claude');
const { sendMessage } = require('./twilio');

const router = express.Router();

router.post('/', (req, res) => {
  const { Body: incomingBody, From: sender } = req.body;
  const timestamp = new Date().toISOString();

  if (!incomingBody || !sender) {
    console.error(`[${timestamp}] Webhook received invalid payload:`, req.body);
    return res.status(400).send('Bad Request: missing Body or From fields');
  }

  console.log(`[${timestamp}] Incoming message from ${sender}: "${incomingBody}"`);

  // Respond to Twilio immediately (must be within 15 seconds)
  res.set('Content-Type', 'text/xml');
  res.status(200).send('<Response></Response>');

  // waitUntil tells Vercel to keep the function alive after the response
  waitUntil(
    getReply(incomingBody)
      .then(reply => sendMessage(sender, reply))
      .catch(async (err) => {
        console.error(`[${new Date().toISOString()}] Failed for ${sender}:`, err.message);
        await sendMessage(sender, FALLBACK_MESSAGE).catch(() => {});
      })
  );
});

module.exports = router;

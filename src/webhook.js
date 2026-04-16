'use strict';

const express = require('express');
const { getReply, FALLBACK_MESSAGE } = require('./claude');
const { sendMessage } = require('./twilio');

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

  // Acknowledge Twilio immediately with an empty TwiML response.
  // The actual reply is sent asynchronously via the REST API.
  res.set('Content-Type', 'text/xml');
  res.status(200).send('<Response></Response>');

  // Generate and send reply asynchronously (avoids Twilio's 30s webhook timeout)
  try {
    const reply = await getReply(incomingBody);
    await sendMessage(sender, reply);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Failed to process message from ${sender}:`, err.message);
    try {
      await sendMessage(sender, FALLBACK_MESSAGE);
    } catch (fallbackErr) {
      console.error(`[${new Date().toISOString()}] Fallback message also failed:`, fallbackErr.message);
    }
  }
});

module.exports = router;

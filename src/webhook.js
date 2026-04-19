'use strict';

const express = require('express');
const { waitUntil } = require('@vercel/functions');
const { getReply, FALLBACK_MESSAGE } = require('./claude');
const { sendMessage } = require('./twilio');
const { resolveContext, saveMessage, fetchHistory } = require('./db');
const { getSystemPrompt } = require('./persona');
const { transcribeVoiceNote } = require('./transcribe');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// Twilio webhook — must respond within 15 s
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const {
    Body: incomingBody,
    From: sender,
    NumMedia,
    MediaUrl0: mediaUrl,
    MediaContentType0: mediaType,
  } = req.body;

  const timestamp = new Date().toISOString();

  if (!sender) {
    console.error(`[${timestamp}] Webhook missing From field:`, req.body);
    return res.status(400).send('Bad Request: missing From field');
  }

  console.log(
    `[${timestamp}] Incoming number: ${sender} | text="${incomingBody || ''}" | media=${NumMedia || 0}`
  );

  res.set('Content-Type', 'text/xml');
  res.status(200).send('<Response></Response>');

  waitUntil(
    handleMessage({
      sender,
      incomingBody: incomingBody || '',
      numMedia: parseInt(NumMedia || '0', 10),
      mediaUrl:  mediaUrl  || null,
      mediaType: mediaType || null,
      timestamp,
    }).catch(async (err) => {
      console.error(`[${new Date().toISOString()}] Unhandled error for ${sender}:`, err.message);
      await sendMessage(sender, FALLBACK_MESSAGE).catch(() => {});
    })
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Core handler
// ─────────────────────────────────────────────────────────────────────────────
async function handleMessage({ sender, incomingBody, numMedia, mediaUrl, mediaType, timestamp }) {

  // ── 1. Media / voice message ──────────────────────────────────────────────
  let messageSaved = false; // track whether we already persisted the user message

  if (numMedia > 0) {
    const isAudio = mediaType && (mediaType.startsWith('audio/') || mediaType === 'application/ogg');

    if (isAudio) {
      console.log(`[${timestamp}] Voice note from ${sender}: ${mediaType} — transcribing…`);

      let transcribed = '';
      try {
        transcribed = await transcribeVoiceNote(mediaUrl, mediaType);
      } catch (err) {
        console.error(`[${timestamp}] Transcription failed for ${sender}:`, err.message);
      }

      if (!transcribed) {
        // Transcription unavailable — fall back to text prompt
        await saveMessage(sender, 'user', '[הודעה קולית — תמלול נכשל]', mediaUrl, mediaType);
        await sendMessage(sender, 'לא הצלחתי לתמלל את ההודעה הקולית. אפשר לשלוח בטקסט?');
        return;
      }

      console.log(`[${timestamp}] Transcription for ${sender}: "${transcribed}"`);
      // Treat the transcribed text as the user's message — continue the normal flow
      incomingBody = transcribed;
      await saveMessage(sender, 'user', transcribed, mediaUrl, mediaType);
      messageSaved = true;
    } else {
      // Non-audio attachment with optional caption — treat caption as message text
      const caption = incomingBody || '[קובץ מדיה]';
      await saveMessage(sender, 'user', caption, mediaUrl, mediaType);
      incomingBody = caption;
      messageSaved = true;
    }
  }

  if (!incomingBody) {
    console.warn(`[${timestamp}] Empty payload from ${sender} — ignoring`);
    return;
  }

  // ── 2. Router — who is this? ──────────────────────────────────────────────
  const { role, business } = await resolveContext(sender);
  const systemPrompt = getSystemPrompt(role, business);
  // context is passed to native action tools so they know which business to query
  const context = { businessId: business?.id ?? null, sender };

  console.log(`[${timestamp}] DEBUG resolveContext → role="${role}" business="${business?.name ?? 'n/a'}" businessId="${context.businessId ?? 'NULL'}"`);
  console.log(`[${timestamp}] DEBUG systemPrompt starts with: "${systemPrompt.slice(0, 60).replace(/\n/g, ' ')}..."`);

  // ── 3. Memory — fetch history before saving the new message ──────────────
  const history = await fetchHistory(sender);

  // ── 4. Persist incoming message (skip if already saved in step 1) ─────────
  if (!messageSaved) await saveMessage(sender, 'user', incomingBody);

  // ── 5. Generate reply (agentic loop with native tools) ────────────────────
  const reply = await getReply(incomingBody, systemPrompt, history, context);

  // ── 6. Persist reply + send ───────────────────────────────────────────────
  await saveMessage(sender, 'assistant', reply);
  await sendMessage(sender, reply);
}

module.exports = router;

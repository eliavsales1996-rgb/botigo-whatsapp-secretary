'use strict';

const { OpenAI } = require('openai');

// Lazy-initialised so missing key only errors at call time, not import time
let _client = null;
function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

/**
 * Map a MIME type to the file extension Whisper expects.
 * Twilio voice notes are typically audio/ogg (with Opus codec).
 */
function mimeToExt(mediaType = '') {
  if (mediaType.includes('ogg'))  return 'ogg';
  if (mediaType.includes('mp4'))  return 'mp4';
  if (mediaType.includes('mpeg')) return 'mp3';
  if (mediaType.includes('webm')) return 'webm';
  if (mediaType.includes('wav'))  return 'wav';
  return 'ogg'; // safe default for WhatsApp voice notes
}

/**
 * Download a Twilio media file using Basic Auth.
 * Twilio media URLs require AccountSID + AuthToken credentials.
 *
 * @param {string} mediaUrl  URL from Twilio MediaUrl0
 * @returns {Promise<Buffer>}
 */
async function downloadTwilioMedia(mediaUrl) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set');
  }

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  console.log(`[Transcribe] Downloading media from Twilio: ${mediaUrl}`);

  const response = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!response.ok) {
    throw new Error(`Twilio media download failed: ${response.status} ${response.statusText}`);
  }

  const arrayBuf = await response.arrayBuffer();
  const buffer   = Buffer.from(arrayBuf);
  console.log(`[Transcribe] Downloaded ${buffer.byteLength} bytes (${mediaUrl})`);
  return buffer;
}

/**
 * Transcribe an audio buffer using OpenAI Whisper.
 *
 * @param {Buffer} audioBuffer
 * @param {string} mediaType   MIME type, e.g. "audio/ogg"
 * @returns {Promise<string>}  Transcribed text
 */
async function transcribeBuffer(audioBuffer, mediaType) {
  const ext  = mimeToExt(mediaType);
  const file = new File([audioBuffer], `voice.${ext}`, { type: mediaType });

  console.log(`[Transcribe] Sending ${audioBuffer.byteLength}B to Whisper (ext=${ext})`);

  const result = await getClient().audio.transcriptions.create({
    file,
    model:    'whisper-1',
    language: 'he',          // hint: Hebrew — Whisper still auto-detects if wrong
  });

  const text = result.text?.trim() || '';
  console.log(`[Transcribe] Whisper result: "${text}"`);
  return text;
}

/**
 * Full pipeline: download from Twilio → transcribe with Whisper.
 *
 * @param {string} mediaUrl   URL from Twilio MediaUrl0
 * @param {string} mediaType  MIME type from Twilio MediaContentType0
 * @returns {Promise<string>} Transcribed text, or '' if anything fails
 */
async function transcribeVoiceNote(mediaUrl, mediaType) {
  const buffer = await downloadTwilioMedia(mediaUrl);
  return transcribeBuffer(buffer, mediaType);
}

module.exports = { transcribeVoiceNote };

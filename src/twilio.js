'use strict';

require('dotenv').config();
const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * Send a WhatsApp message via Twilio.
 * @param {string} to   - Recipient in "whatsapp:+972XXXXXXXXX" format
 * @param {string} body - Message text
 * @returns {Promise<object>} Twilio message resource
 */
async function sendMessage(to, body) {
  try {
    const message = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to,
      body,
    });
    console.log(`[${new Date().toISOString()}] Message sent — SID: ${message.sid}`);
    return message;
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Twilio send error:`, err.message);
    throw err;
  }
}

/**
 * Validate an incoming Twilio request signature.
 * @param {string} url       - Full URL of the webhook endpoint
 * @param {object} params    - POST body params
 * @param {string} signature - X-Twilio-Signature header value
 * @returns {boolean}
 */
function validateSignature(url, params, signature) {
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    params
  );
}

module.exports = { sendMessage, validateSignature };

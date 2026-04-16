'use strict';

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { SYSTEM_PROMPT } = require('./persona');

const CLAUDE_TIMEOUT_MS = 25_000;
const FALLBACK_MESSAGE =
  'מצטערת, אירעה שגיאה טכנית זמנית. אנא נסה שנית בעוד מספר דקות, או התקשר ישירות למשרד.';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Generate a reply from the legal secretary AI.
 * @param {string} userMessage - The incoming WhatsApp message text
 * @returns {Promise<string>} The AI-generated reply
 */
async function getReply(userMessage) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error('Claude API timeout after 25 seconds')),
      CLAUDE_TIMEOUT_MS
    )
  );

  const claudePromise = client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const response = await Promise.race([claudePromise, timeoutPromise]);
  const textBlock = response.content.find((block) => block.type === 'text');

  if (!textBlock) {
    throw new Error('Claude returned no text content');
  }

  return textBlock.text;
}

module.exports = { getReply, FALLBACK_MESSAGE };

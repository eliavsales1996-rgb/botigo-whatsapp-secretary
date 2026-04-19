'use strict';

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { BOTIGO_SALES_PROMPT } = require('./persona');
const { TOOL_DEFINITIONS, dispatch } = require('./actions');

const CLAUDE_TIMEOUT_MS = 50_000; // generous — agentic loop may call Claude 2-3 times
const MAX_TOOL_ITERATIONS = 5;    // guard against infinite loops
const FALLBACK_MESSAGE =
  'מצטערת, אירעה שגיאה טכנית זמנית. אנא נסה שנית בעוד מספר דקות.';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

async function callClaude(messages, systemPrompt) {
  return client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemPrompt,
    tools: TOOL_DEFINITIONS,
    messages,
  });
}

/**
 * Execute one tool_use block and return a tool_result block.
 *
 * @param {{ id: string, name: string, input: object }} block
 * @param {{ businessId: string|null }}                 context
 */
async function runTool(block, context) {
  console.log(`[Claude] tool_use → "${block.name}"`, block.input);
  const result = await dispatch(block.name, block.input, context);
  console.log(`[Claude] tool_result "${block.name}" success=${result.success}`);

  return {
    type: 'tool_result',
    tool_use_id: block.id,
    content: JSON.stringify(result),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a reply using Claude with an agentic tool-use loop.
 *
 * @param {string}   userMessage   The latest incoming WhatsApp message
 * @param {string}   systemPrompt  Persona prompt chosen for this conversation
 * @param {Array<{role:string, content:string}>} history  Prior messages (oldest first)
 * @param {{ businessId: string|null }} context  Business context for tool calls
 * @returns {Promise<string>}
 */
async function getReply(
  userMessage,
  systemPrompt = BOTIGO_SALES_PROMPT,
  history = [],
  context = {}
) {
  const deadline = Date.now() + CLAUDE_TIMEOUT_MS;

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  let response;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Claude agentic loop timed out');

    response = await Promise.race([
      callClaude(messages, systemPrompt),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Claude API timeout')), remaining)
      ),
    ]);

    // No tool calls — we have the final text answer, exit the loop
    if (response.stop_reason !== 'tool_use') break;

    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
    if (!toolUseBlocks.length) break;

    // Append the full assistant turn (may include text + tool_use blocks)
    messages.push({ role: 'assistant', content: response.content });

    // Execute all tool calls in parallel, collect results
    const toolResults = await Promise.all(toolUseBlocks.map((b) => runTool(b, context)));

    // Feed results back as a user turn
    messages.push({ role: 'user', content: toolResults });
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Claude returned no text content');
  return textBlock.text;
}

module.exports = { getReply, FALLBACK_MESSAGE };

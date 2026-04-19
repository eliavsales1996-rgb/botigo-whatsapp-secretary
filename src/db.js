'use strict';

const { supabase } = require('./supabase');

/** How many past messages to load as conversation history */
const HISTORY_LIMIT = 20;

/**
 * Strip the "whatsapp:" prefix and any leading/trailing whitespace from a phone
 * number so we can compare it against values stored in Supabase regardless of
 * whether the stored value includes the prefix or not.
 *
 * Examples:
 *   "whatsapp:+972501234567" → "+972501234567"
 *   "+972501234567"          → "+972501234567"
 *   "  whatsapp:+1234  "     → "+1234"
 */
function normalizePhone(raw) {
  return (raw || '').trim().replace(/^whatsapp:/i, '').trim();
}

/**
 * Determine who the sender is and what business context applies.
 *
 * Returns one of three shapes:
 *   { role: 'owner',    business: { id, name, sales_prompt } }
 *   { role: 'customer', business: { id, name, sales_prompt } }
 *   { role: 'lead',     business: null }
 *
 * @param {string} rawPhone  Twilio-formatted phone, e.g. "whatsapp:+972501234567"
 */
async function resolveContext(rawPhone) {
  const phone = normalizePhone(rawPhone);
  console.log(`[DB] resolveContext → incoming raw="${rawPhone}" normalized="${phone}"`);

  // 1. Is this an owner of a business registered on Botigo?
  //    Try the raw Twilio value first, then the normalized form (+972...).
  //    Two separate queries avoids PostgREST colon-parsing issues with .or().
  let business = null;
  for (const candidate of [rawPhone, phone]) {
    const { data, error } = await supabase
      .from('businesses')
      .select('id, name, sales_prompt')
      .eq('owner_phone', candidate)
      .maybeSingle();
    if (error) console.error(`[DB] resolveContext (owner lookup, candidate="${candidate}"):`, error.message);
    if (data) { business = data; break; }
  }

  if (business) {
    console.log(`[DB] resolveContext → Matched Business: id="${business.id}" name="${business.name}" (owner)`);
    return { role: 'owner', business };
  }

  // 2. Is this a known customer linked to a business?
  let customer = null;
  for (const candidate of [rawPhone, phone]) {
    const { data, error } = await supabase
      .from('customers')
      .select('id, business_id, businesses(id, name, sales_prompt)')
      .eq('phone', candidate)
      .maybeSingle();
    if (error) console.error(`[DB] resolveContext (customer lookup, candidate="${candidate}"):`, error.message);
    if (data) { customer = data; break; }
  }
  if (customer?.businesses) {
    console.log(`[DB] resolveContext → Matched Business: id="${customer.businesses.id}" name="${customer.businesses.name}" (customer)`);
    return { role: 'customer', business: customer.businesses };
  }

  // 3. Unknown number — treat as a fresh lead for Botigo's own sales bot
  console.log(`[DB] resolveContext → No match found → role=lead`);
  return { role: 'lead', business: null };
}

/**
 * Persist a single message to the messages table.
 *
 * @param {string}      phone      Twilio-formatted phone
 * @param {'user'|'assistant'} role
 * @param {string}      content    Text content (or placeholder for media)
 * @param {string|null} mediaUrl   URL of voice/media file, if any
 * @param {string|null} mediaType  MIME type of the media, if any
 */
async function saveMessage(phone, role, content, mediaUrl = null, mediaType = null) {
  const { error } = await supabase.from('messages').insert({
    sender_phone: phone,
    role,
    content,
    media_url: mediaUrl,
    media_type: mediaType,
  });
  if (error) console.error('[DB] saveMessage failed:', error.message);
}

/**
 * Fetch recent conversation history for a phone number.
 * Returns an array of { role, content } objects suitable for the Claude API.
 *
 * @param {string} phone  Twilio-formatted phone
 * @returns {Promise<Array<{role: string, content: string}>>}
 */
async function fetchHistory(phone) {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content')
    .eq('sender_phone', phone)
    .order('created_at', { ascending: true })
    .limit(HISTORY_LIMIT);

  if (error) {
    console.error('[DB] fetchHistory failed:', error.message);
    return [];
  }
  return data || [];
}

module.exports = { resolveContext, saveMessage, fetchHistory };

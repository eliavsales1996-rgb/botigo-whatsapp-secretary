'use strict';

const { supabase } = require('./supabase');

const HISTORY_LIMIT = 20;

/**
 * Return only the digit characters of a phone string.
 * "whatsapp:+972-50 123 4567" → "972501234567"
 */
function digitsOnly(raw) {
  return (raw || '').replace(/\D/g, '');
}

/**
 * Generate every plausible stored format for an incoming Twilio phone number
 * so we can match regardless of how the owner entered their number in Supabase.
 *
 * Twilio sends: "whatsapp:+972501234567"
 * Supabase might store: "+972501234567", "972501234567", "0501234567",
 *                       "whatsapp:+972501234567", etc.
 */
function phoneVariants(raw) {
  const trimmed = (raw || '').trim();
  const noPrefix = trimmed.replace(/^whatsapp:/i, '').trim(); // "+972501234567"
  const digits = digitsOnly(raw);                              // "972501234567"

  const variants = new Set([trimmed, noPrefix, digits]);

  if (digits.startsWith('972') && digits.length >= 12) {
    variants.add('+' + digits);              // "+972501234567"
    variants.add('0' + digits.slice(3));     // "0501234567"
    variants.add('whatsapp:+' + digits);     // "whatsapp:+972501234567"
    variants.add('whatsapp:' + noPrefix);    // "whatsapp:+972501234567" (from noPrefix)
  }

  return [...variants].filter(Boolean);
}

/**
 * Determine who the sender is and what business context applies.
 *
 * Returns:
 *   { role: 'owner',    business, ownerName }
 *   { role: 'customer', business, ownerName: null }
 *   { role: 'lead',     business: null, ownerName: null }
 *
 * @param {string} rawPhone  Twilio-formatted phone, e.g. "whatsapp:+972501234567"
 */
async function resolveContext(rawPhone) {
  const variants = phoneVariants(rawPhone);
  console.log(`[DB] resolveContext → raw="${rawPhone}" | digits="${digitsOnly(rawPhone)}" | variants=${JSON.stringify(variants)}`);

  // ── 1. Owner lookup ────────────────────────────────────────────────────────
  let business = null;
  let ownerName = null;

  for (const candidate of variants) {
    const { data, error } = await supabase
      .from('businesses')
      .select('id, name, sales_prompt, owner_phone, owner_name')
      .eq('owner_phone', candidate)
      .maybeSingle();

    if (error) console.error(`[DB] owner lookup (candidate="${candidate}"):`, error.message);
    if (data) {
      console.log(`[DB] Owner match → candidate="${candidate}" stored owner_phone="${data.owner_phone}" business="${data.name}"`);
      business = data;
      ownerName = data.owner_name || null;
      break;
    }
  }

  // If no owner matched, log all stored phones to help diagnose mismatches
  if (!business) {
    const { data: allBiz } = await supabase
      .from('businesses')
      .select('name, owner_phone');
    if (allBiz?.length) {
      console.log(
        `[DB] No owner match. Stored owner_phones: ` +
        allBiz.map((b) => `"${b.name}" → "${b.owner_phone}" (digits: "${digitsOnly(b.owner_phone)}")`).join(' | ')
      );
    } else {
      console.log('[DB] No businesses found in DB at all.');
    }
  }

  if (business) {
    console.log(`[DB] role=owner | business="${business.name}" | ownerName="${ownerName ?? 'not set'}"`);
    return { role: 'owner', business, ownerName };
  }

  // ── 2. Customer lookup ─────────────────────────────────────────────────────
  let customer = null;
  for (const candidate of variants) {
    const { data, error } = await supabase
      .from('customers')
      .select('id, business_id, businesses(id, name, sales_prompt)')
      .eq('phone', candidate)
      .maybeSingle();
    if (error) console.error(`[DB] customer lookup (candidate="${candidate}"):`, error.message);
    if (data) { customer = data; break; }
  }

  if (customer?.businesses) {
    console.log(`[DB] role=customer | business="${customer.businesses.name}"`);
    return { role: 'customer', business: customer.businesses, ownerName: null };
  }

  // ── 3. Unknown — fresh lead ────────────────────────────────────────────────
  console.log('[DB] role=lead | no match found');
  return { role: 'lead', business: null, ownerName: null };
}

/**
 * Persist a single message to the messages table.
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

'use strict';

const { supabase } = require('../../src/supabase');
const { sendMessage } = require('../../src/twilio');

/**
 * Vercel Cron endpoint — runs every minute.
 * Fetches pending reminders whose remind_at has passed, sends WhatsApp messages,
 * and marks them as sent.
 *
 * Security: Vercel injects Authorization: Bearer <CRON_SECRET> on every cron invocation.
 * Set CRON_SECRET in your Vercel project env vars.
 */
module.exports = async (req, res) => {
  // Only allow GET (Vercel cron) or POST (manual trigger)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Vercel cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) {
      console.warn('[Cron] Unauthorized request — bad or missing CRON_SECRET');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const now = new Date().toISOString();
  console.log(`[Cron] check-reminders fired at ${now}`);

  // ── Fetch due reminders ──────────────────────────────────────────────────
  const { data: reminders, error: fetchError } = await supabase
    .from('reminders')
    .select('id, sender, title, remind_at')
    .eq('status', 'pending')
    .lte('remind_at', now);

  if (fetchError) {
    console.error('[Cron] Failed to fetch reminders:', fetchError.message);
    return res.status(500).json({ error: fetchError.message });
  }

  if (!reminders?.length) {
    console.log('[Cron] No reminders due.');
    return res.json({ sent: 0, failed: 0, total: 0 });
  }

  console.log(`[Cron] ${reminders.length} reminder(s) due — processing…`);

  let sent = 0;
  let failed = 0;

  for (const reminder of reminders) {
    try {
      // Ensure sender is in "whatsapp:+972..." format
      const to = reminder.sender.startsWith('whatsapp:')
        ? reminder.sender
        : `whatsapp:${reminder.sender}`;

      const formattedTime = new Date(reminder.remind_at).toLocaleString('he-IL', {
        timeZone: 'Asia/Jerusalem',
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit',
      });

      await sendMessage(to, `🔔 תזכורת: ${reminder.title}\n(נקבעה ל-${formattedTime})`);

      const { error: updateError } = await supabase
        .from('reminders')
        .update({ status: 'sent' })
        .eq('id', reminder.id);

      if (updateError) {
        console.error(`[Cron] Failed to mark reminder ${reminder.id} as sent:`, updateError.message);
      }

      sent++;
      console.log(`[Cron] Sent → id=${reminder.id} to="${to}" title="${reminder.title}"`);
    } catch (err) {
      failed++;
      console.error(`[Cron] Error on reminder id=${reminder.id}:`, err.message);

      // Mark as failed so it won't retry infinitely — update notes or leave pending?
      // We leave it pending so the next cron tick retries (transient Twilio errors).
    }
  }

  console.log(`[Cron] Done — sent=${sent} failed=${failed}`);
  return res.json({ sent, failed, total: reminders.length });
};

'use strict';

/**
 * src/actions.js
 *
 * All native Botigo skills — executed directly against Supabase.
 * Each action:
 *   - Accepts a flat input object (from Claude's tool_use block)
 *   - Receives an optional `context` object injected by the dispatcher
 *     (contains businessId so Claude doesn't have to know it)
 *   - Returns { success: boolean, message: string, data?: any }
 *
 * Adding a new skill: add one entry to ACTIONS and one to TOOL_DEFINITIONS.
 */

const { supabase } = require('./supabase');
const { sendMessage } = require('./twilio');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ok  = (message, data = null) => ({ success: true,  message, data });
const err = (message, data = null) => ({ success: false, message, data });

function resolveBusinessId(input, context) {
  return input.business_id || context?.businessId || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

const ACTIONS = {

  // ── Leads / CRM ────────────────────────────────────────────────────────────

  /**
   * Save a new lead collected during the conversation.
   */
  async register_lead(input, context) {
    const business_id = resolveBusinessId(input, context);
    const { name, phone, notes } = input;

    console.log(`[Actions] register_lead START → name="${name}" phone="${phone}" business_id="${business_id ?? 'NULL'}" context=${JSON.stringify(context)}`);

    if (!name) return err('name is required to register a lead.');

    const payload = {
      name,
      phone:       phone       || null,
      notes:       notes       || null,
      business_id: business_id || null,
    };
    console.log(`[Actions] register_lead INSERT payload=${JSON.stringify(payload)}`);

    const { data, error } = await supabase
      .from('leads')
      .insert(payload)
      .select('id')
      .single();

    if (error) {
      console.error(
        `[Actions] register_lead FAILED → ` +
        `code="${error.code}" ` +
        `message="${error.message}" ` +
        `details="${error.details}" ` +
        `hint="${error.hint}" ` +
        `full=${JSON.stringify(error)}`
      );
      return err(`שגיאה ברישום הליד: ${error.message} (code: ${error.code})`);
    }

    console.log(`[Actions] register_lead SUCCESS → lead_id="${data.id}"`);
    return ok(`ליד "${name}" נרשם בהצלחה ✅`, { lead_id: data.id });
  },

  /**
   * Update the status of an existing lead.
   */
  async update_lead_status(input, context) {
    const { lead_id, phone, status, notes } = input;
    const validStatuses = ['new', 'contacted', 'qualified', 'closed_won', 'closed_lost'];
    if (!validStatuses.includes(status)) {
      return err(`סטטוס לא חוקי. אפשרויות: ${validStatuses.join(', ')}`);
    }

    let query = supabase.from('leads').update({ status, ...(notes ? { notes } : {}) });
    if (lead_id) query = query.eq('id', lead_id);
    else if (phone) query = query.eq('phone', phone);
    else return err('נדרש lead_id או phone.');

    const { error, count } = await query;
    if (error) return err(`עדכון נכשל: ${error.message}`);
    if (count === 0) return err('ליד לא נמצא.');
    return ok(`סטטוס עודכן ל-"${status}" ✅`);
  },

  /**
   * Return recent leads for the business (optionally filtered by status).
   */
  async get_leads(input, context) {
    const business_id = resolveBusinessId(input, context);
    if (!business_id) return err('לא ניתן לאחזר לידים ללא business_id.');

    let query = supabase
      .from('leads')
      .select('id, name, phone, status, notes, created_at')
      .eq('business_id', business_id)
      .order('created_at', { ascending: false })
      .limit(input.limit || 10);

    if (input.status) query = query.eq('status', input.status);

    const { data, error } = await query;
    if (error) return err(`שגיאה בשליפת לידים: ${error.message}`);
    if (!data.length) return ok('לא נמצאו לידים.', []);

    const lines = data.map(
      (l) =>
        `• ${l.name}${l.phone ? ` (${l.phone})` : ''} — ${l.status}` +
        (l.notes ? ` | ${l.notes}` : '')
    );
    return ok(`נמצאו ${data.length} לידים:\n${lines.join('\n')}`, data);
  },

  // ── Appointments ───────────────────────────────────────────────────────────

  /**
   * Book a new appointment.
   */
  async book_appointment(input, context) {
    const business_id = resolveBusinessId(input, context);
    const { customer_name, customer_phone, service, date, time, notes } = input;

    if (!customer_name || !date || !time) {
      return err('נדרשים: customer_name, date (YYYY-MM-DD), time (HH:MM).');
    }

    // Basic conflict check — same business, date, time, service
    const { data: existing } = await supabase
      .from('appointments')
      .select('id')
      .eq('business_id', business_id)
      .eq('appointment_date', date)
      .eq('appointment_time', time)
      .eq('status', 'confirmed')
      .maybeSingle();

    if (existing) {
      return err(`השעה ${time} בתאריך ${date} כבר תפוסה. בחר שעה אחרת.`);
    }

    const { data, error } = await supabase
      .from('appointments')
      .insert({
        business_id,
        customer_name,
        customer_phone: customer_phone || null,
        service: service || null,
        appointment_date: date,
        appointment_time: time,
        notes: notes || null,
      })
      .select('id')
      .single();

    if (error) return err(`שגיאה בקביעת תור: ${error.message}`);
    return ok(
      `תור נקבע ל-${customer_name} בתאריך ${date} בשעה ${time}${service ? ` (${service})` : ''} ✅`,
      { appointment_id: data.id }
    );
  },

  /**
   * List upcoming (or recent) appointments for the business.
   */
  async get_appointments(input, context) {
    const business_id = resolveBusinessId(input, context);
    if (!business_id) return err('לא ניתן לאחזר תורים ללא business_id.');

    const today = new Date().toISOString().split('T')[0];
    const from = input.date_from || today;
    const to   = input.date_to   || null;

    let query = supabase
      .from('appointments')
      .select('id, customer_name, customer_phone, service, appointment_date, appointment_time, status, notes')
      .eq('business_id', business_id)
      .eq('status', 'confirmed')
      .gte('appointment_date', from)
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true })
      .limit(input.limit || 10);

    if (to) query = query.lte('appointment_date', to);

    const { data, error } = await query;
    if (error) return err(`שגיאה בשליפת תורים: ${error.message}`);
    if (!data.length) return ok('אין תורים קרובים.', []);

    const lines = data.map(
      (a) =>
        `• ${a.appointment_date} ${a.appointment_time} — ${a.customer_name}` +
        (a.service ? ` | ${a.service}` : '') +
        (a.customer_phone ? ` | ${a.customer_phone}` : '')
    );
    return ok(`${data.length} תורים קרובים:\n${lines.join('\n')}`, data);
  },

  /**
   * Cancel an appointment by ID or by (phone + date).
   */
  async cancel_appointment(input, _context) {
    const { appointment_id, customer_phone, date } = input;

    let query = supabase
      .from('appointments')
      .update({ status: 'cancelled' });

    if (appointment_id) {
      query = query.eq('id', appointment_id);
    } else if (customer_phone && date) {
      query = query.eq('customer_phone', customer_phone).eq('appointment_date', date);
    } else {
      return err('נדרש appointment_id, או customer_phone + date.');
    }

    const { error } = await query;
    if (error) return err(`ביטול נכשל: ${error.message}`);
    return ok('התור בוטל בהצלחה ✅');
  },

  // ── Expenses ───────────────────────────────────────────────────────────────

  /**
   * Log a business expense.
   */
  async add_expense(input, context) {
    const business_id = resolveBusinessId(input, context);
    const { amount, category, description, date } = input;

    if (!amount || isNaN(Number(amount))) return err('נדרש סכום תקין.');

    const { error } = await supabase.from('expenses').insert({
      business_id,
      amount: Number(amount),
      category: category || null,
      description: description || null,
      expense_date: date || new Date().toISOString().split('T')[0],
    });

    if (error) return err(`שגיאה ברישום הוצאה: ${error.message}`);
    return ok(`הוצאה של ₪${amount}${category ? ` (${category})` : ''} נרשמה ✅`);
  },

  /**
   * Summarise expenses for a given period ('month', 'week', or 'all').
   */
  async get_expenses_summary(input, context) {
    const business_id = resolveBusinessId(input, context);
    if (!business_id) return err('לא ניתן לאחזר הוצאות ללא business_id.');

    const period = input.period || 'month';
    const now    = new Date();
    let from;

    if (period === 'week') {
      from = new Date(now - 7 * 86_400_000).toISOString().split('T')[0];
    } else if (period === 'month') {
      from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    } else {
      from = '2000-01-01';
    }

    const { data, error } = await supabase
      .from('expenses')
      .select('amount, category, description, expense_date')
      .eq('business_id', business_id)
      .gte('expense_date', from)
      .order('expense_date', { ascending: false });

    if (error) return err(`שגיאה בשליפת הוצאות: ${error.message}`);
    if (!data.length) return ok('לא נרשמו הוצאות בתקופה זו.', { total: 0 });

    const total = data.reduce((s, e) => s + Number(e.amount), 0);
    const byCategory = {};
    for (const e of data) {
      const cat = e.category || 'כללי';
      byCategory[cat] = (byCategory[cat] || 0) + Number(e.amount);
    }

    const catLines = Object.entries(byCategory)
      .sort(([, a], [, b]) => b - a)
      .map(([cat, sum]) => `  ${cat}: ₪${sum.toFixed(2)}`);

    return ok(
      `סיכום הוצאות (${period}):\nסה"כ: ₪${total.toFixed(2)}\n${catLines.join('\n')}`,
      { total, by_category: byCategory, items: data }
    );
  },

  // ── Outbound Messaging ─────────────────────────────────────────────────────

  /**
   * Send a WhatsApp message to any phone number on behalf of the business owner.
   */
  async send_whatsapp_message(input, _context) {
    const { to_phone, message_text } = input;

    if (!to_phone)    return err('נדרש מספר טלפון (to_phone).');
    if (!message_text) return err('נדרש תוכן הודעה (message_text).');

    // Normalise to Twilio format: whatsapp:+972XXXXXXXXX
    const normalised = to_phone.trim().startsWith('whatsapp:')
      ? to_phone.trim()
      : `whatsapp:${to_phone.trim().replace(/^0/, '+972')}`;

    console.log(`[Actions] send_whatsapp_message → to="${normalised}" text="${message_text.slice(0, 60)}…"`);

    try {
      await sendMessage(normalised, message_text);
    } catch (e) {
      console.error(`[Actions] send_whatsapp_message FAILED → ${e.message}`);
      return err(`שליחת ההודעה נכשלה: ${e.message}`);
    }

    return ok(`ההודעה נשלחה בהצלחה ל-${to_phone} ✅`);
  },

  // ── Business Overview ──────────────────────────────────────────────────────

  /**
   * Return a high-level dashboard snapshot for the business owner.
   */
  async get_business_summary(input, context) {
    const business_id = resolveBusinessId(input, context);
    if (!business_id) return err('לא ניתן לאחזר סיכום ללא business_id.');

    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.slice(0, 8) + '01'; // YYYY-MM-01

    const [leadsRes, apptRes, expRes, newLeadsRes] = await Promise.all([
      // Total leads by status
      supabase
        .from('leads')
        .select('status', { count: 'exact' })
        .eq('business_id', business_id),
      // Upcoming appointments this week
      supabase
        .from('appointments')
        .select('id', { count: 'exact' })
        .eq('business_id', business_id)
        .eq('status', 'confirmed')
        .gte('appointment_date', today),
      // Expenses this month
      supabase
        .from('expenses')
        .select('amount')
        .eq('business_id', business_id)
        .gte('expense_date', monthStart),
      // New leads this month
      supabase
        .from('leads')
        .select('id', { count: 'exact' })
        .eq('business_id', business_id)
        .gte('created_at', monthStart),
    ]);

    const totalLeads   = leadsRes.count   ?? 0;
    const upcomingAppt = apptRes.count    ?? 0;
    const newLeads     = newLeadsRes.count ?? 0;
    const monthExpenses = (expRes.data || []).reduce((s, e) => s + Number(e.amount), 0);

    // Count leads by status
    const statusMap = {};
    for (const row of leadsRes.data || []) {
      statusMap[row.status] = (statusMap[row.status] || 0) + 1;
    }
    const statusLine = Object.entries(statusMap)
      .map(([s, n]) => `${s}: ${n}`)
      .join(' | ');

    const summary =
      `📊 סיכום עסקי:\n` +
      `• לידים החודש: ${newLeads} חדשים מתוך ${totalLeads} סה"כ\n` +
      (statusLine ? `• לפי סטטוס: ${statusLine}\n` : '') +
      `• תורים קרובים: ${upcomingAppt}\n` +
      `• הוצאות החודש: ₪${monthExpenses.toFixed(2)}`;

    return ok(summary, { totalLeads, newLeads, upcomingAppt, monthExpenses });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TOOL DEFINITIONS — sent verbatim to the Claude API
// ─────────────────────────────────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: 'register_lead',
    description:
      'שמור ליד חדש שנאסף במהלך השיחה. ' +
      'הפעל לאחר שאספת את שם הפנייה ומספר הטלפון.',
    input_schema: {
      type: 'object',
      properties: {
        name:  { type: 'string', description: 'שם מלא של הליד' },
        phone: { type: 'string', description: 'מספר טלפון' },
        notes: { type: 'string', description: 'הערות נוספות — צורך, תקציב, מקור וכו\'' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_lead_status',
    description: 'עדכן את סטטוס ליד קיים.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'UUID של הליד (אם ידוע)' },
        phone:   { type: 'string', description: 'מספר טלפון (חלופה ל-lead_id)' },
        status:  {
          type: 'string',
          enum: ['new', 'contacted', 'qualified', 'closed_won', 'closed_lost'],
          description: 'הסטטוס החדש',
        },
        notes: { type: 'string', description: 'הערת עדכון אופציונלית' },
      },
      required: ['status'],
    },
  },
  {
    name: 'get_leads',
    description: 'החזר רשימת לידים אחרונים לעסק, עם סינון אופציונלי לפי סטטוס.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['new', 'contacted', 'qualified', 'closed_won', 'closed_lost'],
          description: 'סינון לפי סטטוס (אופציונלי)',
        },
        limit: { type: 'number', description: 'כמות תוצאות (ברירת מחדל: 10)' },
      },
    },
  },
  {
    name: 'book_appointment',
    description:
      'קבע תור חדש ללקוח. ' +
      'אסוף שם, תאריך ושעה לפני הפעלת הכלי. ' +
      'הכלי בודק אם השעה פנויה ומונע כפילויות.',
    input_schema: {
      type: 'object',
      properties: {
        customer_name:  { type: 'string', description: 'שם הלקוח' },
        customer_phone: { type: 'string', description: 'טלפון הלקוח' },
        service:        { type: 'string', description: 'סוג השירות / הטיפול' },
        date: { type: 'string', description: 'תאריך בפורמט YYYY-MM-DD' },
        time: { type: 'string', description: 'שעה בפורמט HH:MM' },
        notes: { type: 'string', description: 'הערות נוספות' },
      },
      required: ['customer_name', 'date', 'time'],
    },
  },
  {
    name: 'get_appointments',
    description: 'הצג תורים קרובים של העסק.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'מתאריך YYYY-MM-DD (ברירת מחדל: היום)' },
        date_to:   { type: 'string', description: 'עד תאריך YYYY-MM-DD (אופציונלי)' },
        limit:     { type: 'number', description: 'כמות תוצאות (ברירת מחדל: 10)' },
      },
    },
  },
  {
    name: 'cancel_appointment',
    description: 'בטל תור קיים.',
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string', description: 'UUID של התור (אם ידוע)' },
        customer_phone: { type: 'string', description: 'טלפון לקוח (חלופה ל-appointment_id)' },
        date: { type: 'string', description: 'תאריך התור YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'add_expense',
    description: 'רשום הוצאה עסקית.',
    input_schema: {
      type: 'object',
      properties: {
        amount:      { type: 'number', description: 'סכום ב-₪' },
        category:    { type: 'string', description: 'קטגוריה (שיווק, שכירות, ציוד...)' },
        description: { type: 'string', description: 'תיאור קצר' },
        date: { type: 'string', description: 'תאריך ההוצאה YYYY-MM-DD (ברירת מחדל: היום)' },
      },
      required: ['amount'],
    },
  },
  {
    name: 'get_expenses_summary',
    description: 'סיכום הוצאות לפי תקופה.',
    input_schema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['week', 'month', 'all'],
          description: 'התקופה לסיכום (ברירת מחדל: month)',
        },
      },
    },
  },
  {
    name: 'send_whatsapp_message',
    description:
      'שלח הודעת וואטסאפ ללקוח בשם בעל העסק. ' +
      'השתמש לאישורי פגישה, תזכורות, לינקים לתשלום, עדכון שהעבודה מוכנה, וכדומה. ' +
      'לפני שליחה — הצג למשתמש את תוכן ההודעה ובקש אישור.',
    input_schema: {
      type: 'object',
      properties: {
        to_phone: {
          type: 'string',
          description: 'מספר הטלפון של הנמען — פורמט ישראלי (052...) או בינלאומי (+972...)',
        },
        message_text: {
          type: 'string',
          description: 'תוכן ההודעה שתישלח',
        },
      },
      required: ['to_phone', 'message_text'],
    },
  },
  {
    name: 'get_business_summary',
    description:
      'החזר תמונת מצב כוללת של העסק: לידים, תורים והוצאות. ' +
      'השתמש כשבעל העסק שואל "מה קורה?" או "תן לי סיכום".',
    input_schema: { type: 'object', properties: {} },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — called from claude.js for every tool_use block
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} toolName
 * @param {object} input      Raw input from Claude's tool_use block
 * @param {object} context    { businessId: string|null }
 * @returns {Promise<{ success: boolean, message: string, data?: any }>}
 */
async function dispatch(toolName, input, context = {}) {
  const action = ACTIONS[toolName];
  if (!action) {
    console.warn(`[Actions] dispatch → unknown tool "${toolName}"`);
    return { success: false, message: `פעולה לא מוכרת: "${toolName}"` };
  }
  try {
    const result = await action(input, context);
    if (!result.success) {
      console.error(`[Actions] dispatch "${toolName}" returned failure → ${result.message}`);
    }
    return result;
  } catch (e) {
    console.error(`[Actions] "${toolName}" threw: ${e.message}`, e.stack);
    return { success: false, message: `שגיאה פנימית בפעולה "${toolName}": ${e.message}` };
  }
}

module.exports = { TOOL_DEFINITIONS, dispatch };

/* SIM Package Management — server-side reminder logic.
   Used by api/sim-reminders.js (Vercel Function). Files under api/_lib are NOT exposed as URLs.
   No npm dependencies: talks to Supabase REST and the Telegram Bot API with fetch(). */
'use strict';

const TZ = 'Asia/Riyadh'; // Saudi Arabia (UTC+3, no daylight saving)
const MAX_ATTEMPTS = 5;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ---------------- dates (always Saudi Arabia calendar date) ---------------- */
function ksaDate(now = new Date()) {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').slice(0, 10));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
function addDays(day, n) {
  const t = parseDay(day);
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}
function daysBetween(fromDay, toDay) {
  return Math.round((parseDay(toDay) - parseDay(fromDay)) / 86400000);
}
function fmtDate(day) {
  const t = parseDay(day);
  if (t == null) return '-';
  const d = new Date(t);
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

/* ---------------- reminder stages ----------------
   7 / 3 / 2 / 1 days before, on the day, and every day after expiry.
   Days 4-6 fall in the 7-day window so a SIM added (or a run missed) with e.g. 5 days
   left still gets its first reminder once — the message always shows the real days left. */
function stageFor(daysLeft) {
  if (daysLeft == null || Number.isNaN(daysLeft)) return null;
  if (daysLeft > 7) return null;
  if (daysLeft >= 4) return 'd7';
  if (daysLeft === 3) return 'd3';
  if (daysLeft === 2) return 'd2';
  if (daysLeft === 1) return 'd1';
  if (daysLeft === 0) return 'd0';
  return 'overdue';
}
function reminderKey(stage, today) {
  return stage === 'overdue' ? 'overdue:' + today : stage;
}
function timeRemaining(d) {
  if (d > 1) return d + ' days';
  if (d === 1) return '1 day';
  if (d === 0) return 'Expires TODAY';
  return 'EXPIRED ' + Math.abs(d) + (d === -1 ? ' day' : ' days') + ' ago';
}
function requiredAction(d) {
  if (d > 0) return 'Please arrange package renewal.';
  if (d === 0) return 'Package expires today. Please renew it today.';
  return 'Package has expired. Renew immediately and record the renewal in the CRM.';
}
function buildMessage(sim, daysLeft) {
  const title = daysLeft < 0 ? 'SIM PACKAGE EXPIRED' : 'SIM PACKAGE EXPIRY REMINDER';
  return [
    title,
    '',
    'SIM: ' + (sim.sim_number || '-'),
    'Network: ' + (sim.network || '-'),
    'Package: ' + (sim.package_name || '-'),
    'Assigned to: ' + (sim.assigned_to || '-'),
    'Expiry: ' + fmtDate(sim.expiry_date),
    'Time Remaining: ' + timeRemaining(daysLeft),
    '',
    requiredAction(daysLeft),
  ].join('\n');
}

/* Which reminders are due today for these SIMs (pure function). */
function planReminders(sims, today) {
  const rows = [];
  for (const s of sims || []) {
    if (!s || s.status !== 'active' || !s.expiry_date) continue;
    const d = daysBetween(today, s.expiry_date);
    const stage = stageFor(d);
    if (!stage) continue;
    rows.push({
      sim_id: s.id,
      sim_number: s.sim_number,
      expiry_date: String(s.expiry_date).slice(0, 10),
      stage,
      reminder_key: reminderKey(stage, today),
      run_date: today,
      days_left: d,
      channel: 'telegram',
      status: 'pending',
      message: buildMessage(s, d),
    });
  }
  return rows;
}

/* ---------------- Supabase REST client (service key, server only) ---------------- */
function createDb({ url, key, fetchImpl = fetch }) {
  const base = String(url || '').replace(/\/+$/, '');
  const headers = (extra) => {
    const h = { apikey: key, 'Content-Type': 'application/json', ...extra };
    if (String(key).split('.').length === 3) h.Authorization = 'Bearer ' + key; // legacy JWT service_role key
    return h;
  };
  async function call(method, path, body, extraHeaders) {
    const r = await fetchImpl(base + path, {
      method,
      headers: headers(extraHeaders),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
    if (!r.ok) {
      const msg = (data && (data.message || data.error_description || data.error)) || text || ('HTTP ' + r.status);
      const e = new Error('Supabase ' + method + ' ' + path.split('?')[0] + ' failed: ' + msg);
      e.status = r.status;
      throw e;
    }
    return data;
  }
  const enc = encodeURIComponent;
  return {
    activeSimsDueBy(lastDay) {
      return call('GET', '/rest/v1/sim_cards?select=*&status=eq.active&expiry_date=not.is.null&expiry_date=lte.' + enc(lastDay) + '&order=expiry_date.asc');
    },
    insertReminders(rows) {
      if (!rows.length) return Promise.resolve([]);
      return call('POST', '/rest/v1/sim_notifications?on_conflict=sim_id,expiry_date,reminder_key', rows,
        { Prefer: 'resolution=ignore-duplicates,return=representation' });
    },
    listOpen(sinceDay) {
      return call('GET', '/rest/v1/sim_notifications?select=*&status=in.(pending,failed)&attempts=lt.' + MAX_ATTEMPTS +
        '&run_date=gte.' + enc(sinceDay) + '&stage=neq.test&order=created_at.asc');
    },
    async claim(id, fromStatus) {
      const rows = await call('PATCH', '/rest/v1/sim_notifications?id=eq.' + enc(id) + '&status=eq.' + enc(fromStatus),
        { status: 'sending' }, { Prefer: 'return=representation' });
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
    update(id, patch) {
      return call('PATCH', '/rest/v1/sim_notifications?id=eq.' + enc(id), patch, { Prefer: 'return=minimal' });
    },
    insertLog(row) {
      return call('POST', '/rest/v1/sim_notifications', row, { Prefer: 'return=minimal' });
    },
    async getUser(accessToken) {
      const r = await fetchImpl(base + '/auth/v1/user', { headers: { apikey: key, Authorization: 'Bearer ' + accessToken } });
      if (!r.ok) return null;
      const u = await r.json().catch(() => null);
      return u && u.id ? u : null;
    },
    async getProfile(uid) {
      const rows = await call('GET', '/rest/v1/profiles?select=id,role,active&id=eq.' + enc(uid));
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
  };
}

/* ---------------- Telegram ---------------- */
function createTelegram({ token, chatIds, fetchImpl = fetch, retryDelayMs = 1500 }) {
  const ids = String(chatIds || '').split(',').map((s) => s.trim()).filter(Boolean);
  const configured = !!(token && ids.length);
  const api = (method) => 'https://api.telegram.org/bot' + token + '/' + method;
  return {
    configured,
    hasToken: !!token,
    chatCount: ids.length,
    async send(text) {
      if (!configured) return { ok: false, error: 'Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing)' };
      const errors = [];
      for (const chat_id of ids) {
        let last = '';
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const r = await fetchImpl(api('sendMessage'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id, text, disable_web_page_preview: true }),
            });
            const j = await r.json().catch(() => ({}));
            if (r.ok && j.ok) { last = ''; break; }
            last = j.description || ('HTTP ' + r.status);
            if (r.status >= 400 && r.status < 500 && r.status !== 429) break; // wrong token/chat: retrying won't help
          } catch (e) {
            last = e && e.message ? e.message : String(e);
          }
          if (attempt === 1 && retryDelayMs) await new Promise((ok) => setTimeout(ok, retryDelayMs));
        }
        if (last) errors.push('chat ' + chat_id + ': ' + last);
      }
      return errors.length ? { ok: false, error: errors.join('; ').slice(0, 900) } : { ok: true };
    },
    async getChats() {
      if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not set' };
      const r = await fetchImpl(api('getUpdates'));
      const j = await r.json().catch(() => ({}));
      if (!j.ok) return { ok: false, error: j.description || ('HTTP ' + r.status) };
      const seen = new Map();
      for (const u of j.result || []) {
        const m = u.message || u.channel_post || u.my_chat_member || u.edited_message;
        const c = m && m.chat;
        if (c && !seen.has(c.id)) seen.set(c.id, { id: String(c.id), type: c.type, name: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '' });
      }
      return { ok: true, chats: [...seen.values()] };
    },
  };
}

/* ---------------- the daily job ---------------- */
async function runReminders({ db, telegram, now = new Date(), dryRun = false }) {
  const today = ksaDate(now);
  const sims = await db.activeSimsDueBy(addDays(today, 7));
  const planned = planReminders(sims, today);
  const summary = {
    today, timezone: TZ, checked: sims.length, due: planned.length,
    created: 0, sent: 0, failed: 0, waiting: 0, cancelled: 0,
    telegramConfigured: telegram.configured, dryRun,
  };
  if (dryRun) {
    summary.preview = planned.map((p) => ({ sim_number: p.sim_number, stage: p.stage, days_left: p.days_left, expiry_date: p.expiry_date }));
    return summary;
  }

  const inserted = await db.insertReminders(planned);
  summary.created = Array.isArray(inserted) ? inserted.length : 0;

  const simById = new Map(sims.map((s) => [s.id, s]));
  const open = await db.listOpen(addDays(today, -2));
  for (const n of open) {
    const sim = simById.get(n.sim_id);
    let stale = '';
    if (n.run_date !== today) stale = 'Superseded by a newer reminder';
    else if (!sim) stale = 'SIM no longer active or no longer due';
    else if (String(sim.expiry_date).slice(0, 10) !== n.expiry_date) stale = 'Expiry date changed / package renewed';
    if (stale) {
      await db.update(n.id, { status: 'cancelled', last_error: stale });
      summary.cancelled++;
      continue;
    }
    if (!telegram.configured) {
      if (n.last_error !== 'Waiting: Telegram not configured') await db.update(n.id, { last_error: 'Waiting: Telegram not configured' });
      summary.waiting++;
      continue;
    }
    const claimed = await db.claim(n.id, n.status);
    if (!claimed) continue; // another run already took it
    const res = await telegram.send(n.message || buildMessage(sim, n.days_left));
    if (res.ok) {
      await db.update(n.id, { status: 'sent', sent_at: new Date().toISOString(), attempts: (n.attempts || 0) + 1, last_error: null });
      summary.sent++;
    } else {
      await db.update(n.id, { status: 'failed', attempts: (n.attempts || 0) + 1, last_error: String(res.error).slice(0, 900) });
      summary.failed++;
    }
  }
  return summary;
}

module.exports = {
  TZ, MAX_ATTEMPTS, ksaDate, addDays, daysBetween, fmtDate, stageFor, reminderKey,
  timeRemaining, requiredAction, buildMessage, planReminders, createDb, createTelegram, runReminders,
};

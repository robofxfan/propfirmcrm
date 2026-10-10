/* SIM Package Management — scheduled + manual reminder endpoint (Vercel Function).

   GET  /api/sim-reminders    → called daily by Vercel Cron (see vercel.json).
                                Requires header  Authorization: Bearer <CRON_SECRET>
                                (Vercel adds it automatically when CRON_SECRET is set).
   POST /api/sim-reminders    → used by the CRM "SIM Settings" page.
                                Requires the logged-in user's Supabase access token, and the
                                user must have role 'admin' or 'sim' (and be active).
        body { action: "status" | "run" | "test" | "chat_ids", dryRun?: boolean }

   Environment variables (Vercel → Project → Settings → Environment Variables):
     SUPABASE_SERVICE_ROLE_KEY  (required) Supabase secret / service_role key — server only, never in index.html
     CRON_SECRET                (required) long random string; protects the scheduled run
     TELEGRAM_BOT_TOKEN         (for Telegram) token from @BotFather
     TELEGRAM_CHAT_ID           (for Telegram) your chat id; several allowed, comma separated
     SUPABASE_URL               (optional) defaults to this CRM's Supabase project URL
*/
'use strict';

const crypto = require('crypto');
const core = require('./_lib/sim-core');

const DEFAULT_SUPABASE_URL = 'https://okboevgdwitubhqzfhaa.supabase.co'; // public, same as index.html
const SCHEDULE_NOTE = 'Daily, 09:00-09:59 Saudi time (vercel.json: "0 6 * * *" UTC)';
const ALLOWED_ROLES = ['admin', 'sim'];

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function readEnv(env) {
  return {
    url: env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '',
    cronSecret: env.CRON_SECRET || '',
    tgToken: env.TELEGRAM_BOT_TOKEN || '',
    tgChats: env.TELEGRAM_CHAT_ID || '',
  };
}

/* Framework-free core so it can be unit tested: returns { status, body }. */
async function handle({ method, headers, body }, env, deps = {}) {
  const cfg = readEnv(env);
  const fetchImpl = deps.fetchImpl || fetch;
  const now = deps.now || new Date();
  const auth = String(headers.authorization || headers.Authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  if (method !== 'GET' && method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };

  const missing = [];
  if (!cfg.serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!cfg.cronSecret) missing.push('CRON_SECRET');

  const isCron = !!cfg.cronSecret && safeEqual(token, cfg.cronSecret);

  if (method === 'GET') {
    if (!cfg.cronSecret) return { status: 500, body: { error: 'Server not configured', missing } };
    if (!isCron) return { status: 401, body: { error: 'Unauthorized' } };
  }
  if (!cfg.serviceKey) return { status: 500, body: { error: 'Server not configured', missing } };

  const db = (deps.makeDb || core.createDb)({ url: cfg.url, key: cfg.serviceKey, fetchImpl });
  const telegram = (deps.makeTelegram || core.createTelegram)({ token: cfg.tgToken, chatIds: cfg.tgChats, fetchImpl, retryDelayMs: deps.retryDelayMs });

  // POST from the CRM: verify the user session and role
  if (method === 'POST' && !isCron) {
    if (!token) return { status: 401, body: { error: 'Login required' } };
    const user = await db.getUser(token);
    if (!user) return { status: 401, body: { error: 'Session expired. Please log in again.' } };
    const prof = await db.getProfile(user.id);
    if (!prof || prof.active === false || !ALLOWED_ROLES.includes(prof.role)) {
      return { status: 403, body: { error: 'Not allowed: SIM module is for admin / sim users only' } };
    }
  }

  let payload = body;
  if (typeof payload === 'string') { try { payload = JSON.parse(payload || '{}'); } catch (_) { payload = {}; } }
  payload = payload || {};
  const action = method === 'GET' ? 'run' : String(payload.action || 'status');

  try {
    if (action === 'status') {
      return { status: 200, body: {
        ok: true, today: core.ksaDate(now), timezone: core.TZ, schedule: SCHEDULE_NOTE,
        telegramConfigured: telegram.configured, telegramTokenSet: telegram.hasToken, telegramChats: telegram.chatCount,
        cronSecretSet: !!cfg.cronSecret, missing,
      } };
    }
    if (action === 'run') {
      const summary = await core.runReminders({ db, telegram, now, dryRun: !!payload.dryRun });
      return { status: 200, body: { ok: true, trigger: isCron ? 'cron' : 'manual', ...summary } };
    }
    if (action === 'test') {
      const text = 'TEST MESSAGE - SIM Package Management\n\nTelegram reminders from Prop Firm CRM are working.\nSent: ' +
        new Intl.DateTimeFormat('en-GB', { timeZone: core.TZ, dateStyle: 'long', timeStyle: 'short' }).format(now) + ' (Saudi time)';
      const res = await telegram.send(text);
      await db.insertLog({
        stage: 'test', reminder_key: 'test:' + now.toISOString() + ':' + crypto.randomBytes(3).toString('hex'),
        run_date: core.ksaDate(now), channel: 'telegram', status: res.ok ? 'sent' : 'failed', attempts: 1,
        last_error: res.ok ? null : String(res.error).slice(0, 900), message: text, sent_at: res.ok ? now.toISOString() : null,
      }).catch(() => {});
      return { status: res.ok ? 200 : 502, body: res.ok ? { ok: true } : { ok: false, error: res.error } };
    }
    if (action === 'chat_ids') {
      const res = await telegram.getChats();
      return { status: res.ok ? 200 : 502, body: res };
    }
    return { status: 400, body: { error: 'Unknown action' } };
  } catch (e) {
    return { status: 500, body: { ok: false, error: e && e.message ? e.message : String(e) } };
  }
}

module.exports = async function handler(req, res) {
  const out = await handle({ method: req.method, headers: req.headers || {}, body: req.body }, process.env);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = out.status;
  res.end(JSON.stringify(out.body));
};
module.exports.handle = handle;

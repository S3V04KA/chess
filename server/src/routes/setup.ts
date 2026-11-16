import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import { db, userCount, setSetting } from '../db.js';
import { config } from '../config.js';
import { hashPassword } from '../auth/passwords.js';
import { createSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '../auth/sessions.js';

const router = new Hono();

// In SSO-only mode there's no wizard: nobody could use the local password it
// asks for. The web app goes straight to the login page, and the first SSO
// login creates the admin (see prepareSsoOnlyFirstRun in auth/oidc.ts).
router.get('/status', (c) => {
  return c.json({ setup_required: userCount() === 0 && !config.oidc.only });
});

const setupSchema = z.object({
  username: z.string().trim().min(2).max(40),
  // 10-char minimum is reachable for non-technical family members but cuts off
  // the worst dictionary attacks. Pair with bcrypt cost 12 (passwords.ts).
  password: z.string().min(10).max(200),
  display_name: z.string().trim().min(1).max(60),
  language: z.enum(['en', 'bg', 'es', 'de', 'ru']).default('en'),
});

router.post('/init', async (c) => {
  if (userCount() > 0) return c.json({ error: 'already_initialized' }, 409);
  if (config.oidc.only) return c.json({ error: 'password_login_disabled' }, 403);

  const body = await c.req.json().catch(() => null);
  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input', details: parsed.error.flatten() }, 400);

  const { username, password, display_name, language } = parsed.data;

  const passwordHash = await hashPassword(password);
  const insertUser = db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')`);
  const insertProfile = db.prepare(
    `INSERT INTO profiles (user_id, display_name, language, audience) VALUES (?, ?, ?, 'intermediate')`
  );

  // The naive `userCount() > 0` check above races with concurrent /init calls:
  // two attackers reaching the freshly-deployed instance can both pass the
  // check before either commits. better-sqlite3's transaction() acquires an
  // immediate lock, so re-checking userCount() inside the tx is atomic.
  let userId: number | null = null;
  try {
    userId = db.transaction(() => {
      if (userCount() > 0) throw new Error('already_initialized');
      const result = insertUser.run(username, passwordHash);
      const id = Number(result.lastInsertRowid);
      insertProfile.run(id, display_name, language);
      return id;
    })();
  } catch (err) {
    if ((err as Error).message === 'already_initialized') return c.json({ error: 'already_initialized' }, 409);
    throw err;
  }

  setSetting('default_language', language);

  if (userId === null) return c.json({ error: 'init_failed' }, 500);
  const cookie = createSession(userId);
  setCookie(c, SESSION_COOKIE_NAME, cookie, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: config.cookieSecure,
  });

  return c.json({ ok: true });
});

export default router;

import bcrypt from 'bcrypt';
import { z } from 'zod';
import { pool } from '../src/config/db.js';
import { env } from '../src/utils/env.js';

const argsSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8).max(72),
});

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    const [k, ...rest] = raw.split('=');
    if (!k) continue;
    args[k.replace(/^--/, '')] = rest.join('=');
  }
  return argsSchema.parse(args);
}

async function main() {
  const { name, email, password } = parseArgs(process.argv);

  if (env.JWT_SECRET.startsWith('change_me')) {
    // eslint-disable-next-line no-console
    console.warn('[warn] JWT_SECRET is still default; set it in backend/.env for production.');
  }

  const [existing] = await pool.query('SELECT id, role FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing?.length) {
    // eslint-disable-next-line no-console
    console.log(`[skip] user already exists: id=${existing[0].id}, role=${existing[0].role}`);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await pool.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', [
    name,
    email,
    passwordHash,
    'admin',
  ]);

  // eslint-disable-next-line no-console
  console.log(`[ok] created admin user id=${result.insertId} email=${email}`);
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


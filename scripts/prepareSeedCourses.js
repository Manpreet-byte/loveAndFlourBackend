import fs from 'node:fs/promises';
import path from 'node:path';

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const backendRoot = process.cwd();
  const destDir = path.join(backendRoot, 'seed');
  const destPath = path.join(destDir, 'courses.json');

  const candidates = [
    process.env.SEED_COURSES_PATH ? path.resolve(process.env.SEED_COURSES_PATH) : null,
    path.join(backendRoot, '..', 'frontend', 'loveAndFlour', 'src', 'data', 'seed', 'courses.json'),
    path.join(backendRoot, '..', 'frontend', 'frontend', 'loveAndFlour', 'src', 'data', 'seed', 'courses.json'),
  ].filter(Boolean);

  let srcPath = null;
  for (const p of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await exists(p)) {
      srcPath = p;
      break;
    }
  }

  if (!srcPath) return;
  await fs.mkdir(destDir, { recursive: true });
  const buf = await fs.readFile(srcPath);
  await fs.writeFile(destPath, buf);
  // eslint-disable-next-line no-console
  console.log(`[prepareSeedCourses] wrote ${destPath} from ${srcPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[prepareSeedCourses] failed', err);
  process.exitCode = 0; // non-fatal
});


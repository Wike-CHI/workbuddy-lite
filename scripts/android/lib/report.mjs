import { open } from 'node:fs/promises';

export function parseArgs(args, values = [], flags = []) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || Object.hasOwn(result, key)) throw new Error('invalid arguments');
    if (flags.includes(key)) result[key] = true;
    else if (values.includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) result[key] = args[++i];
    else throw new Error('invalid arguments');
  }
  return result;
}

export async function saveReport(report, path) {
  const data = JSON.stringify(report, null, 2) + '\n';
  if (path) {
    // Exclusive create prevents following symlinks or overwriting an existing report.
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(data); } finally { await file.close(); }
  }
  process.stdout.write(data);
}

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { saveReport, parseArgs } from './lib/report.mjs';

function inspect(command, args) {
  try {
    return { ok: true, text: execFileSync(command, args, {
      encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }) };
  } catch { return { ok: false, text: '' }; }
}

export function diagnose() {
  const termux = process.env.PREFIX === '/data/data/com.termux/files/usr';
  const git = inspect('git', ['--version']);
  const npm = inspect('npm', ['--version']);
  const cli = inspect('codebuddy', ['--version']);
  const help = inspect('codebuddy', ['--help']);
  const android = inspect('getprop', ['ro.build.version.release']);
  let externalApps = 'unknown';
  try {
    const props = readFileSync(`${homedir()}/.termux/termux.properties`, 'utf8');
    const values = [...props.matchAll(/^\s*allow-external-apps\s*=\s*(true|false)\s*(?:#.*)?$/gm)];
    externalApps = values.length ? values.at(-1)[1] : 'false';
  } catch { /* Missing config is not permission evidence. */ }
  // Only allowlisted version fragments leave this process; never dump CLI output/env.
  const version = r => r.text.match(/\b\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.-]+)?\b/)?.[0] ?? null;
  const checks = { termux, arm64: process.arch === 'arm64', nodeSupported: Number(process.versions.node.split('.')[0]) >= 22,
    npm: npm.ok, git: git.ok, cli: cli.ok, serveFlag: help.ok && /--serve\b/.test(help.text) };
  return { schemaVersion: 1, kind: 'doctor', at: new Date().toISOString(),
    platform: process.platform, arch: process.arch,
    android: android.text.trim().match(/^\d+(?:\.\d+)*$/)?.[0] ?? null,
    versions: { node: process.versions.node, npm: version(npm), git: version(git), codebuddy: version(cli) },
    checks, readyForSmoke: Object.values(checks).every(Boolean),
    externalApps, runCommandPermission: 'not_verified', login: 'not_verified',
    note: 'Node 22+ is the probe baseline, not a claim about the CLI minimum. Login requires an ACP probe; RUN_COMMAND requires the future Android app.' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2), ['out']);
    const report = diagnose();
    await saveReport(report, args.out);
    if (!report.readyForSmoke) process.exitCode = 1;
  } catch { console.error('Invalid arguments or unable to write doctor report. Use: node doctor.mjs [--out file]'); process.exitCode = 2; }
}

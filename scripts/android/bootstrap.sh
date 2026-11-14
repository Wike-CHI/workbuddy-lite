#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
umask 077

# Pin a version explicitly: no silent upgrade of an existing installation.
if [[ $# != 1 || ! $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo 'Usage: bash scripts/android/bootstrap.sh <exact-codebuddy-version>' >&2
  exit 2
fi
if [[ ${PREFIX:-} != /data/data/com.termux/files/usr || ! -x ${PREFIX:-}/bin/pkg ]]; then
  echo 'Run this installer inside the standard com.termux app.' >&2
  exit 2
fi
version=$1
package=@tencent-ai/codebuddy-code
if ! command -v node >/dev/null || ! command -v npm >/dev/null || ! command -v git >/dev/null; then
  pkg update
  pkg install -y nodejs-lts git
fi
echo 'Requested CLI release and Node requirements:'
npm view "$package@$version" version engines --json
installed=$(npm ls -g "$package" --depth=0 --json 2>/dev/null | node -e '
let s=""; process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>{
  try { process.stdout.write(JSON.parse(s).dependencies?.["@tencent-ai/codebuddy-code"]?.version || ""); }
  catch { process.exitCode=1; }
});' || true)
if [[ $installed != "$version" ]]; then
  # npm itself checks semver engines. Do not suppress install scripts/native failures.
  npm install -g --engine-strict "$package@$version"
fi
codebuddy --version
echo 'Installation finished. Run codebuddy in this terminal and complete official login.'
echo 'Then run: node scripts/android/doctor.mjs'
echo 'This installer does not change Termux external-app permissions or credentials.'

#!/usr/bin/env bash
# 安全编译：沿用 build.bat 的编译参数，只把输出改成 bin/workbuddy-lite.verify.exe
# 用法：bash .codebuddy/skills/wbl-build/scripts/build-verify.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

if [ ! -f "$ROOT/build.bat" ]; then
  echo "[x] 找不到 $ROOT/build.bat，确认脚本位于 .codebuddy/skills/wbl-build/scripts/"
  exit 1
fi

ROOT_WIN="$(cd "$ROOT" && pwd -W)"
TMP_DIR="${TEMP:-/tmp}"
TMP_BAT="$(cygpath -u "$TMP_DIR")/wbl-build-verify.bat"

mkdir -p "$ROOT/bin/obj"

sed -e "s|cd /d \"%~dp0\"|cd /d \"$ROOT_WIN\"|" \
    -e "s|/Fe:bin\\\\workbuddy-lite.exe|/Fe:bin\\\\workbuddy-lite.verify.exe|" \
    -e "s|echo \[+\] done: bin\\\\workbuddy-lite.exe|echo [+] done: bin\\\\workbuddy-lite.verify.exe|" \
    "$ROOT/build.bat" > "$TMP_BAT"

echo "[*] 生成 $TMP_BAT"
echo "[*] 输出 bin/workbuddy-lite.verify.exe"

set +e
cmd //c "$(cygpath -w "$TMP_BAT")"
code=$?
set -e

if [ $code -ne 0 ]; then
  echo "[x] 编译失败（exit=$code）。若是 LNK1104，说明 exe 被占用，不要结束进程，检查编译错误本身。"
  exit $code
fi

OUT="$ROOT/bin/workbuddy-lite.verify.exe"
if [ ! -f "$OUT" ]; then
  echo "[x] 编译返回成功但没有找到 $OUT"
  exit 1
fi

echo "[+] 完成：bin/workbuddy-lite.verify.exe（$(date -r "$OUT" '+%H:%M:%S')）"

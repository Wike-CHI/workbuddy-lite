#!/usr/bin/env bash
# demo 模式截图：shot.sh <名字> "<eval js>" [wait_ms]
# 产物：bin/visual/<名字>.png；数据目录：bin/_workspace/_run-data（与用户实例隔离）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

NAME="${1:?用法: shot.sh <名字> \"<eval js>\" [wait_ms]}"
JS="${2:?缺少 --eval 脚本，传空串也要显式给 \"\"}"
WAIT="${3:-2400}"

VERIFY="$ROOT/bin/workbuddy-lite.verify.exe"
FALLBACK="$ROOT/bin/workbuddy-lite.exe"
if [ -f "$VERIFY" ]; then
  EXE="$VERIFY"
elif [ -f "$FALLBACK" ]; then
  EXE="$FALLBACK"
  echo "[!] 没有 verify exe，退回 bin/workbuddy-lite.exe（确认该实例没在跑）"
else
  echo "[x] 没有可用的 exe，先跑 .codebuddy/skills/wbl-build/scripts/build-verify.sh"
  exit 1
fi

DATA="$ROOT/bin/_workspace/_run-data"
OUT="$ROOT/bin/visual/$NAME.png"
mkdir -p "$DATA" "$ROOT/bin/visual"
rm -f "$OUT"

WORKBUDDY_LITE_DATA="$(cygpath -w "$DATA")" "$EXE" \
  --demo \
  --cwd "$(cygpath -w "$ROOT")" \
  --eval "$JS" \
  --wait "$WAIT" \
  --shot "$(cygpath -w "$OUT")"

if [ ! -s "$OUT" ]; then
  echo "[x] 没有生成截图：$OUT（查看 $DATA/app.log 的 capture 行）"
  exit 1
fi

echo "[+] 截图：bin/visual/$NAME.png"

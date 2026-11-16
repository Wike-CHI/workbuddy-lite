"""用 browser-use 跑一个浏览器任务（隔离 venv 里调用）。

示例：
  python browser_use_agent.py "在 GitHub 上看 browser-use 有多少 star" --browser chrome
  python browser_use_agent.py "打开 localhost:5173 点登录" --browser chromium --headless
"""

import argparse
import json
import sys


def build_browser(kind: str, profile: str, headless: bool, cdp: str):
    from browser_use import Browser

    if cdp:
        return Browser("chrome", cdp_url=cdp)
    if kind == "chrome":
        if profile:
            return Browser("chrome", profile=profile)
        return Browser("chrome")
    if kind == "chromium":
        return Browser("chromium", headless=headless)
    return Browser()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("task", nargs="?")
    parser.add_argument("--browser", default="chrome", choices=["chrome", "chromium", "cloud"])
    parser.add_argument("--profile", default="")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--max-steps", type=int, default=30)
    parser.add_argument("--timeout", type=float, default=600)
    parser.add_argument("--model", default="")
    parser.add_argument("--cdp", default="", help="例如 http://127.0.0.1:9222，直接连一个已开调试端口的 Chrome")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()

    if args.selftest:
        import browser_use

        print(json.dumps({"ok": True, "version": getattr(browser_use, "__version__", "?")}, ensure_ascii=False))
        return 0

    if not args.task:
        parser.error("缺少任务描述")

    from browser_use import Agent

    try:
        browser = build_browser(args.browser, args.profile, args.headless, args.cdp)
        kwargs = {"browser": browser}
        if args.model:
            kwargs["llm"] = args.model
        agent = Agent(args.task, **kwargs)
        result = agent.run_sync(max_steps=args.max_steps, timeout=args.timeout)
        final = result.final_result() if hasattr(result, "final_result") else str(result)
        print(json.dumps({"ok": True, "result": final}, ensure_ascii=False))
        return 0
    except Exception as error:  # noqa: BLE001 - 命令行工具，异常直接回给调用方
        print(json.dumps({"ok": False, "error": str(error)[:2000]}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())

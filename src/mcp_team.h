// 团队工具 MCP server（stdio）。
// 作为 workbuddy-lite.exe 的隐藏模式运行：由 codebuddy CLI 在 session/new 时拉起，
// 用 JSON-RPC over stdin/stdout 暴露群聊频道 / 成员 / 人设操作。
#pragma once

namespace wbl {

// 阻塞式跑 MCP server，直到 stdin 关闭。返回进程退出码。
// stdout 只写 JSON-RPC 帧；诊断信息一律走 stderr。
int runTeamMcpServer();

}  // namespace wbl

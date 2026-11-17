// 本地能力目录：从 CodeBuddy 的配置目录里读出技能、连接器（MCP）与插件市场。
// 只读，不修改任何配置；读不到就当空列表，界面自行降级。
#pragma once

#include <string>

#include "common.h"

namespace wbl {

// cwd 用于发现项目级 .mcp.json；字段缺失时返回空数组而不是报错
json buildCatalog(const std::string& cwd);

// 插件市场概览：marketplace（来源/类型/计数）+ plugins（已安装/可安装）。
// 数据直接来自 CLI 的 known_marketplaces.json、marketplaces/*/.codebuddy-plugin/marketplace.json
// 与 installed_plugins.json，服务端不维护任何插件索引。
json buildMarketOverview();

// 列出目录下可当作工作空间的子目录（跳过 node_modules/.git 这类噪音）
json listSubdirs(const std::string& dir, int maxItems = 40);

}  // namespace wbl

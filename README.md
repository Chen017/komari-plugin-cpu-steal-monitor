# Komari CPU Steal Monitor Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Komari Version](https://img.shields.io/badge/Komari-%3E%3D1.4.3-blue)](https://github.com/komari-monitor/komari)
[![Theme Integration](https://img.shields.io/badge/Theme%20Integration-Komari%20Emerald%20Insights-emerald)](https://github.com/Chen017/komari-theme-emerald-insights)
[![Komari Emerald Ecosystem](https://img.shields.io/badge/Komari%20Emerald-Ecosystem-10b981)](https://github.com/Chen017/komari-emerald-suite)
[![CI](https://github.com/Chen017/komari-plugin-cpu-steal-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/Chen017/komari-plugin-cpu-steal-monitor/actions/workflows/ci.yml)

> [!IMPORTANT]
> **前置说明与推荐搭配**：
> 1. **可独立运行**：本插件作为 Komari 服务端后台数据采集与历史服务，每两分钟通过现有 Linux Agent 的远程命令读取 `/proc/stat`，计算 CPU Steal 率并提供历史、汇总与健康诊断 REST API。**插件可完全独立安装与运行**，不依赖特定前端主题，也无需在 VPS 额外安装常驻采集脚本；但 Agent **必须允许远程命令执行**。
> 2. **强烈推荐搭配主题**：Komari 原生前端并不提供本插件的 Steal 历史可视化。**强烈推荐搭配安装 [Komari Emerald Insights（翡翠洞察）](https://github.com/Chen017/komari-theme-emerald-insights)**，在节点详情现有 CPU / 系统负载图中显示 Steal（2 分钟均值）曲线，并共享实时与历史时间轴。未安装本插件时，主题原有 CPU、负载等图表保持正常。

---

## 核心特性

- **真实 CPU Steal 采样**：读取 Linux `/proc/stat` 的累计计数器，使用相邻成功采样之间的 `Δsteal / Δtotal × 100%` 计算 Steal 百分比，默认每 2 分钟采集一次。
- **独立数据服务**：无须安装主题即可使用 `/v1/history` 查询样本、`/v1/summary` 查询最新值/平均值/最大值/覆盖率、管理员 `/v1/health` 检查采集状态。
- **正确处理无数据**：初次采样只建立基线；Agent 离线、任务失败、计数器重置或漏采集形成未知区间，**不将缺失值误认为 0%**。
- **长期持久化**：使用 Komari 提供的 `__storageDir__` 存储历史，默认保留至多 90 天；重启后保留已采集历史。
- **适配 Komari Emerald Insights**：稳定提供 `GET /api/plugin/cpu-steal-monitor/v1/history`，主题按实际采样时间范围对齐原生时间轴，Steal 与 CPU/负载同图展示。
- **只读权限边界**：Agent 命令由插件固定，仅读取 `/proc/stat`；匿名访问遵循公共站点与隐藏节点规则，健康诊断仅供管理员访问。

> [!NOTE]
> Steal 是虚拟机等待宿主机分配 CPU 时间的比例，单位是 **%**，与没有百分比单位的 Linux Load Average 不同。插件的“独立运行”是指**采集、持久化和 API 独立**；插件本身不额外提供网页图表或消息告警。

---

## Komari Emerald Insights 集成

推荐搭配 [Komari Emerald Insights](https://github.com/Chen017/komari-theme-emerald-insights) 使用，可在节点详情原有 CPU/系统负载图中查看 Steal 率。

- **调用接口**：`GET /api/plugin/cpu-steal-monitor/v1/history?uuid=...&from=...&to=...`
- **时间轴兼容**：每条采样携带真实 Unix 毫秒 `from` / `time`，代表该两分钟区间的平均 Steal%；历史时间桶按采样区间实际重叠时长聚合，不构造虚假的秒级数据。
- **图表纵轴**：Steal 与 CPU 共用左侧 0–100% 纵轴；负载使用独立右侧纵轴。较小的 0.1%–1% 变化在当前图中可能不明显，但提示框可显示具体数值。
- **优雅降级**：未安装插件、API 返回错误或节点尚无采样时，Steal 显示缺失值，不影响主题原有 CPU、系统负载及其他监控。
- **独立模式**：如果只需要 Steal 数据供脚本或第三方系统消费，**无需安装 Emerald Insights 主题**，直接查询下述 REST API 即可。

---

## 安装方式

1. 从本仓库 [GitHub Actions](https://github.com/Chen017/komari-plugin-cpu-steal-monitor/actions/workflows/ci.yml) 的成功构建中下载 `komari-cpu-steal-monitor` Artifact，解压外层 Artifact ZIP，取出真正的 **`cpu-steal-monitor.zip`**。正式发布 Release 后，也可以从 Releases 直接下载同名插件 ZIP。
2. 登录 Komari 管理后台，在 **「插件管理」** 上传 `cpu-steal-monitor.zip` 并启用，批准 `node`、`allowSystemRPC`、`allowRoutes` 权限。
3. 确保待监控 VPS 使用 Linux，且 Komari Agent **允许远程命令执行**。启用 `disable_web_ssh` / `--disable-web-ssh` 可能同时禁止此能力，导致插件无法采样。
4. 插件安装后将自动启动两分钟采集。**首次采样仅建立基线**，需要下一次成功采样才会产生 Steal 数据。
5. 如需前端图表联动，在 Komari **「主题管理」** 另行安装配套 Emerald Insights 主题 ZIP；不要把主题 ZIP 上传到插件管理。

---

## 管理页面与配置项

插件管理页面增加**只读的「前置说明与推荐搭配」信息区域**，参照 Availability History 的说明风格，介绍插件独立采集、REST API 和推荐的 Komari Emerald Insights（翡翠洞察）主题；**没有开关、输入框或其他可调配置项**。管理页提供可点击的 [插件仓库](https://github.com/Chen017/komari-plugin-cpu-steal-monitor)、[插件 Releases](https://github.com/Chen017/komari-plugin-cpu-steal-monitor/releases) 和 [Emerald Insights 主题仓库](https://github.com/Chen017/komari-theme-emerald-insights)，方便检查源码、下载安装包和安装配套主题。此信息并非要求安装主题：插件独立运行不受影响。

当前版本**没有开放用户可调的采样周期或历史保留时间配置**，与支持托管配置的 Availability History 不同。

| 项目 | 当前值 | 说明 |
| :--- | :--- | :--- |
| 采样周期 | 120 秒 | cron：`*/2 * * * *` |
| 历史保留 | 最多 90 天 | 自动清理历史数据；并设有每节点样本数量上限 |
| 采样命令 | 固定只读 | 通过 Komari Agent 读取 Linux `/proc/stat` |
| 插件权限 | `node`、`allowSystemRPC`、`allowRoutes` | 需在 Komari 插件管理批准 |
| Agent 前置要求 | 允许远程执行 | 关闭远程控制的节点无法获取 Steal 数据 |

---

## 数据持久化

插件使用 Komari 提供的长期插件存储目录 `__storageDir__`，默认历史文件为 `history.json`。

在标准 Docker 部署中，通常位于：

`/app/data/plugin-data/cpu-steal-monitor/history.json`

历史样本记录格式为 `{from,time,value}`：前两者是 UTC Unix 毫秒，`value` 为相应区间的 CPU Steal 平均百分比（0–100）。插件重新加载时会重新建立累计计数器基线，**不会用重启前后的计数器强行计算一个连续样本**。

---

## API 端点

- `GET /api/plugin/cpu-steal-monitor/v1/history?uuid=...&from=...&to=...`（按节点查询两分钟历史；主题消费的兼容接口）
- `GET /api/plugin/cpu-steal-monitor/v1/summary?uuids=uuid1,uuid2&from=...&to=...`（独立汇总，返回 `latest`、`average`、`max`、`sampleCount`、`observedSeconds`、`coverageRatio`）
- `GET /api/plugin/cpu-steal-monitor/v1/health`（**仅管理员**；采集状态、节点诊断、最后成功时间与存储信息）

`history` 默认最近 1 小时，`summary` 默认最近 24 小时；`from` / `to` 为 Unix 毫秒，最多查询约 90 天。公开站点的普通访客只能读取非隐藏节点；私有站点须具备相应访问权限。缺失样本返回空数组或 `null`，**真实采样为 0% 才返回数值 0**。

---

## 开发与维护

从项目根目录使用 **Node.js 24** 和 npm。当前没有第三方 npm 依赖，也没有依赖锁文件；安装和构建无需额外的 `npm ci` 步骤。在 Linux 或 WSL 使用系统 `zip` 构建，使用 `unzip` 验证。

```sh
npm test
npm run verify
```

`npm run verify` 依次执行 Node 测试、生成 Komari 可导入的 ZIP，以及从 ZIP 加载脚本、核对清单、路由、调度和版本。测试包括真实 Komari 远程任务结果结构（`client`、`result`、`exit_code`）、两分钟计数器差值、断连和重启缺口、独立汇总 API、权限隔离及主题历史接口兼容。

| 目录或文件 | 职责 |
| --- | --- |
| `script.js`、`logic.cjs` | 生命周期、Komari RPC、数据采集、API 与可测试的 Steal 统计逻辑 |
| `scripts/build.mjs`、`scripts/test-package.mjs` | 生成独立运行的 `script.js` 和安装包，验证打包内容 |
| `komari-plugin.json`、`package.json` | 插件标识、权限、最低 Komari 版本和发布版本 |
| `tests/` | 采样准确性、真实任务结构、访问控制、存储和 API 回归 |
| `docs/MAINTENANCE.md` | 采样时间轴、数据契约、安全边界、联动和升级维护指南 |

### CI 与自动 Release

- [工作流](.github/workflows/ci.yml) 在面向 `main` 的 PR、工程改动的 `main` 推送和手动触发时运行 `npm run verify`，并上传已验证的 `cpu-steal-monitor.zip`。
- 当前版本尚无可下载 ZIP 时，`main` 的推送或手动运行会自动发布。发布任务使用同次验证的 ZIP，并检查标签是否指向该提交。已有完整 ZIP 的版本跳过发行。
- 发布新版本时同步 `package.json`、`komari-plugin.json` 和 `script.js` 的版本。工作流在打包时校验一致性，仓库写权限只在发布任务启用。

正式安装包由自动 Release 工作流构建，可从 [最新 Release](https://github.com/Chen017/komari-plugin-cpu-steal-monitor/releases/latest) 下载。

### 兼容约定与故障排查

- **样本定义**：`Steal% = Δsteal / Δtotal × 100%`，guest/guest_nice 不可重复计入总时间。采样不是瞬时值。
- **重启与断连**：首次快照、采样失败、超时、计数器回退、跨度过长时必须保留数据缺口；禁止填零或插值。
- **主题显示 `Steal -%`**：不要仅继续等待。先检查管理员 `/v1/health` 的节点状态，例如 `warming_up`、`remote_command_failed`、`timeout`，再检查 `/v1/history` 中是否真的有 `samples`。
- **存储与版本**：保持 `history.json` 和 v1 历史接口的向后兼容。更新接口、持久化格式、采样周期时必须同步回归测试与 [维护指南](docs/MAINTENANCE.md)。

部署前最终验收应在真实 Komari + Linux Agent 环境完成，确认远程命令权限、实际采样及主题图表，而不是只依赖模拟测试。

---

## Komari Emerald Ecosystem

本插件是 **Komari Emerald Ecosystem** 的核心组件之一：

```text
                           Komari
                             │
             ┌───────────────┼───────────────┐
             │               │               │
             ▼               ▼               ▼
 Availability History  CPU Steal Monitor  IPQA Alert Report
 WebSocket events      /proc/stat + API   Archive / Alerts
                             │                    ▲
                             │                    │ archive sync
                             │              IP-Quality-Archive
                             │              on monitored VPS
             └───────────────┼────────────────────┘
                             ▼
                  Komari Emerald Insights
                   (可选前端可视化)
```

- [Komari Emerald Suite](https://github.com/Chen017/komari-emerald-suite)：生态聚合展示主页
- [Komari Emerald Insights](https://github.com/Chen017/komari-theme-emerald-insights)：现代化前端监控主题，接入本插件的 Steal 图表
- [Komari Plugin: Availability History](https://github.com/Chen017/komari-plugin-availability-history)：在线率历史事件账本插件
- [Komari Plugin: IPQA Alert Report](https://github.com/Chen017/komari-plugin-ipqa-alert-report)：IP 质量归档同步与告警报告插件
- [Line Quality Monitor](https://github.com/Chen017/komari-plugin-line-quality-monitor) · 按 VPS 和探测点追踪延迟退化、波动与改善
- [IP-Quality-Archive](https://github.com/Chen017/IP-Quality-Archive)：节点端 IP 质量采集工具

---

## License

MIT

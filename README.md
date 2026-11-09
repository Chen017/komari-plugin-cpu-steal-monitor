# Komari CPU Steal Monitor

[![CI](https://github.com/Chen017/komari-plugin-cpu-steal-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/Chen017/komari-plugin-cpu-steal-monitor/actions/workflows/ci.yml)
[![Komari](https://img.shields.io/badge/Komari-%3E%3D1.4.3-blue)](https://github.com/komari-monitor/komari)
[![MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![Emerald Suite](https://img.shields.io/badge/Komari-Emerald%20Ecosystem-10b981)](https://github.com/Chen017/komari-emerald-suite)

**每两分钟采集 Linux VPS 的 CPU Steal 百分比；插件可独立运行，也可与 Komari Emerald Insights 主题联动。**

> **独立模式**：服务器只安装本插件即可采集、保存历史、提供 REST API（历史、汇总及管理员健康状态），不需要更换 Komari 主题，也不需要额外安装 VPS 脚本。
>
> **主题联动模式（推荐）**：再安装 [Komari Emerald Insights](https://github.com/Chen017/komari-theme-emerald-insights)，在节点详情的原有 CPU / 系统负载图中叠加 Steal 曲线。没安装插件时主题的原生监控保持正常。

## 功能与限制

| 能力 | 独立插件 | 搭配 Emerald Insights |
| --- | --- | --- |
| Linux /proc/stat 每两分钟只读采样 | ✓ | ✓ |
| 真实时间戳、90 天历史、持久化 | ✓ | ✓ |
| HTTP 历史 API / 汇总 API | ✓ | ✓ |
| 管理员健康诊断 API | ✓ | ✓ |
| CPU / 负载同图叠加 Steal 曲线 | — | ✓ |
| 跳过离线/重启/漏采集，不制造 0% | ✓ | ✓ |

**Steal 是虚拟机遭宿主机抢占的 CPU 时间比例，单位 %；不是 Linux Load Average。** 本插件不提供独立网页仪表盘，也不发送 Telegram 告警；“独立”指插件的采集、数据存储和 API 不依赖主题。

## 安装

1. 从 [GitHub Actions](https://github.com/Chen017/komari-plugin-cpu-steal-monitor/actions/workflows/ci.yml) 下载成功构建的安装包；**解开 Actions Artifact 外层 ZIP，选择内部 cpu-steal-monitor.zip**。
2. 在 Komari 后台的**插件管理**上传内部 ZIP，确认运行权限：node、allowSystemRPC、allowRoutes。
3. 目标 Linux 节点上的 Komari Agent 必须允许远程执行命令。禁用 Web SSH/远程控制的 Agent 无法被本插件采样；没有额外部署脚本。
4. 首次采集只建立计数器基线，下一次成功采集才产生 Steal 值，通常需两个完整采样周期。
5. 可单独调用 API，或安装配套 Emerald Insights 主题查看图表。**在“主题管理”安装主题 ZIP，不要混淆插件 ZIP。**

## API（不需要主题）

所有时间值为 **UTC Unix 毫秒**；采样点代表区间 [from,time] 内的两分钟**平均 Steal%**，而非瞬时值。

| HTTP GET | 用途 | 访问控制 |
| --- | --- | --- |
| `/api/plugin/cpu-steal-monitor/v1/history?uuid=NODE_UUID&from=...&to=...` | 单节点原始采样（保留兼容主题的 v1 字段） | 公开站点非隐藏节点 / 管理员 |
| `/api/plugin/cpu-steal-monitor/v1/summary?uuids=UUID1,UUID2&from=...&to=...` | 独立统计：latest/average/max/sampleCount/observedSeconds/coverageRatio | 同上；不传 uuids 返回可见节点 |
| `/api/plugin/cpu-steal-monitor/v1/health` | 插件状态、节点上次采集结果、错误、存储路径 | **仅管理员** |

历史查询默认最近 1 小时；汇总默认最近 24 小时。两者支持指定 from/to，最长约 90 天。

**历史响应示例：**
```json
{"schemaVersion":1,"uuid":"NODE_UUID","intervalSeconds":120,
 "samples":[{"from":1731000000000,"time":1731000120000,"value":2.5}]}
```

**汇总响应示例：**
```json
{"schemaVersion":1,"generatedAt":"2026-11-09T04:00:00.000Z",
 "windowStart":"2026-11-08T04:00:00.000Z","windowEnd":"2026-11-09T04:00:00.000Z","intervalSeconds":120,
 "nodes":[{"uuid":"NODE_UUID","latest":2.5,"lastSampleAt":1731000120000,
 "average":2.5,"max":2.5,"sampleCount":1,"observedSeconds":120,"coverageRatio":0.001388888888888889}]}
```

响应示例中的数值仅展示字段格式，不代表真实节点数据。没有观测数据时 latest/average/max 为 **null**、coverageRatio 为 0，**绝不将缺失误写为 Steal 0%**。HTTP 接口请求会遵守 Komari 私有站点和隐藏节点设置。

## 数据准确性

- 只读取 Linux `/proc/stat` 的累计 CPU 计数器；分母为首行 user、nice、system、idle、iowait、irq、softirq、steal，避免重复计算 guest。
- Steal% = (steal 时间差 / CPU 总时间差) × 100%。
- 计数器回退、CPU 重启、远程命令失败、采样间隔明显异常时不合成读数，保留真实空缺。
- 90 天历史保存在 Komari 插件数据目录的 `history.json`；卸载前建议按需备份数据目录。
- 汇总采用各样本与查询时间段重叠秒数的加权平均；非完整覆盖时 coverageRatio 不会冒充 100%。
- 主题在实时/1h/6h/1d/7d/30d/90d 图上使用同一时间轴，历史数据按原有时间桶聚合。

## 诊断 Steal -%

如果主题一直显示 `Steal -%`，请先查看管理员 `/v1/health` 中各节点 status：

| status | 说明 |
| --- | --- |
| `warming_up` | 第一次采集成功，等待下一周期 |
| `ok` | 两次累计计数器计算成功，已产生 Steal 样本 |
| `remote_command_failed` | Agent 禁用或拒绝了远程命令；检查 disable_web_ssh |
| `invalid_counters` | /proc/stat 读取结果格式无效或不支持 |
| `timeout` | Agent 不在线、没有及时回复采集任务 |

同时确认 /v1/history 是否包含 samples。主题会保留无数据状态，不用 “0%” 掩盖采集故障。

## 开发与维护

使用 Node.js 24，无第三方运行时依赖。运行：

```sh
npm test
npm run build
npm run verify
```

CI 在 PR 和 main 推送时运行测试、构建、ZIP 结构验证，并上传安装包 Artifact，**不会自动创建 GitHub Release**。测试包括真实 Komari 任务返回结构、缺失区间语义、独立 API 的权限隔离和主题协议兼容。改动 API v1、采样周期或保存格式时必须添加回归测试；细则见 [维护指南](docs/MAINTENANCE.md)。

## Komari Emerald Ecosystem

- [Komari Emerald Insights](https://github.com/Chen017/komari-theme-emerald-insights)：叠加 CPU Steal 图表的前端主题
- [Availability History](https://github.com/Chen017/komari-plugin-availability-history)：独立的节点在线率账本/API 插件
- [IPQA Alert Report](https://github.com/Chen017/komari-plugin-ipqa-alert-report)：IP 风险归档/API/通知插件
- [Komari Emerald Suite](https://github.com/Chen017/komari-emerald-suite)：生态项目总览

License: [MIT](LICENSE).

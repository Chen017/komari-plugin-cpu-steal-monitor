# CPU Steal Monitor 维护指南

## 组件职责和两种模式

1. **独立后端插件模式**：Komari 服务器通过已连接 Linux Agent 的固定只读命令读取 /proc/stat，计算和存储两分钟 CPU Steal 样本，并提供 /v1/history、/v1/summary、/v1/health。无需换主题，亦无需额外 VPS 常驻采集脚本。
2. **Emerald Insights 主题联动模式**：前端从 /v1/history 获取样本，把 Steal 曲线叠加进已有 CPU + Load Average ECharts。两者可独立升级，主题缺插件时不能影响原生 CPU/负载图。

**这里的独立是服务端采集/存储/API 独立，不是内置一个图形化网页。**

## 采样/时轴契约

- 每两分钟调度一次（`*/2 * * * *`）。首次快照仅建立计数器基线。
- 只使用 /proc/stat 第一行聚合 `cpu` 的字段 user、nice、system、idle、iowait、irq、softirq、steal 作总时间，Steal 使用对应计数器；guest 字段已包含在 user/nice，不可重复计入。
- 记录结构是 `{from: epochMs, time: epochMs, value: percent}`。区间为 [from,time]，其 value 是该区间的 CPU Steal 平均百分比。
- 计数器回退、远程执行失败、离线、重启、采样间隔超过 180 秒、插件停机不生成采样，不能补零、线性插值或使用最后读数冒充实时值。
- `value=0` 是真实观测到没有 Steal，和没有样本时 `null` 的含义完全不同。
- 主题的实时视图仅在观测区间内标示值；历史视图按与原生时间桶的重叠毫秒加权计算，不能独立生成一套不兼容的 X 轴。

## 兼容稳定的 REST API

前缀：`/api/plugin/cpu-steal-monitor/v1`。

| GET | 输出 | 可见性 |
| --- | --- | --- |
| `/history?uuid=...&from=<ms>&to=<ms>` | `{schemaVersion:1, uuid, intervalSeconds:120, samples:[{from,time,value}]}` | 公开站点可见节点；管理员可见所有 |
| `/summary?uuids=...&from=<ms>&to=<ms>` | `{schemaVersion:1,generatedAt,windowStart,windowEnd,intervalSeconds:120,nodes:[{uuid,latest,lastSampleAt,average,max,sampleCount,observedSeconds,coverageRatio}]}` | 公开站点仅非隐藏节点；管理员所有 |
| `/health` | 插件版本、采集状态、最后成功与错误、节点健康和存储路径 | **仅管理员** |

- 读取路径，不允许任何外部用户输入远程执行命令。
- 私有站点/隐藏节点严格过滤，不能因为返回 403/404/503 就把 Steal 当成 0%。
- 单个时间区间最大 90 天；响应使用毫秒 UTC，字段精度/百分比范围遵循 v1 合约。
- API 的最新、平均、最大、历史覆盖率采用**实际重叠时间**加权，而不是将缺失点视为 0，也不是简单按样本个数当作覆盖率。
- 兼容性变更只增加可选字段；若修改既有字段语义，升级为 v2，同时保留 v1 给主题足够的迁移期。

## 存储和升级

- 使用 Komari `__storageDir__/history.json`，`schemaVersion:1`；保持旧文件兼容。
- 写临时文件再原子替换，避免半写入；因存储不可用造成持久化失败要在插件日志/管理员健康接口可诊断。
- 默认保留 90 天，每节点上限 64800 个两分钟窗口。新增节点与删除节点必须能处理，不得外泄隐藏节点 UUID。
- 重载插件要重新建立 /proc/stat 基线，不应将上次进程存储的累计计数器跨重启直接相减。
- plugin 版本在 `package.json`、`komari-plugin.json` 和 `script.js` 同步。

## 权限与安全

- 需要权限 `node`、`allowSystemRPC`、`allowRoutes`；远程执行通过 Komari `admin:exec` 和 `admin:getTaskResultsByTaskId`，命令由插件写死，仅读取 /proc/stat。
- Komari Agent 如果开启 `disable_web_ssh`，远程命令也可能被禁用；这会导致节点没有 Steal 采集。
- `/health` 必须验证管理员 principal；`/summary` 和 `/history` 对未登录用户须先确认 Komari 公共站点状态并过滤隐藏节点。
- 禁止新增未经请求的任意命令 API、外发数据、通知服务或扩大权限范围。

## 测试、CI 与故障恢复

使用 Node.js 24 并运行：

```sh
npm test
npm run verify
```

验证需包含：
- 真实 Komari TaskResult（`client`、`result`、`exit_code`）与兼容字段解析；
- 首样本基线、2 分钟 delta、reboot/gap、0% 与 null、90 天保存、数据解析；
- 独立 /history、/summary、/health API，隐藏节点访问隔离、私有站点 403、管理员能查询健康；
- 正式 ZIP 顶层 manifest/script.js/icon，构建后无 runtime 本地 require；
- 安装在测试 Komari 后核对两次采样、健康接口与主题实时/历史时间轴（此项为真实环境验收，不应被单元测试冒充）。

Actions CI 在 PR/main 上验证并提供可下载 ZIP。独立 `release-on-version-bump.yml` 在 `main` 推送时检查三处版本号一致性；若当前版本没有 Release，则重新执行 `npm run verify`、创建 `vX.Y.Z` 标签并自动发布含 `cpu-steal-monitor.zip` 的 GitHub Release。已发行的相同版本后续提交跳过，不重复发版。遇到 Theme Steal -% 优先检查管理员 `/health` 的 node status，并检查 /history 是否有非空 samples，不要将持续无数据归因于正常的两分钟周期。

## 跨仓库联动

- 插件源码和 CI：[komari-plugin-cpu-steal-monitor](https://github.com/Chen017/komari-plugin-cpu-steal-monitor)
- 图表消费端：[komari-theme-emerald-insights](https://github.com/Chen017/komari-theme-emerald-insights)
- 对照的独立插件模式：[komari-plugin-availability-history](https://github.com/Chen017/komari-plugin-availability-history)
- 系统生态项目矩阵：[komari-emerald-suite](https://github.com/Chen017/komari-emerald-suite)

## 管理页纯文本信息（v0.2.1）

`komari-plugin.json` 的 `configuration` 仅声明一个 `type: textbox` 的静态说明区域，参照 Availability History 的插件管理提示。不得加入可提交的开关、输入框或业务配置项。说明需先讲明 CPU Steal 两分钟只读采集、90 天历史和独立 API，再推荐搭配 Komari Emerald Insights（翡翠洞察）主题；主题仅提供可选可视化，不是插件数据采集的前置条件。

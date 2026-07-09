> 由 scope skill 于 2026-07-09 生成

# Worker-only Windows Deploy

## 目标

JCGO 当前主服务会直接启动本机 KataGo，并把它作为 Worker Pool 的 fallback；同时也支持远程 `jcgo-worker` 连接。这导致“本机分析”和 Worker 状态在 UI 与配置上混在一起，用户无法直观看出分析能力到底来自哪里。本次目标是把分析能力统一为 Worker-only：主服务不再直接启动 KataGo，本机分析也通过独立 `jcgo-worker` 进程连接；并参考 WheelMaker 的发布方式，为 Windows 提供 `~/.jcgo` 运行目录、单一 `config.json`、固定运行资产路径、以及简单的 `start.bat` / `stop.bat` 脚本。

## 决策

- 本机 Worker 和远程 Worker 完全等同，都通过同一套 WebSocket 注册、状态、调度和错误协议接入主服务。
- 主服务不再启动 KataGo，也不保留 direct fallback；无可用 Worker 时，主服务正常运行，但分析功能不可用。
- Worker 失败时不做隐藏 fallback，本次分析任务直接失败并向前端展示错误。
- 停止分析暂不新增 Worker cancel 协议，保持现有语义：停止后不继续后续节点，正在运行的单次查询自然结束后释放 Worker。
- 设置页只展示 Worker 状态，不再展示“本机分析”或 `workerStatus.local`。
- 本轮只做 Windows 发布链路，不做 macOS/Linux systemd、LaunchAgent、Windows Service 或开机启动项。
- 发布后只提供 `start.bat` 和 `stop.bat`，不提供 `restart` / `status` 脚本。
- 运行程序只支持 `config.json`，不再支持 `JCGO_*` 环境变量作为配置来源。
- 缺少 `config.json` 时，`jcgo` 和 `jcgo-worker` 报错退出；配置生成由 deploy 负责。
- `config.json` 严格校验未知字段，写错字段必须报错。
- deploy 不覆盖已有 `~/.jcgo/config.json`。
- deploy 可以覆盖运行资产，包括 `katago.exe`、`analysis_config.cfg` 和 model 文件。
- 首次生成 `config.json` 时，deploy 从 `release-assets/model/` 按文件名排序选择第一个 model 文件名写入 `worker.model`。
- 如果首次生成配置时没有发现 model 文件，`worker.model` 写为空字符串，Worker 启动后以明确错误上报不可用状态。

## 架构

运行目录固定为用户目录下的 `~/.jcgo`：

```text
~/.jcgo/
  bin/
    jcgo.exe
    jcgo-worker.exe
    katago.exe
  config/
    analysis_config.cfg
  db/
    jcgo.sqlite
  games/
  log/
    server.log
    worker.log
  model/
  web/
  config.json
  start.bat
  stop.bat
```

`config.json` 同时配置 server 和 worker：

```json
{
  "server": {
    "enabled": true,
    "port": 4380,
    "token": "dev-token"
  },
  "worker": {
    "enabled": true,
    "name": "local-gpu",
    "url": "ws://127.0.0.1:4380/worker",
    "token": "dev-token",
    "model": "kata1-b18c384nbt-s9996604416-d4316597426.bin.gz",
    "maxVisits": 500
  },
  "log": {
    "level": "warn"
  }
}
```

Server 只负责 HTTP/RPC、静态 Web、棋局仓库、Worker WebSocket 和分析调度。Server 使用 `server.port` 监听 `127.0.0.1:<port>`，使用 `server.token` 校验前端 RPC 和 Worker WebSocket 请求。Server 数据库固定为 `~/.jcgo/db/jcgo.sqlite`，棋谱和分析缓存固定在 `~/.jcgo/games`，Web 静态资源固定在 `~/.jcgo/web`。Server 不持有 `maxVisits` 配置。

Worker 负责启动 KataGo 并连接 `worker.url`。Worker 使用 `worker.token` 连接目标 server，在执行分析前把 `worker.maxVisits` 应用到收到的查询，固定推导运行资产路径：

```text
katagoPath         = ~/.jcgo/bin/katago.exe
modelPath          = ~/.jcgo/model/<worker.model>
analysisConfigPath = ~/.jcgo/config/analysis_config.cfg
```

Server 和 Worker 是两个独立进程。`server.enabled` 决定 `start.bat` 是否启动 `jcgo.exe`，`worker.enabled` 决定是否启动 `jcgo-worker.exe`。

## 流程

### Deploy

Windows deploy 从仓库构建并发布到 `~/.jcgo`。`deploy.bat` 和 `update-publish.bat` 使用同一套安装规则，区别仅在更新路径是否先同步源码。发布资产 staging 固定为：

```text
release-assets/
  katago.exe
  analysis_config.cfg
  model/
    *.bin.gz
```

deploy 行为：

- 构建并安装 `jcgo.exe`、`jcgo-worker.exe` 到 `~/.jcgo/bin`。
- 构建 Web 并发布到 `~/.jcgo/web`。
- 创建 `~/.jcgo/bin`、`~/.jcgo/db`、`~/.jcgo/games`、`~/.jcgo/log`、`~/.jcgo/model`、`~/.jcgo/config`。
- 如果 `~/.jcgo/config.json` 不存在，生成默认配置。
- 如果 `~/.jcgo/config.json` 已存在，保留原文件。
- 如果 `release-assets/katago.exe` 存在，覆盖复制到 `~/.jcgo/bin/katago.exe`。
- 如果 `release-assets/analysis_config.cfg` 存在，覆盖复制到 `~/.jcgo/config/analysis_config.cfg`。
- 如果 `release-assets/model/*` 存在，覆盖复制到 `~/.jcgo/model/`。
- 首次生成配置时，如果 `release-assets/model/` 下存在模型文件，按文件名排序选择第一个写入 `worker.model`。
- 首次生成配置时，如果 `release-assets/model/` 下没有模型文件，写入空的 `worker.model`。
- 写入 `~/.jcgo/start.bat` 和 `~/.jcgo/stop.bat`。

### Runtime

`start.bat` 根据 `~/.jcgo/config.json` 启动启用的进程：

```text
~/.jcgo/bin/jcgo.exe --dir ~/.jcgo
~/.jcgo/bin/jcgo-worker.exe --dir ~/.jcgo
```

`stop.bat` 停止 `~/.jcgo/bin` 下的 `jcgo.exe` 和 `jcgo-worker.exe` 进程，不处理其他路径下同名进程。

`jcgo.exe` 启动时读取 `~/.jcgo/config.json`，只使用 server 配置和固定目录推导数据路径。`jcgo-worker.exe` 启动时读取同一个配置文件，使用 worker 配置和固定目录推导 KataGo、model、analysis config 路径。

### Analysis

前端发起分析后，server 的 scheduler 只调用 Worker Pool。Worker Pool 只从已连接且可用的 Worker 中选择一个执行任务。没有可用 Worker 时，分析能力返回不可用。Worker 收到查询后使用自身配置覆盖查询的 visits，然后调用 KataGo。Worker 返回错误或连接断开时，本次任务失败，server 发布分析错误事件，不再切换到 direct local fallback。

## 验收标准

- 主服务启动不再需要 `JCGO_KATAGO_PATH`、`JCGO_MODEL_PATH`、`JCGO_ANALYSIS_CONFIG_PATH` 或 `JCGO_MAX_VISITS`。
- `jcgo.exe` 和 `jcgo-worker.exe` 缺少 `config.json` 时都会报错退出。
- `config.json` 出现未知字段时报错。
- 主服务不再直接调用 `katago.StartLocal`。
- 没有 Worker 连接时，主服务可用，分析按钮不可用，设置页显示无可用 Worker。
- 本机 Worker 连接后，设置页只把它作为普通 Worker 展示。
- 设置页不再展示“本机分析”状态。
- Worker 启动失败但能连接 server 时，设置页展示该 Worker 的不可用状态和错误。
- deploy 首次运行会生成 `~/.jcgo/config.json`，再次运行不会覆盖它。
- deploy 会覆盖复制 `release-assets` 中存在的运行资产。
- `start.bat` 只启动配置中 enabled 的 server / worker。
- `stop.bat` 只停止 `~/.jcgo/bin` 下的 server / worker 进程。

### 测试

- Go 单元测试覆盖 config 解析、未知字段校验、缺配置错误、固定路径推导、Worker-only Pool 行为、deploy 配置生成和资产复制规则。
- 前端测试覆盖设置页移除 local 状态、无 Worker 时的状态展示、Worker 错误展示、分析可用性文案。
- 构建验证包括 `go test ./...`、`cd web && npm test -- --run`、`cd web && npm run build`。

## 范围之外

- 不做 Worker cancel 协议。
- 不做同一次任务内自动重试下一个 Worker。
- 不做 Windows Service、HKCU Run 开机启动项、计划任务或守护进程。
- 不做 macOS/Linux 发布脚本。
- 不做远程 Worker 配置 UI。
- 不做 model 下载、校验或自动更新。
- 不做 `restart` / `status` 脚本。

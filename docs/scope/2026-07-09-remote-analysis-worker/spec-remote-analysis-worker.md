> 由 scope skill 于 2026-07-09 生成

# Remote Analysis Worker

## 目标

JCGO 当前由主服务直接启动本机 KataGo analysis 进程，并通过全局单分析队列处理棋盘分析任务。新增 remote analysis worker 后，用户可以在另一台机器上运行 `jcgo-worker.exe`，由 worker 启动该机器上的 KataGo 并主动连接 JCGO。JCGO 有分析任务时优先发送给远程 worker，worker 完成分析后返回结果，JCGO 仍然负责棋局状态、分析缓存、持久化和前端推送。

## 决策

- 第一版新增一个独立 Windows worker 可执行文件：`jcgo-worker.exe`。
- worker 主动连接 JCGO，而不是要求 JCGO 主动访问 worker 机器。
- worker 连接复用现有 `JCGO_ACCESS_TOKEN`，不新增单独 worker token。
- worker 启动时读取同目录 `jcgo-worker.json`；配置不存在时生成模板并提示用户修改。
- 配置模板与 worker exe 放在同一个输出目录，用户可以手动修改 JCGO 地址、token、worker 名称、KataGo 路径、模型路径和 analysis config 路径。
- KataGo、模型和 analysis config 第一版不内置到 worker exe；worker 通过配置启动外部 `katago.exe`。
- 提供 Windows 一键构建脚本，生成 `dist/worker/jcgo-worker.exe` 和配置模板。
- worker 双击启动后自动运行，不要求用户通过命令行传参。
- worker 启动后写同目录 `jcgo-worker.log`。
- worker 连接后向 JCGO 汇报 worker 名称、平台、KataGo 路径、模型路径、analysis config 路径和可用状态。
- JCGO 可接收多个 worker 连接。
- 第一版仍保持现有全局单分析队列；一次只分析一个节点，不做多个 worker 并行分析。
- 每个分析任务只派发给一个空闲 worker。
- 远程 worker 优先；没有可用 worker 时，JCGO fallback 到本机 KataGo。
- worker 执行任务失败时，JCGO fallback 到本机 KataGo；本机也不可用时按现有分析错误流程返回。
- worker 配置和状态第一版只写 JCGO 服务端日志和 worker 本地日志，不新增前端 worker 状态 UI。

## 架构

系统新增一个 worker 通信层和一个 worker 命令入口。JCGO 主服务继续通过 `katago.Analyzer` 抽象驱动分析；远程 worker 池实现一个新的 analyzer，负责在空闲 worker 中选择连接、发送 `katago.Query`、等待 `katago.Result` 并处理失败 fallback。本地 KataGo analyzer 保持现有行为，并作为远程 worker 不可用或失败后的 fallback。worker exe 复用现有 KataGo stdin/stdout JSON 协议，只把 JCGO 与 KataGo 之间的进程边界搬到远程机器。

### JCGO 主服务

主服务新增 worker WebSocket endpoint，并使用现有 access token 鉴权。主服务维护内存 worker registry，记录已连接 worker 的名称、配置汇报、连接状态、忙闲状态和当前任务。主服务日志记录 worker 连接、断开、配置、任务派发、任务失败和本地 fallback。

### Worker

worker 启动后读取同目录配置，打开本地日志，启动本机 KataGo analysis 进程，然后连接 JCGO worker endpoint。连接成功后发送注册消息并等待任务。收到任务后，worker 将 `katago.Query` 写给本机 KataGo，读取最终结果和搜索中进度结果，再通过连接返回给 JCGO。

### 发布脚本

仓库新增 Windows 构建脚本，用户运行脚本后生成 worker 发布目录。脚本产物至少包含 `jcgo-worker.exe` 和 `jcgo-worker.example.json`；如果发布目录没有 `jcgo-worker.json`，脚本可以生成一份可编辑模板。

## 流程

### 构建与配置

用户运行构建脚本后得到 `dist/worker/jcgo-worker.exe` 和配置模板。用户把 worker 发布目录复制到目标机器，修改同目录 `jcgo-worker.json`，填入 JCGO worker endpoint、现有 access token、worker 名称、KataGo 路径、模型路径和 analysis config 路径。

### Worker 启动

用户双击 `jcgo-worker.exe`。worker 读取配置，初始化日志，检查配置字段，尝试启动本地 KataGo analysis 进程，然后使用配置中的 server URL 和 access token 主动连接 JCGO。配置缺失时，worker 在同目录生成模板并在日志中说明需要修改配置，不启动分析循环。

### Worker 注册

JCGO 校验 worker 连接 token。校验通过后，worker 发送注册消息，JCGO 将其加入 worker registry 并写服务端日志。注册信息只用于服务端调度和日志排查，不进入前端状态 payload。

### 分析任务

用户在前端触发分析时，现有 scheduler 仍按全局单队列生成 `katago.Query`。远程 worker analyzer 如果发现有空闲 worker，则将任务发送给一个空闲 worker，并等待 worker 返回进度结果和最终结果。JCGO 收到结果后继续走现有 `game.NormalizeAnalysis`、workspace 缓存、持久化和 WebSocket 前端推送流程。

### Fallback 与失败

如果没有空闲 worker、所有 worker 断开、worker 返回错误或任务通信失败，JCGO 使用本机 KataGo analyzer 尝试同一任务。若本机 KataGo 不可用或也返回错误，则分析按现有错误路径停止，并把错误推送到当前 workspace。失败和 fallback 原因写入服务端日志；worker 本地错误写入 worker 日志。

## 验收标准

- 运行构建脚本后，生成 `dist/worker/jcgo-worker.exe` 和 worker 配置模板。
- 首次双击 worker exe 且配置不存在时，同目录生成可编辑配置模板并写日志说明。
- 配置正确时，worker 能启动本机 KataGo analysis 进程并主动连接 JCGO。
- worker 连接使用现有 `JCGO_ACCESS_TOKEN` 鉴权；token 错误时 JCGO 拒绝连接，worker 写明失败原因。
- worker 注册后，JCGO 服务端日志记录 worker 名称、平台、KataGo 路径、模型路径、analysis config 路径和可用状态。
- 多个 worker 可以同时连接 JCGO，并被记录在 worker registry。
- 分析仍保持全局串行；一次只向一个 worker 或本地 KataGo 发送一个节点任务。
- 有空闲 worker 时，分析任务优先由 worker 完成，前端收到的分析结果与现有本地 KataGo 分析路径格式一致。
- 没有可用 worker 时，如果本机 KataGo 已配置，分析自动 fallback 到本机 KataGo。
- worker 执行任务失败时，JCGO 对同一任务 fallback 到本机 KataGo。
- worker 和本机 KataGo 都失败时，前端按现有分析错误流程显示不可用或错误状态。
- worker 断开连接时，JCGO 从 registry 中移除或标记该 worker 不可用，后续任务不会派给断开的 worker。
- 第一版前端不展示 worker 列表、worker 配置或 worker 忙闲状态。

### 测试

- 后端单元测试覆盖 worker registry 的注册、断开、忙闲状态和空闲 worker 选择。
- 后端测试覆盖远程 worker analyzer 成功返回 `katago.Result` 的路径。
- 后端测试覆盖无 worker 时 fallback 到本地 analyzer。
- 后端测试覆盖 worker 返回错误或断线时 fallback 到本地 analyzer。
- 后端测试覆盖 worker 和本地 analyzer 都失败时返回错误。
- 后端 WebSocket 测试覆盖 worker endpoint token 鉴权和注册消息处理。
- worker 侧测试覆盖配置文件加载、模板生成和缺失配置处理。
- 构建脚本测试或手动验证覆盖 worker exe 与配置模板生成。

## 范围之外

- 不把 KataGo、模型或 analysis config 打包进 worker exe。
- 不做前端 worker 状态 UI。
- 不做多个 worker 并行分析。
- 不做同一棋局多节点并行分析。
- 不做 worker 权限与浏览器 access token 分离。
- 不做 worker 配置热更新。
- 不做 worker 自动下载 KataGo 或模型。
- 不做跨平台发布脚本；第一版只要求 Windows worker exe 构建流程。

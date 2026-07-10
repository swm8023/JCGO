> 由 scope skill 于 2026-07-10 生成

# Game Worker Analysis

## 目标

当前棋局分析由 worker pool 在每个节点任务开始时自动挑选可用 worker，同一盘棋的不同节点可能被不同 worker 分析。目标是把“这盘棋使用哪个分析器”变成明确、持久、可见的棋局属性：用户在分析菜单中为每盘棋选择一个 worker，之后继续分析、重新分析、落子触发的补充分析都固定使用这个 worker，并使用该 worker 在设置页配置的默认 model 和 visits。

## 决策

- 每盘棋持久化绑定一个 `worker.name`，作为 `analysisWorkerName`。
- 未绑定 worker 时，不能开始、继续或重新分析；分析菜单提示先选择分析器。
- 绑定 worker 离线或有 error 时，不能开始、继续或重新分析；提示该 worker 不可用。
- 绑定 worker 忙碌时允许排队等待，任务仍然只发给这个 worker。
- Worker 的默认 `model/maxVisits` 继续由设置页按 worker 配置；棋局只选择 worker，不覆盖 model 或 visits。
- Worker 配置变化不自动清空旧分析结果；用户点“重新分析”时才用当前 worker 配置整盘重算。
- 主界面的分析入口改为弹出菜单，顶部选择当前棋局 worker，显示当前分析状态和主线进度。
- 正在分析时禁止切换 worker；用户需要先停止分析，再切换，再继续或重新分析。
- “重新分析”沿用当前语义：先清空整盘已有分析和 analysis 文件，再用绑定 worker 全量重算主线节点。

## 架构

系统分为三层：store 持久化棋局绑定的 `analysis_worker_name`；app/scheduler 在分析启动、排队和落子触发补充分析时携带绑定 worker；worker pool 提供按 `worker.name` 指定 worker 的分析入口。前端只渲染 server payload，不自行判断 KataGo 或分析结果语义。

### Store

`games` 表增加 `analysis_worker_name TEXT NOT NULL DEFAULT ''`，`GameRecord` 和前端 `GameRecord` 增加 `analysisWorkerName`。Repository 提供更新棋局分析 worker 的方法。

### App / Scheduler

`analysis.start`、`analysis.restart` 和落子后的 `AnalyzeNow` 都从当前棋局读取 `analysisWorkerName` 并写入 `StartInput/task`。如果未绑定或绑定 worker 当前不可用，RPC 返回明确错误并保持分析状态不进入 running。忙碌不作为不可用，任务可以进入队列。

### Worker Pool

Pool 增加按 worker name 分析的能力。指定 worker 离线、closed 或 error 非空时返回错误；指定 worker busy 时等待它释放，而不是挑选其他 worker。拿到指定 worker 后，仍按 worker name 从 server DB 获取该 worker 的 `model/maxVisits` 并随任务下发。

### Frontend

分析入口改为弹出菜单。菜单顶部是当前棋局 worker 选择控件；下方显示状态、主线分析进度 `已分析 / 总节点`，以及继续分析、重新分析、停止分析动作。正在分析时 worker 选择置灰。

## 流程

1. 用户打开棋局，server 在 `workspace.state` / `game.list` 中返回该棋局的 `analysisWorkerName` 和 worker status。
2. 用户打开分析菜单，选择 worker 后，前端调用保存棋局分析 worker 的 RPC。
3. 用户点击继续分析时，server 校验该棋局已绑定 worker，且 worker 在线并无 error，然后把缺失主线节点按当前逻辑排队。
4. Scheduler 对该棋局的每个分析 task 携带同一个 worker name，Pool 只向这个 worker 下发任务。
5. 如果 worker 正忙，task 等待同一个 worker 空闲；如果等待期间 worker 断开或报错，分析停止并向前端发布错误。
6. 用户点击重新分析时，server 先清空整盘分析和 analysis 文件，再用绑定 worker 全量排队主线节点。
7. 用户落子或进入变化时触发的即时分析，也沿用当前棋局绑定 worker。

## 验收标准

- 每盘棋可以保存并持久恢复 `analysisWorkerName`。
- 未选择 worker 时，继续分析和重新分析不能启动，并给出清晰错误或禁用提示。
- 绑定 worker 离线或有 error 时，分析不能启动，并提示绑定 worker 不可用。
- 绑定 worker 忙碌时，允许启动分析，任务等待该 worker 空闲，不切换到其他 worker。
- 同一盘棋的一轮继续分析或重新分析中，所有节点都发送给绑定 worker。
- 正在分析时，分析菜单中的 worker 选择不可编辑。
- 重新分析会先清空旧分析结果和 analysis 文件，再用绑定 worker 全量重算。
- Worker 的 `model/maxVisits` 仍只来自该 worker 的 server DB 配置，棋局不保存 model 或 visits。
- 分析菜单显示当前 worker、分析状态和主线进度 `已分析 / 总节点`。

### 测试

- Store 测试覆盖 `analysis_worker_name` 的创建、更新、读取和迁移默认值。
- Handler 测试覆盖保存棋局 worker、未绑定时拒绝分析、worker error 时拒绝分析、重新分析清空旧结果并携带 worker。
- Scheduler / Pool 测试覆盖 task 固定 worker、busy worker 排队等待、不可用 worker 返回错误、不 fallback 到其他 worker。
- Frontend 测试覆盖分析菜单展示 worker 选择、进度、未选择禁用动作、running 时禁止切换、点击继续/重新/停止调用正确 RPC。

## 范围之外

- 不做棋局级 model/visits 覆盖。
- 不做分析结果版本管理，也不记录每个结果当时使用的 model/visits。
- 不做 worker UUID；第一版继续使用 `worker.name` 作为稳定身份。
- 不做自动切换 worker、性能权重、轮询或负载均衡策略。
- 不做持久化的跨服务重启任务队列；忙碌等待只覆盖当前运行中的调度队列。

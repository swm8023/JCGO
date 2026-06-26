> 由 scope skill 于 2026-06-24 生成，2026-06-26 更新

# JCGO v1 Analysis Review

## 目标

JCGO v1 要交付一个远程单用户私有的围棋 AI 分析复盘工具。用户通过浏览器或基础 PWA 连接远程 Go 服务，导入 SGF 棋局，服务端运行 KataGo 分析并维护 token workspace 内存状态，前端提供 KaTrain 风格的棋盘复盘、推荐点、PV 预览、试下分支、胜率/目差曲线、坏棋列表、ownership 势力范围和死子/弱子标记。JCGO 不基于 KaTrain 二次开发，仍采用 Go 后端 + React/PWA 前端；KaTrain 是行为、算法语义和视觉效果参考。

## 决策

- v1 是远程部署的单用户/单实例私有服务，不做账号系统和多用户数据隔离。
- 主业务通信使用 WebSocket + JSON-RPC 2.0；后端推送状态时使用 JSON-RPC notification。
- 鉴权使用单个全局 token；前端首次输入 token 后保存到浏览器 `localStorage`。
- WebSocket token 通过 `Sec-WebSocket-Protocol` 子协议携带，握手阶段校验；token 不放 URL query，不写入前端构建产物。
- 前端使用 React + TypeScript + Vite，并提供基础 PWA 壳；业务能力必须在线连接服务器，不承诺离线可用。
- 后端使用 Go 标准库、Gorilla WebSocket 和 SQLite driver；不引入 Gin/Echo/Fiber。
- KataGo 由服务端启动和管理；服务启动时启动一个常驻 `katago analysis` 进程并复用。
- KataGo 配置在服务启动时固定，包含 `katago_path`、`model_path`、`analysis_config_path`、数据目录和 `access_token`；前端不提供模型、visits 或引擎参数切换。
- KataGo 启动失败时，JCGO 服务仍启动，导入和棋局管理可用，分析功能标记不可用并返回明确错误。
- 整个服务使用全局单分析队列，同一时间只向 KataGo 发送一个分析请求；当前查看节点和试下当前节点优先。
- SGF 导入通过 WebSocket 上传文本，不使用 HTTP multipart 业务接口。
- SGF 原文保存为服务器文件；SQLite 只保存最小棋局索引：`game_id`、显示名、对局结果、服务端 SGF 文件名和创建时间。
- SGF 中能按需解析的信息不冗余入库，例如棋手名、贴目、规则、手数和棋盘尺寸。
- 允许重复导入同一 SGF，允许重复显示名；显示名不能为空。
- v1 只支持标准 `.sgf`、单盘棋、19 路。
- 规则和贴目优先读取 SGF 的 `RU` 和 `KM`；缺失时默认 `chinese` 和 `7.5`。
- 支持根节点 `AB` / `AW` 初始摆子和让子棋；真正棋盘状态以根节点摆子为准。
- 非根节点出现 `AB` / `AW` / `AE` setup 属性时拒绝导入，提示不支持复杂摆子。
- 导入 SGF 时只取主线，忽略 SGF 中已有变化分支；不因为 SGF 有分支而拒绝导入。
- v1 忽略 SGF 注释和标记，不显示也不编辑 `C`、`TR`、`SQ`、`CR`、`MA`、`LB` 等属性。
- 导入后默认选中根节点/第 0 手；如果有让子，根节点棋盘显示初始摆子。
- 用户手动点击“开始分析”后，分析当前选中棋局的实战主线；导入后不自动分析。
- 分析范围默认只包含实战主线；用户进入试下并落子时，创建临时分支并高优先级分析该分支当前局面。
- 重新分析会清空该棋局 token workspace 中的主线分析缓存和所有试下分支，并重新跑主线；如果原来在分支，则回到该分支起点对应的主线手。
- 主线分析结果、试下分支和分支分析结果保存在服务器进程内存，并按 token workspace 隔离。
- WebSocket 断开重连后，只要服务进程未重启且 token 相同，就能恢复 token workspace 内的选中棋局、当前节点、试下分支、分析缓存和最近状态。
- 服务进程重启后，内存 workspace 丢失；SGF 文件和 SQLite 棋局列表保留。

### 分析数据

- KataGo query 本轮启用 ownership，不启用 policy；policy heatmap 本轮不做。
- 后端保存 KataGo 原始 root 和 candidate 数值：`winrate`、`scoreLead`、`visits`、`moveInfos`、`pv`、`ownership`。
- ownership 在服务端量化为 q8：`int8[361]`，范围 `-127..127`，下发时使用 `q8-base64`。
- 服务端计算 `playedPointLoss` 和主线 `badMoves`；候选点颜色、候选点相对最佳差距、ownership 颜色、死子标记和 toggle 显隐由前端计算。
- `playedPointLoss` 表示当前 frame 的实际落子相对父局面最佳选择损失多少目。
- 坏棋判定对齐 KaTrain 默认阈值 `[12, 6, 3, 1.5, 0.5, 0]`；坏棋列表门槛为 point loss 进入 `1.5` 这一档以上。
- 胜率和目差统一按黑方视角展示；黑胜率越高曲线越高，`scoreLead > 0` 表示黑领先。
- 右侧曲线只画黑胜率和 `scoreLead`，不画 point loss 曲线；point loss 只用于最后一手质量点和坏棋列表。

### 状态同步

- 对外状态 payload 使用列式结构，减少重复 key。
- 主线 `timeline` 固定长度为总手数 + 1，数组 index 即 `moveNumber`；未分析位置用 `null`。
- `timeline` 全量下发轻数据：`nodeIds`、`moves`、`moveColors`、`passes`、`toPlays`、`rootWinrates`、`rootScoreLeads`、`rootVisits`、`playedPointLosses`。
- `badMoves` 全量下发列式数据：`nodeIds`、`moveNumbers`、`colors`、`moves`、`pointLosses`。
- `current` 只下发当前节点的重数据：当前 candidates 和当前 ownership。
- `current.candidates` 也使用列式结构：`moves`、`orders`、`visits`、`winrates`、`scoreLeads`、`pvs`。
- `current.nodeId` 必须保留，前端用它防止延迟响应覆盖当前棋盘。
- 服务端内部缓存所有已分析节点完整数据；传输时只把当前节点的 candidates + ownership 放进 `current`。

### 试下分支

- 点击推荐点只显示 PV，不直接进入试下。
- 点击“试下”进入 try mode；进入试下时清空 PV 预览。
- 试下模式下点击棋盘任意合法空点或推荐点都会落试下分支，并触发当前试下局面分析。
- 试下有独立 `variation.timeline`，不塞进主线 `timeline`。
- `variation.timeline[0]` 是试下第一手，不重复 base 局面。
- 试下曲线使用 `variation.timeline`，x 轴按 `baseMoveNumber + index + 1` 显示。
- 试下不进入主线 `badMoves`；退出试下后主线坏棋列表不被污染。
- 退出试下时删除整个 variation store，清掉所有 `var:*` 节点和对应分析缓存，回到主线。
- 支持 Pass；连续两手 Pass 后只标记终局，不做死活确认或数子界面。

### 棋盘渲染

- 棋盘组件自研，视觉和交互效果借鉴 KaTrain。
- 棋盘固定层级为：棋盘底色、ownership 势力范围、棋盘线/坐标/星位/天元、棋子、死子/弱子中心方块、最后一手质量点、推荐点、实际下一手对比标记、PV/试下落子、透明点击热区。
- 推荐点、势力范围、死子标记做成左侧 toolbar toggle，默认都开，状态写入前端 `localStorage`，不同棋局共用，不进入服务端状态。
- policy 本轮不显示入口。
- 推荐点完全按 KaTrain `pointsLost = sideSign * (rootScoreLead - candidateScoreLead)` 语义显示。
- 推荐点颜色阈值使用 KaTrain 默认 `[12, 6, 3, 1.5, 0.5, 0]`，从差到好为紫/红/橙/黄/黄绿/绿。
- 推荐点默认文字显示 `delta score` 和 `visits`；低 visits 规则为 `visits < 25 && order !== 0`，低 visits 且非最佳点弱化显示。
- 最佳推荐点加青色描边。
- ownership 正数偏黑、负数偏白；势力范围使用 KaTrain 默认 blended 平滑色块。
- ownership 透明度按 `abs(ownership) ** (1 / 1.33)`。
- 死子/弱子标记按 KaTrain 默认 `weak`：只标棋子颜色与 ownership owner 不一致的棋子，不额外加阈值，方块大小随 `abs(ownership)` 缩放，基准为 KaTrain `MARK_SIZE = 0.42`。
- 最后一手质量点只显示最后一手，用 `playedPointLoss` 映射 KaTrain 颜色；没有 `playedPointLoss` 时不显示。
- PV 预览和试下互斥。普通模式点击棋盘推荐点或右侧候选点显示 PV；进入试下后清空 PV，只显示真实试下分支和当前试下推荐点。
- 推荐点 toggle 关闭时只隐藏棋盘推荐点 overlay，右侧候选点列表仍显示。
- 势力范围 toggle 关闭时只隐藏 ownership 背景；死子标记 toggle 关闭时只隐藏棋子中心方块。

### 布局

- 主界面为左侧 toolbar、可展开棋局列表、中间棋盘、右侧数据栏。
- 左侧 toolbar 包含棋局列表展开、添加/导入、开始分析、推荐点 toggle、势力范围 toggle、死子标记 toggle。
- 右侧数据栏从上到下为当前局面摘要、胜率/目差曲线、坏棋列表 tab、推荐点列表 tab。
- 棋盘信息显示黑方名字、白方名字、贴目和规则，位置按可用宽度/长宽比自适应：宽屏手机横屏放棋盘左侧，平板或长宽比较小的横屏放棋盘上方。
- 桌面/平板宽屏布局为左 sidebar、中间棋盘、右侧分析数据。
- 手机竖屏只显示旋转横屏提示。
- 手机横屏布局为左侧入口/折叠 sidebar、中间棋盘、棋盘右侧竖向导航工具条、更右侧分析 Tab 面板。
- 快捷键只支持 `ArrowLeft` 上一手、`ArrowRight` 下一手和 `Esc` 清 PV/回主线/关闭当前浮层；输入框聚焦时快捷键不触发。

## 架构

系统由 React PWA 前端、Go WebSocket/JSON-RPC 后端、SQLite 棋局索引、服务器 SGF 文件目录、token workspace 内存状态和常驻 KataGo analysis 进程组成。前端只负责输入 token、选择文件、渲染后端返回的局面快照和分析数据，不作为棋局规则权威；后端负责 SGF 解析、主线模型、合法性校验、token workspace、分析任务调度、KataGo stdin/stdout JSON 协议、状态同步 payload 生成和服务端业务派生数据计算。

### 前端

前端在首次打开时要求用户输入 token，连接成功后保存到 `localStorage`。主界面负责棋局列表、导入弹窗、棋盘、导航、分析面板、图表和坏棋列表。前端不完整解析 SGF，不自行推演吃子、打劫或自杀等规则；跳手、试下、Pass、删除分支都通过 JSON-RPC 发送意图，由后端返回完整局面快照和列式分析状态。

前端负责所有棋盘显示派生：推荐点颜色/标签、ownership 势力范围颜色与透明度、死子/弱子方块、最后一手质量点、toggle 显隐、PV 预览和试下可视化。前端本地保存棋盘 overlay toggle 状态。

### 后端

后端使用 `net/http` 提供静态资源和 WebSocket endpoint，使用 Gorilla WebSocket 在握手阶段校验子协议 token。业务协议为 JSON-RPC 2.0。后端维护 SQLite 棋局索引、SGF 文件目录、全局分析队列、KataGo 进程状态和按 token 隔离的 workspace。导入、重命名、删除、跳手、试下、开始/停止/重新分析都通过后端处理。

### 内存状态

服务端内部状态不直接按传输 payload 存储。每个 token workspace 持有多个 `GameState`，每个 `GameState` 持有棋局模型、当前节点、主线分析缓存、当前试下缓存和分析状态。

```go
type GameState struct {
  Game *game.Game
  CurrentNodeID string
  AnalysisState AnalysisState
  Main MainAnalysisStore
  Variation *VariationAnalysisStore
}
```

主线缓存固定长度：

```go
type MainAnalysisStore struct {
  Frames []AnalysisFrame
  BadMoves []BadMove
}
```

试下缓存变长，退出试下时整体删除：

```go
type VariationAnalysisStore struct {
  BaseNodeID string
  BaseMoveNumber int
  CurrentNodeID string
  Frames []AnalysisFrame
}
```

单节点分析缓存保存完整 root、候选点和 q8 ownership：

```go
type AnalysisFrame struct {
  NodeID string
  MoveNumber int
  Move string
  MoveColor game.Color
  Pass bool
  ToPlay game.Color
  Root *RootAnalysis
  Candidates []CandidateRaw
  OwnershipQ8 []byte
  PlayedPointLoss *float64
}
```

### KataGo

后端在服务启动时按配置启动一个常驻 `katago analysis` 进程。分析请求串行进入全局队列，由后端写入 KataGo stdin 并读取 stdout JSON response。KataGo query 本轮使用 `includeOwnership=true`、`includePolicy=false`、`includeMovesOwnership=false`。KataGo 不可用时，后端仍提供非分析功能，并通过引擎状态和 JSON-RPC error 暴露不可用原因。

### 状态 Payload

服务端下发状态使用列式结构：

```ts
type StatePayload = {
  type: 'state'
  schema: 1
  gameId: string
  currentNodeId: string
  analysisState: 'idle' | 'running' | 'stopped' | 'complete' | 'unavailable'
  timeline: {
    nodeIds: string[]
    moves: (string | null)[]
    moveColors: ('B' | 'W' | null)[]
    passes: boolean[]
    toPlays: ('B' | 'W')[]
    rootWinrates: (number | null)[]
    rootScoreLeads: (number | null)[]
    rootVisits: (number | null)[]
    playedPointLosses: (number | null)[]
  }
  badMoves: {
    nodeIds: string[]
    moveNumbers: number[]
    colors: ('B' | 'W')[]
    moves: string[]
    pointLosses: number[]
  }
  variation?: {
    baseNodeId: string
    baseMoveNumber: number
    currentNodeId: string
    timeline: {
      nodeIds: string[]
      moves: string[]
      moveColors: ('B' | 'W')[]
      passes: boolean[]
      toPlays: ('B' | 'W')[]
      rootWinrates: (number | null)[]
      rootScoreLeads: (number | null)[]
      rootVisits: (number | null)[]
      playedPointLosses: (number | null)[]
    }
  }
  current: {
    nodeId: string
    candidates: {
      moves: string[]
      orders: number[]
      visits: number[]
      winrates: number[]
      scoreLeads: number[]
      pvs: string[][]
    }
    ownership?: {
      encoding: 'q8-base64'
      data: string
    }
  }
}
```

## 流程

### 启动

服务启动时读取配置，初始化数据目录和 SQLite，尝试启动 KataGo analysis 进程，然后启动 HTTP/WebSocket 服务。KataGo 启动失败不会阻止服务启动，但 `engineStatus` 标记为不可用。

### 连接与恢复

前端从 `localStorage` 读取 token；没有 token 时显示输入界面。连接 WebSocket 时，前端通过 `Sec-WebSocket-Protocol` 同时声明 `jcgo-jsonrpc` 和 `token.<accessToken>`。后端在升级前校验 token，失败则拒绝连接；成功后进入对应 token workspace 并返回当前列式状态。断线重连后，服务端返回完整 `timeline`、`badMoves`、`variation` 和当前 `current`，前端以服务端状态为准。

### 导入

用户点击导入并选择 `.sgf` 文件后，前端弹窗预填文件名去掉 `.sgf` 的显示名。用户确认后，前端读取 SGF 文本，通过 JSON-RPC 上传显示名、原始文件名和 SGF 文本。后端解析并校验标准 SGF、单盘棋、19 路、根节点初始摆子、非根节点无复杂 setup，然后生成 `game_id`、写入 SGF 文件、写入 SQLite 索引并返回新棋局。导入成功后列表刷新并自动选中新棋局第 0 手。

### 复盘与导航

前端发送上一手、下一手、跳手、回主线、图表点跳转等意图。后端根据主线和 token workspace 中的临时分支计算当前节点，返回完整局面快照和列式状态。快照包含棋子、最后一手、当前手数、总手数、当前执棋方、规则、贴目、分支状态、导航可用性和当前节点已有分析结果。

### 分析

用户对当前棋局点击开始分析后，后端为主线节点创建分析任务，当前节点优先。每个节点分析完成后，后端将结果写入 token workspace 缓存，更新主线 `timeline` 和 `badMoves`，并推送完整列式状态。用户停止分析或切换棋局时，后端停止继续调度该棋局未执行任务；正在等待 KataGo 返回的单个请求返回后，如果已过期则丢弃或不推送。

### PV 与试下

普通模式点击棋盘推荐点或右侧候选点只显示 PV，不创建分支。用户点击“试下”进入 try mode 后，PV 预览清空。try mode 中点击任意合法空点、推荐点或 Pass，后端创建或追加临时分支节点，返回新局面并高优先级分析当前试下局面。退出试下时，后端删除整个 variation store 和所有 `var:*` 分析缓存，回到主线。

## 验收标准

- 首次打开页面时，未配置 token 的浏览器显示 token 输入界面；token 正确时进入主界面，错误时不能进入业务界面。
- WebSocket 握手使用子协议 token；URL 中不包含 token。
- 服务端配置 KataGo 错误时，页面仍可连接并管理棋局，分析按钮给出引擎不可用状态。
- 用户可以通过 WebSocket 导入合法 19 路单盘 SGF，并在导入前修改显示名。
- 导入成功后 SGF 文件保存到服务器文件系统，SQLite 只保存最小索引，左侧列表按导入时间倒序显示。
- 用户可以重复导入同一 SGF，也可以使用重复显示名；空显示名被拒绝。
- 非 19 路、解析失败、多棋局集合、非根节点 setup 的 SGF 会被拒绝并显示错误。
- 根节点 `AB` / `AW` 初始摆子的 SGF 导入后，第 0 手棋盘正确显示初始摆子。
- 导入带 SGF 分支、注释或标记的文件时，v1 只取主线并忽略注释/标记。
- 用户可以重命名和删除棋局；删除棋局需要确认，删除当前棋局后自动选择相邻棋局或进入空状态。
- 选中棋局后，根节点第 0 手默认显示，用户可以上一手、下一手、跳到第一手、跳到最后一手和通过图表/坏棋列表跳转。
- 点击开始分析后，主线节点逐个得到分析结果，结果以完整列式状态实时推送更新 UI。
- 状态 payload 的 `timeline` 固定长度为总手数 + 1，未分析位置为 `null`，数组 index 等于手数。
- `current` 只包含当前节点 candidates + ownership；跳转手数后 `current.nodeId` 与当前节点一致。
- ownership 使用 `q8-base64` 下发，前端能渲染 KaTrain 风格 blended 势力范围。
- 前端默认开启推荐点、势力范围、死子标记 toggle，并将 toggle 状态保存到 `localStorage`。
- 棋盘候选点颜色、文字、低 visits 弱化和最佳点描边对齐 KaTrain 默认语义。
- 死子/弱子方块按 ownership 反向归属显示，大小随 confidence 缩放。
- 最后一手质量点只显示最后一手，并按 `playedPointLoss` 映射 KaTrain 颜色。
- 右侧曲线只显示黑胜率和 `scoreLead`，当前手有竖线标记。
- 主线坏棋列表使用服务端计算的 `badMoves`，point loss 进入 `1.5` 档以上才列入。
- 普通模式点击候选点只显示 PV；进入试下会清空 PV。
- 试下模式中点击合法空点、推荐点或 Pass 会追加试下分支，并分析当前试下局面。
- 试下拥有独立曲线，不进入主线坏棋列表；退出试下后删除整个试下分支和 `var:*` 分析缓存。
- Pass 可用；连续两手 Pass 后局面标记终局，但不进入数子界面。
- WebSocket 断开后用相同 token 重连，只要服务未重启，就能恢复 token workspace 中的试下分支、分析缓存和最近状态。
- 服务重启后，棋局列表和 SGF 文件仍存在，内存分析缓存和试下分支丢失。
- 棋盘信息显示黑白方名字、贴目和规则；宽屏手机横屏放棋盘左侧，平板或较小长宽比横屏放棋盘上方。
- 手机竖屏显示横屏提示；手机横屏显示紧凑横屏工作台，导航工具条位于棋盘右侧。
- `ArrowLeft`、`ArrowRight`、`Esc` 快捷键按确认行为工作；输入框聚焦时不触发。

### 测试

- 后端单元测试覆盖 SGF 导入校验、19 路判断、根节点摆子、非根节点 setup 拒绝、主线提取、默认规则/贴目、棋手名读取、结果读取和最小 SQLite 索引写入。
- 后端单元测试覆盖棋局推演、合法落子、Pass、连续两手 Pass、试下分支创建、删除试下、清空试下和回主线。
- 后端单元测试覆盖 KataGo root/candidate/ownership 解析、ownership q8 编码、played point loss 计算、KaTrain 阈值分级和主线坏棋列表生成。
- 后端集成测试覆盖 WebSocket 子协议 token 鉴权、JSON-RPC request/response、notification 推送、导入、列表、重命名、删除和状态恢复。
- 后端集成测试覆盖列式 payload 长度一致性、未分析节点 `null`、`current.nodeId` 防旧响应覆盖、试下独立 timeline 和退出试下清理。
- 后端集成测试覆盖 KataGo 不可用时服务仍启动，并对分析请求返回引擎不可用错误。
- 前端组件测试覆盖 token 输入、导入弹窗、棋局列表排序、重命名/删除交互、棋盘固定层级、候选点显示、ownership 渲染、死子标记、最后一手质量点、PV 状态、试下互斥、分析面板、图表跳转和快捷键。
- 端到端测试覆盖导入一盘 19 路 SGF、开始分析、收到节点级结果、点击候选点预览 PV、进入试下、断线重连恢复 workspace、退出试下清空分支、重新分析清空缓存。
- 响应式测试覆盖桌面/平板宽屏、手机横屏、手机竖屏横屏提示，以及棋盘信息条左侧/上方自适应。

## 范围之外

- 不做 SGF 导出。
- 不做账号系统、多用户数据隔离、token 创建/撤销/轮换 UI。
- 不做远程模型下载、模型切换、visits 调整或引擎参数 UI。
- 不做完整 SGF 分支浏览器。
- 不做 SGF 注释和标记显示或编辑。
- 不做 NGF、GIB、多尺寸棋盘或复杂编辑型 SGF。
- 不做 policy heatmap、区域分析。
- 不做死活确认、人工数子或终局结算界面。
- 不做持久化分析缓存。
- 不做完整离线业务能力。
- 不做日志面板。
- 不做完整竖屏手机复盘界面。

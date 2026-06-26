# KaTrain 功能盘点需求文档

> 研究日期：2026-06-20  
> 研究口径：完整盘点 KaTrain 已有功能，不判断本项目是否采用，不进入实现设计。  
> 研究基线：KaTrain `v1.18.1`，GitHub master 提交 `30ccf864b0c1cae96dd0aad43880a17d76dba2bc`。

## 资料来源

- KaTrain README/manual: <https://github.com/sanderland/katrain/blob/master/README.md>
- KaTrain 安装说明: <https://github.com/sanderland/katrain/blob/master/INSTALL.md>
- KataGo 故障排查: <https://github.com/sanderland/katrain/blob/master/ENGINE.md>
- 主题说明: <https://github.com/sanderland/katrain/blob/master/THEMES.md>
- 默认配置: <https://github.com/sanderland/katrain/blob/master/katrain/config.json>
- GUI 定义: <https://github.com/sanderland/katrain/blob/master/katrain/gui.kv>、<https://github.com/sanderland/katrain/blob/master/katrain/popups.kv>
- 核心模块: <https://github.com/sanderland/katrain/tree/master/katrain/core>
- 最新 Release: <https://github.com/sanderland/katrain/releases>

## 产品定位

KaTrain 是一款面向围棋/Baduk/Weiqi 的 AI 复盘、训练和对局工具。它本身不实现神经网络围棋引擎，而是集成 KataGo Analysis Engine，围绕棋局树、SGF、AI 分析结果、教学反馈、弱化 AI 风格、整局报告和 KataGo 配置提供桌面应用体验。

本盘点将 KaTrain 功能拆成需求条目，作为后续定义我们自己的 PWA + Go 后台产品功能池的输入。

## 功能域总览

- 棋局创建、编辑、摆局和规则设置
- SGF/NGF/GIB 文件导入、保存、剪贴板导入导出
- KataGo Analysis Engine 本地、远程、自定义命令三类接入
- 当前局面分析、整局分析、候选点分析、区域分析、持续分析
- 胜率、目差、目损、候选变化图、policy、ownership 可视化
- AI 对局、教学对局、自动悔棋和即时失误反馈
- 多种 AI 风格和强度配置
- 棋谱树分支管理、主分支、折叠、删除、插入交换
- 计时器和读秒
- 性能报告和阶段过滤
- 死活题辅助框架
- KataGo 分布式训练贡献模式
- 主题、音效、快捷键、多语言、窗口状态和错误恢复

## 1. 平台、安装和分发

### KR-PLAT-001 桌面平台支持

KaTrain 支持 Windows、macOS、Linux 桌面环境。安装文档给出 Windows 可执行文件、macOS Homebrew/DMG/Python 安装、Linux Python 安装路径。

### KR-PLAT-002 Python 包安装

用户可以通过 `pipx install katrain` 或 `pip3 install -U katrain` 安装。项目要求 Python `>=3.10,<3.14`。

### KR-PLAT-003 预置资源

应用包包含默认模型、字体、图片、声音、KataGo 配置和部分平台 KataGo 可执行文件。Windows 包含运行所需 DLL。

### KR-PLAT-004 平台相关故障提示

应用和文档覆盖平台相关问题：macOS 未签名应用提示、Linux 缺依赖或 libzip 兼容问题、Windows DLL 问题、OpenCL/GPU 不可用时切换 CPU Eigen 版本。

## 2. KataGo 引擎管理

### KR-ENG-001 本地 KataGo Analysis Engine

应用能启动本地 `katago analysis` 子进程，并通过 JSON line 协议发送分析请求、读取分析结果、读取 stderr 日志、关闭和重启进程。

### KR-ENG-002 远程 KataGo WebSocket 引擎

应用支持配置 `ws://` 或 `wss://` 远程 KataGo Analysis Engine URL，通过 WebSocket 发送同样的 Analysis Engine JSON 请求。断线后会自动重连，并重发未完成查询。

### KR-ENG-003 自定义引擎命令

用户可以覆盖完整 KataGo 启动命令，用于高级本地配置或连接外部服务。README 明确要求使用 KataGo Analysis Engine，而不是 GTP Engine。

### KR-ENG-004 引擎后端切换

设置页提供 Local engine、Remote engine、Custom command 三个 tab。被选中的 tab 决定当前引擎后端。

### KR-ENG-005 模型管理

用户可以选择 KataGo 模型路径，下载模型，扫描已有模型。支持默认模型、推荐模型、最新/最强分布式训练模型、human-like model。

### KR-ENG-006 KataGo 可执行文件管理

用户可以指定 KataGo 可执行文件路径，下载不同 KataGo 版本。下载项包含 OpenCL、Eigen AVX2、Eigen CPU、bigger boards 等平台版本。

### KR-ENG-007 引擎参数配置

用户可以配置最大 visits、快速分析 visits、最大分析时间、wide root noise、KataGo config 文件路径和 debug level。

### KR-ENG-008 Ownership 开关

引擎请求可包含 `includeOwnership`、`includeMovesOwnership`，用于期望地盘和棋子强弱可视化。

### KR-ENG-009 Human-like model

配置支持 `humanlike_model`，启动 KataGo 时可追加 `-human-model`，供 Human-like / Historical Pro AI 使用。

### KR-ENG-010 引擎错误恢复

引擎启动失败、进程异常退出、远程断开、模型/配置/可执行文件缺失时，应用显示恢复弹窗，提供重试、跳转设置、查看帮助的入口。

## 3. 棋局创建、编辑和规则

### KR-GAME-001 新建棋局

用户可以创建新棋局，设置黑白玩家、玩家类型、AI 策略、棋盘大小、让子、贴目和规则。

### KR-GAME-002 编辑当前棋局信息

用户可以编辑当前棋局的玩家名称、规则和贴目。规则或贴目变化后，应用会触发整局重新分析。

### KR-GAME-003 支持多种规则

规则选择包括 Japanese、Chinese、Korean、AGA、Tromp-Taylor、New Zealand、Ancient Chinese/stone_scoring。内部也接受规则 JSON。

### KR-GAME-004 支持棋盘尺寸配置

默认支持 19、13、9 路快捷输入，也支持 `x:y` 非正方棋盘格式。

### KR-GAME-005 支持让子和贴目快捷设置

新局设置包含让子数和贴目；快捷按钮覆盖常见值，例如让子 0/2/9、贴目 0.5/6.5/7.5。

### KR-GAME-006 清除分析缓存

新局时可以选择 clear cache，避免沿用旧分析缓存。

### KR-GAME-007 摆局生成

新局弹窗包含 Set up Position 模式，用户输入目标黑方优势和生成到第几手，系统通过 AI self-play 生成一个接近目标局势的棋局。

### KR-GAME-008 落子合法性

核心棋局模型负责落子、提子、劫、禁入点、pass、resign、初始摆子等规则校验。

## 4. 玩家和 AI 对局

### KR-AI-001 玩家类型

黑白双方均可独立设置为 Human 或 AI。

### KR-AI-002 人类玩家游戏类型

人类玩家支持 Normal Game 和 Teaching Game。Teaching Game 会分析人类落子并按阈值自动悔棋。

### KR-AI-003 AI 策略选择

AI 玩家支持多种策略：KataGo、KataHandicap、Simple Style、Score Loss、Policy、Policy Weighted、Blinded Policy、Local Style、Tenuki Style、Influential Style、Territorial Style、Calibrated Rank、KataJigo、KataAntiMirror、Human-like、Historical Pro。

### KR-AI-004 AI 强度估计

AI 设置页根据策略参数显示 Estimated Strength。部分策略通过预置 Elo/等级映射估计棋力。

### KR-AI-005 完整 KataGo AI

KataGo 策略直接选择引擎分析的最优候选手，作为强 AI 对手。

### KR-AI-006 让子 AI

KataHandicap 使用 KataGo playoutDoublingAdvantage 参数，可自动或手动设置 PDA，用于让子局平衡。

### KR-AI-007 目损 AI

Score Loss 按预期目损选择候选手，用于制造较稳定的小失误。

### KR-AI-008 Policy 系列 AI

Policy 使用 policy 网络最优点；Policy Weighted 按 policy 加权随机；Blinded Policy 在部分候选中选择。

### KR-AI-009 风格化弱 AI

Local、Tenuki、Influential、Territorial 等策略按距上一手、远离上一手、偏中央影响、偏边角实地等权重改造 policy 候选。

### KR-AI-010 Calibrated Rank

Calibrated Rank 以 kyu/dan 等级参数控制弱化程度，目标是模拟稳定的等级棋力。

### KR-AI-011 Simple Style

Simple Style 偏向双方地盘更明确、变化更简单的招法，包含最大目损、settled weight、opponent factor、最小 visits、贴/脱先惩罚等参数。

### KR-AI-012 Jigo 和 AntiMirror

KataJigo 尝试以 0.5 目取胜；KataAntiMirror 使用 KataGo antiMirror 设置针对模仿棋。

### KR-AI-013 Human-like / Historical Pro

Human-like 可按人类等级和现代/旧式风格选择 humanSLProfile；Historical Pro 可按年份选择职业棋手风格。依赖 human-like model。

### KR-AI-014 强制 AI 落子

分析菜单和快捷键支持当前轮到哪方都强制让 AI 走一步。

## 5. SGF、文件和剪贴板

### KR-SGF-001 文件导入

用户可以加载 SGF、NGF、GIB 文件。加载弹窗支持选择是否使用 fast analysis、是否 rewind 到开局。

### KR-SGF-002 文件保存

用户可以保存当前棋局为 SGF，或 Save As 到新路径。

### KR-SGF-003 自动生成文件名

保存弹窗会基于当前棋局生成建议文件名。

### KR-SGF-004 剪贴板导入

用户可以通过 Ctrl+V 从剪贴板导入 SGF；如果剪贴板是 URL，应用尝试下载 URL 内容并解析。

### KR-SGF-005 剪贴板导出

用户可以通过 Ctrl+C 将当前棋局 SGF 写入剪贴板。

### KR-SGF-006 SGF 注释

每个局面支持用户 notes。应用可把分析、目损、AI 思路、教学反馈等写入 SGF 注释。

### KR-SGF-007 SGF 分析缓存

教学/分析设置中支持将分析结果缓存进 SGF，便于后续加载时复用。

### KR-SGF-008 多分支棋谱树

SGF 分支被映射为棋谱树，支持选择当前节点、切换分支、添加变化、删除节点、主分支调整和分支折叠。

## 6. 棋盘、导航和棋谱树交互

### KR-BOARD-001 棋盘显示

棋盘显示黑白棋子、坐标、提子数、当前轮次、pass、游戏结束状态和引擎状态。

### KR-BOARD-002 棋盘旋转

用户可以旋转棋盘显示。

### KR-BOARD-003 坐标开关

用户可以切换棋盘坐标显示。

### KR-BOARD-004 悔棋和重做

支持单步悔棋/重做、10 步跳转、到开局/终局跳转。AI 对局中 Undo 可同时撤销 AI 和人类最近一手。

### KR-BOARD-005 按失误导航

支持跳到上一处或下一处人类明显失误前一手。

### KR-BOARD-006 分支导航

支持上下切换分支、返回上一个分叉点、返回主分支。

### KR-BOARD-007 分支编辑

支持删除当前节点、折叠/展开分支、将当前节点设为主分支、剪枝分支。

### KR-BOARD-008 变化图滚动

鼠标滚轮在棋盘或控制区可前进/后退棋局；在候选变化图上可滚动浏览 PV。

### KR-BOARD-009 添加 PV 到棋谱树

中键滚轮点击可将当前浏览到的 principal variation 添加到棋谱树。

### KR-BOARD-010 点击历史招法查看详情

点击棋盘上的历史招法可查看该手详细统计和当时推荐变化；双击可直接导航到该手之前。

### KR-BOARD-011 极简/Zen UI

应用支持循环切换更简化的 UI 模式。

## 7. 分析展示

### KR-ANV-001 Play / Analysis 双模式

应用支持 Play 和 Analysis 模式切换。Analysis 模式暂停 AI 自动落子、教学模式和计时器，并保存独立的分析控制状态和侧边面板状态。

### KR-ANV-002 子节点显示

用户可以切换是否显示当前棋谱树子节点。

### KR-ANV-003 目损点显示

应用以彩色点显示最近若干手的目损。颜色表示失误大小，点大小表示该失误是否实际被惩罚。

### KR-ANV-004 候选点显示

应用显示 KataGo 当前考虑的 top moves，并用目损、胜率、visits 等指标标注。

### KR-ANV-005 Policy 显示

应用显示 KataGo policy 网络对下一手的直觉评估。开启 policy 时会关闭 top moves 以避免重叠。

### KR-ANV-006 Ownership 显示

应用显示每个交叉点的预期归属，也可在主题中控制 blended、shaded、marks、blocks 等样式。

### KR-ANV-007 候选变化图

鼠标悬停候选点可查看 principal variation，支持动画显示变化序列。

### KR-ANV-008 统计面板

应用显示当前局面胜率、估计目差、目损、点数变化等统计。

### KR-ANV-009 曲线图

应用提供 Score Graph / Win Rate 图表，显示棋局进程中的目差和胜率变化。

### KR-ANV-010 信息和笔记面板

应用显示当前手信息、推荐最佳手、PV、policy 排名、AI thought process、用户 SGF notes。

## 8. 分析动作

### KR-ANA-001 当前局面深度分析

用户可请求 Deeper analysis，对当前局面追加更多 visits。

### KR-ANA-002 候选点 visits 均衡

Equalize visits 会把当前显示的候选点重新分析到相同 visits 水平，提高比较可信度。

### KR-ANA-003 全盘点快速扫描

Analyze all moves / sweep 对棋盘上所有可能下一手执行 fast visits 分析。

### KR-ANA-004 寻找替代点

Find alternatives 会排除当前候选点，请求 KataGo 搜索不同候选。

### KR-ANA-005 区域分析

用户可框选 region of interest，只搜索指定区域内的下一手。用于局部定式、死活和局部战斗分析。

### KR-ANA-006 重置当前分析

Reset analysis 清除当前节点额外探索，恢复普通查询结果。

### KR-ANA-007 插入交换

Insert moves 允许在已有分支中插入交换，结束后复制后续主线，用于双方漏下关键交换或死活交换时改进分析。

### KR-ANA-008 快速自战到终局

Fast playout to game end 会让 AI 从当前局面下到终局，并把结果作为折叠分支加入棋谱树，用于估计失误的潜在影响。

### KR-ANA-009 持续分析

Continuous analysis/pondering 在没有其他查询时持续提升当前局面的分析深度。

### KR-ANA-010 停止分析

Escape 可停止所有分析，并终止引擎中的 pending query 和 pondering。

### KR-ANA-011 整局深度分析

Deeper full game analysis 支持对整局重新分析到指定 visits。

### KR-ANA-012 只分析失误

整局深度分析弹窗支持 mistakes only，只重新分析超过阈值的节点。

### KR-ANA-013 限定手数区间

整局深度分析弹窗支持 from move / to move，只分析指定手数范围。

### KR-ANA-014 性能报告

Performance Report 生成双方统计，包括 accuracy rating、平均目损、AI 最佳手匹配率、AI Top 5 匹配率、不同失误等级的数量分布。

### KR-ANA-015 阶段过滤报告

性能报告可切换 Entire Game、Opening、Midgame、Endgame。

### KR-ANA-016 死活题框架

Tsumego Frame 可在角部/边部死活题外生成墙，提升 KataGo 对局部死活问题的分析能力。设置包含 wall distance 和是否允许 ko。

## 9. 教学和即时反馈

### KR-TEACH-001 Teaching Game

在 Teaching Game 中，应用分析用户招法，如果目损超过配置阈值，会自动悔棋并提示。

### KR-TEACH-002 自动悔棋阈值

Teaching/Analysis Settings 支持按多个颜色等级配置 point loss threshold 和对应自动悔棋次数/概率。

### KR-TEACH-003 最近招法反馈点

用户可配置最近多少手显示反馈点。

### KR-TEACH-004 AI 玩家反馈开关

可配置是否为 AI 玩家显示 dots 或写入 SGF comments。

### KR-TEACH-005 SGF 反馈保存

可配置哪些失误等级的 dots/feedback 保存到 SGF。

### KR-TEACH-006 近零目损精度

可配置接近 0 的目损是否显示两位小数。

### KR-TEACH-007 失误音效

当用户出现满足阈值的失误时，可播放 mistake sounds。提子、落子、倒计时也有音效。

### KR-TEACH-008 走得太快提示

计时器设置支持 minimal time use；在读秒中如果思考时间低于该值，应用提示用户至少思考指定秒数。

## 10. 计时器

### KR-TIMER-001 主时间

用户可配置 main time，单位分钟。

### KR-TIMER-002 读秒

用户可配置 byo-yomi period length 和 period count。

### KR-TIMER-003 计时暂停

用户可暂停/恢复计时器。进入设置弹窗时计时会暂停。

### KR-TIMER-004 倒计时音效

可配置倒计时声音开关。

### KR-TIMER-005 计时重置

更新计时设置后，会重置双方读秒次数、当前节点用时和主时间用时。

## 11. 分布式训练贡献

### KR-CONTRIB-001 KataGo 分布式训练入口

主菜单提供 Distributed Self-play Training，进入贡献模式。

### KR-CONTRIB-002 贡献账号配置

用户配置 katagotraining.org 用户名和密码。应用提示密码以明文保存，不应复用。

### KR-CONTRIB-003 贡献引擎配置

用户可配置贡献模式 KataGo 路径、contribute config 文件、同时运行局数、是否启用 ownership。

### KR-CONTRIB-004 贡献观看设置

用户可配置展示自战棋局的 move speed。

### KR-CONTRIB-005 保存贡献 SGF

用户可选择保存已展示完成的贡献自战 SGF 到 `./dist_sgf`。

### KR-CONTRIB-006 贡献模式 UI 锁定

贡献模式运行时，大部分普通棋局操作被锁定；用户主要观看训练棋局。

### KR-CONTRIB-007 贡献暂停和退出

贡献模式支持空格切换自动播放/手动浏览，Pause 暂停/恢复贡献，Escape 发送 quit 让 KataGo 完成部分游戏后退出。

## 12. 设置和配置持久化

### KR-CONFIG-001 配置文件

应用配置保存在用户数据目录，默认目录为 `~/.katrain`。设置页展示配置文件路径。

### KR-CONFIG-002 通用设置

通用设置包含 PV 动画间隔、启动时恢复窗口大小、debug level。

### KR-CONFIG-003 引擎设置热更新

修改引擎路径、模型、配置、后端等关键项后，应用重启引擎并重新分析。

### KR-CONFIG-004 分析强度热更新

修改 max visits、fast visits、max time、wide root noise 等分析参数不必完全重启引擎。

### KR-CONFIG-005 窗口状态保存

应用退出时保存窗口大小和位置；下次启动可恢复。

### KR-CONFIG-006 UI 状态分模式保存

Play 和 Analyze 模式分别保存分析开关和侧边面板展开状态。

## 13. 主题、视觉和音效

### KR-THEME-001 内置主题

Teaching/Analysis Settings 支持选择反馈颜色主题，包括默认主题和红绿弱友好主题。

### KR-THEME-002 用户自定义主题

用户可以在 `~/.katrain` 放置 `theme-*.json` 覆盖 Theme 类变量。多个主题文件按字母序后者覆盖前者。

### KR-THEME-003 资源覆盖

应用优先从 `~/.katrain` 查找资源，用户可覆盖图片、声音等素材。

### KR-THEME-004 Ownership 可视化样式

主题支持 blended、shaded、marks、blocks 四种 territory display，支持 all/weak/none stone marks 和棋子透明度。

### KR-THEME-005 快捷键主题化

主题文件可覆盖快捷键变量。

## 14. 多语言

### KR-I18N-001 多语言 UI

应用包含 gettext 本地化资源。菜单显示语言切换入口。

### KR-I18N-002 支持语言

UI 中提供 English、German、French、Ukrainian、Russian、Simplified Chinese、Traditional Chinese、Korean、Japanese、Turkish。Spanish 资源存在但 UI 中切换按钮被注释。

### KR-I18N-003 字体资源

应用内置 NotoSans、NotoSansCJKsc、NotoSansJP 等字体，支撑多语言显示。

## 15. 快捷键和菜单

### KR-SHORT-001 主菜单

主菜单包含 Player Setup、New Game/Change Rules、Save Game、Save Game As、Load Game、Timer Settings、Teaching/Analysis Settings、AI Settings、General & Engine Settings、Distributed Self-play Training、Language、Manual、Support。

### KR-SHORT-002 文件快捷键

Ctrl+N 新局，Ctrl+S 保存，Ctrl+D 另存为，Ctrl+L 加载，Ctrl+C 复制 SGF，Ctrl+V 导入剪贴板 SGF。

### KR-SHORT-003 分析快捷键

q 子节点，w dots，e top moves，r policy，t territory，a deeper analysis，s equalize，d sweep，f alternatives，g region，h reset，i insert，l play to end，space continuous，enter AI move。

### KR-SHORT-004 面板快捷键

F2 整局深度分析，F3 性能报告，F5 计时设置，F6 教学设置，F7 AI 设置，F8 通用/引擎设置，F9 贡献训练，F10 死活框，F12/反引号 Zen UI。

### KR-SHORT-005 导航快捷键

左右方向键或 z/x 悔棋/重做；Shift 一次 10 手；Ctrl 到开局/终局；Home/End 跳开局/终局；上下切换分支；PageUp 设为主分支；Ctrl+Delete 删除节点；c 折叠分支；b 回到分叉；n 跳到下一处失误。

### KR-SHORT-006 计时和棋盘快捷键

p pass，Pause 暂停/恢复计时，k 坐标显示开关，m 手数显示开关，Alt 打开主菜单。

## 16. 数据、缓存和后台行为

### KR-DATA-001 分析请求队列

引擎层维护分析请求队列和 query id，将回调与 KataGo 返回结果匹配。

### KR-DATA-002 查询优先级

不同分析类型有优先级：整局分析、sweep、alternative、equalize、默认新手分析、AI 查询等。

### KR-DATA-003 过期结果丢弃

新局、节点重置、查询终止后，旧 query 结果会被丢弃，避免污染当前局面。

### KR-DATA-004 Pending 查询终止

应用可对当前节点或所有节点发送 terminate query，用于停止分析、切换新局、重置分析。

### KR-DATA-005 Ponder 去重

持续分析通过超大 maxVisits 和 reportDuringSearchEvery 实现，并对相同局面的 ponder query 去重。

### KR-DATA-006 分析结果挂载节点

每个 GameNode 持有 root analysis、candidate moves、policy、ownership、visits、目损、AI thoughts、用户 notes 等数据。

## 17. 非功能和边界信息

### KR-NFR-001 不等同于 GTP 引擎 GUI

KaTrain 使用 KataGo Analysis Engine，不以 GTP Engine 为核心协议。对接重点是 JSON 分析请求，而不是传统 `play/genmove` 文本协议。

### KR-NFR-002 GPU/CPU 差异可配置

应用需要处理 OpenCL/GPU 不可用、CPU Eigen 性能较慢、多 GPU 配置、模型和可执行文件版本不兼容等问题。

### KR-NFR-003 大模型和大棋盘兼容性

KataGo 可执行文件和模型版本可能不兼容，特别是 older bigger boards binary 与新分布式模型。应用需要在配置和错误提示中覆盖。

### KR-NFR-004 离线优先

核心复盘和对局功能可以在本地 KataGo、模型和配置存在时离线运行。下载模型、远程引擎、分布式训练、打开外部帮助链接依赖网络。

## 后续转化建议

这份文档只列 KaTrain 功能池。下一步应单独创建“我们的产品需求分层”文档，把每条功能标注为：

- MVP 必须
- v1 应做
- later 可做
- 不做或改造后做

建议优先从以下闭环抽取 MVP：打开 SGF、新建棋局、棋盘/棋谱树、KataGo Analysis Engine、当前节点分析、候选点/目差/胜率展示、整局 fast analysis、最大失误定位、保存带注释 SGF。

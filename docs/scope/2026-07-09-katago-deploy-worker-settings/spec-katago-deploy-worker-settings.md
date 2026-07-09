> 由 scope skill 于 2026-07-09 生成

# KataGo Deploy And Worker Settings

## 目标

当前 Windows 发布流程依赖手工准备 KataGo 可执行文件和模型，`deploy.bat` 失败时也不够可见；Worker 设置页只能显示状态，不能配置实际分析参数。本次目标是把 Windows 发布收敛为一个可重复运行的 `deploy.bat`：先完成下载、整理和编译的 staging，再在 staging 全部成功后停止服务并发布到 `~\.jcgo`；同时让每个在线 Worker 自己持久化并上报 `model/maxVisits/backend`，设置页可以配置在线 Worker 的模型和 visits。

## 决策

- 发布入口只有 `deploy.bat`，它覆盖下载、环境检查、资产 staging、前后端编译、发布安装的完整流程。
- `deploy.bat` 分为 Stage 和 Publish 两段。Stage 全部成功前不停止当前服务，不修改 `~\.jcgo`。
- 编译产物也先进入 staging 目录，Publish 阶段只从 staging 复制到发布目录。
- 构建环境只做检查和明确报错，不自动安装 Go、Node、npm 或 Visual Studio Build Tools。
- manifest 只描述可下载项和发布选择，不包含 `sha256`，也不包含默认运行配置。
- 首版 manifest 固定使用 KataGo `v1.16.5`。
- manifest 同时列出 OpenCL 和 CUDA 12.8/cuDNN 9.8.0 下载项，但只用 `publishBackend` 指定一个后端发布为 `~\.jcgo\bin\katago.exe` 及依赖文件。
- 后端下载项为 `katago-v1.16.5-opencl-windows-x64.zip` 和 `katago-v1.16.5-cuda12.8-cudnn9.8.0-windows-x64.zip`。
- 发布目录只维护一个实际使用的 KataGo 程序，不保留多个可切换后端。
- 模型下载三档：`b18`、`b28`、`zhizi`，保留官方原始文件名。
- 模型文件为 `kata1-b18c384nbt-s9996604416-d4316597426.bin.gz`、`kata1-b28c512nbt-s13255194368-d5935380940.bin.gz`、`kata1-zhizi-b40c768nbt-s11272M-d5935M.bin.gz`。
- 不覆盖已有 `~\.jcgo\config.json`。
- Worker 本地持久化自己的 `model/maxVisits`。没有本地配置时内置默认使用 b18 模型和 500 visits。
- Worker 连接主服务时上报当前 `model/maxVisits/backend/status`。
- 设置页只配置在线 Worker 的 `model/maxVisits`，不提供 backend 切换。
- 主服务通过现有 Worker WebSocket 给在线 Worker 发送配置消息；Worker 保存到本地，并按需重启 KataGo 子进程。
- 主服务不维护离线 Worker pending config，也不把 Worker 运行配置作为权威状态存 SQLite。

## 架构

系统由四部分组成：manifest、`deploy.bat` 发布流水线、Worker 配置协议、设置页 UI。manifest 位于仓库内，声明 KataGo 后端下载项、模型下载项和 `publishBackend`。`deploy.bat` 读取 manifest 并执行 Stage/Publish。Worker 启动时从自己的本地配置读取 `model/maxVisits`，根据发布目录中的单一 `katago.exe` 运行分析，并把状态注册到主服务。设置页通过主服务显示在线 Worker 状态，并对单个在线 Worker 发起配置更新。

## 流程

Stage 阶段：

1. 检查 PowerShell 基础能力、Go、Node、npm。
2. 读取 manifest。
3. 下载缺失的 KataGo OpenCL 和 CUDA 12.8 包到仓库内 staging/cache，并分目录解压整理。
4. 下载缺失的 b18、b28、zhizi 模型到仓库内 staging/cache，保留官方文件名。
5. 构建前端资源。
6. 编译 `jcgo.exe` 和 `jcgo-worker.exe` 到 staging。
7. 准备将被发布的目录结构和脚本，但不停止服务，不写入 `~\.jcgo`。

Publish 阶段：

1. 确认 Stage 已完整成功。
2. 停止当前 `jcgo.exe`、`jcgo-worker.exe`、`katago.exe`。
3. 按 manifest 的 `publishBackend` 从 staging 选择一个 KataGo 后端，发布为 `~\.jcgo\bin\katago.exe` 及依赖文件。
4. 复制模型、JCGO 二进制、前端资源、配置模板和脚本到 `~\.jcgo`。
5. 保留已有 `~\.jcgo\config.json`；仅在不存在时创建默认配置。
6. 更新 `start.bat` 和 `stop.bat`。
7. 出错时保留窗口并输出日志路径。

Worker 配置流程：

1. Worker 启动后读取本地持久化的 `model/maxVisits`；不存在时使用 b18 和 500 visits。
2. Worker 从发布目录识别当前 backend，并连接主服务注册状态。
3. 设置页显示在线 Worker 的名称、可用性、backend、model、maxVisits 和错误信息。
4. 用户修改在线 Worker 的 model 或 maxVisits 后，主服务通过 WebSocket 发送配置消息。
5. Worker 校验模型文件存在，保存配置；如果模型变化则在空闲时重启 KataGo 子进程。
6. Worker 重新上报配置和状态。

## 验收标准

- 运行 `deploy.bat` 时，缺失 Go、Node 或 npm 会明确失败，窗口不一闪而过，并给出日志路径。
- Stage 失败不会停止当前服务，也不会修改 `~\.jcgo`。
- Stage 成功后 Publish 才停止并替换当前运行环境。
- 重复运行 `deploy.bat` 会复用已下载资产，缺什么补什么。
- `deploy.bat` 不覆盖已有 `~\.jcgo\config.json`。
- 发布目录下只有一个实际使用的 `katago.exe` 后端。
- manifest 修改 `publishBackend` 后重新部署，可以切换发布的 KataGo 后端。
- b18、b28、zhizi 三个模型以官方文件名发布到模型目录。
- Worker 注册状态包含 backend、model、maxVisits。
- 设置页可以对在线 Worker 修改 model 和 maxVisits，并在保存后看到 Worker 回报的新配置。
- 修改 maxVisits 不要求重启 Worker 进程。
- 修改 model 不要求手动重启 Worker 进程；Worker 可在空闲时重启 KataGo 子进程。

### 测试

- 后端单元测试覆盖 manifest 解析、Stage/Publish 顺序、config 不覆盖、单后端发布、Worker 配置消息和状态上报。
- 前端组件测试覆盖设置页显示 Worker 配置、修改 model/maxVisits、错误和不可用状态。
- 发布脚本测试覆盖缺环境失败、缺资产下载、重复运行、Stage 失败不触发停止服务。
- 手工验证一次 `deploy.bat`，再启动 `~\.jcgo\start.bat`，确认设置页能看到 Worker 状态并完成一次分析。

## 范围之外

- 不自动安装 Go、Node、npm、CUDA 或驱动。
- 不在设置页切换 OpenCL/CUDA backend。
- 不支持离线 Worker 的 pending config。
- 不引入 `sha256` 校验。
- 不改模型文件名。
- 不增加 KataGo TensorRT、Eigen 或其他后端。

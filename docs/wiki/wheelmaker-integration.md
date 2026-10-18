> 摘要：本页维护 JCGO Server、Worker 接入 WheelMaker 独立管理、应用转发、路径与部署维护的约定。

# WheelMaker 接入

## 职责与运行方式

| 条目 | 职责 | 控制入口 |
| --- | --- | --- |
| jcgo-server / JCGO Server | HTTP、数据库、客户端与 Worker 连接、分析调度 | Hub Apps → Monitor，独立启停、重启、健康与日志 |
| jcgo-worker / JCGO Worker | 连接配置的 Server、管理 KataGo 与分析执行 | 同上，独立条目 |
| jcgo 转发映射 | 将 Server 发布到应用 HTTPS Origin 下的 /jcgo/ | Hub Apps → Forward |

两个根进程无启动顺序依赖。Worker 暂时无法连接 Server 时保持运行并退避重连；停止 Worker 不停止棋谱浏览和已有结果访问。KataGo 归 Worker 所有，Hub 监督 Worker 的整个进程树。Server 不启动 Worker，Worker 不注册转发。

JCGO 保留根路径、现有 Token 认证、配置、SQLite、棋谱和同名分析文件。应用管理使用既有 stdio protocol 1；转发使用连接持有的本机注册协议，不改变 WheelMaker Registry 协议版本。健康就绪与公网发布是独立事实，转发故障不会触发业务进程重启。

## 配置接入

先安装支持受管协议的 JCGO，停止独立实例，再运行：

```powershell
.\scripts\connect-wheelmaker.ps1
```

脚本增量合并 JCGO 的 hub 配置与 WheelMaker 主 config.json 的两个 apps 启动定义，保留 Token、项目及其他应用；文件采用原子替换。可用 -JcgoDir 与 -HubStateDir 指定非默认目录。随后在 Monitor 执行 Reload，直接启动安装目录中的 jcgo.exe 和 jcgo-worker.exe，各自带 --dir 参数和正确工作目录。

JCGO 配置的 hub.enabled 缺省为 false；启用时 Server 在受管和独立运行方式下均自主发布。hub.stateDir 缺省为当前账号的 ~/.wheelmaker。应用与 Hub 必须使用同一 OS 账号，JCGO 仅根据数据目录连接 IPC，不读取 Hub Token。

Forward 显示实际 publicUrl，应用域名由 Gateway 统一配置。Server 先绑定回环 HTTP listener，再登记实际 origin；目标不包含 /jcgo/ 路径。Hub 不可用时仍提供本地服务，注册连接恢复后重新 open；退出关闭注册连接，Hub 撤销映射。应用 ID 冲突保留原占有者，并报告发布错误。

## 生命周期与健康

受管模式由 WHEELMAKER_APP_MANAGED=1 启用。stdin 接收 initialize、health、shutdown；stdout 仅输出带 appId/instanceId 的有界 JSON Lines，业务日志写 stderr 与现有文件日志。stdin EOF 与系统退出信号也走同一清理路径。

Server 的健康区分 HTTP、存储和 Worker 可用性；Worker 区分 Server 连接与 KataGo 状态。Worker 控制循环就绪后即可报告 ready，模型初始化或长分析不阻塞健康查询；无可用引擎或连接重试显示降级。停止时取消连接重试与分析，关闭 WebSocket 并等待 KataGo 清理；Server 关闭升级连接、调度与数据库。

按数据目录和角色分别持有 OS 文件锁，Server 与 Worker 可各有一个实例，同角色并发启动会被拒绝。run/server.lock 和 run/worker.lock 记录当前所有者是否受管；维护判断以活动文件锁为准，不信任 PID 或退出后残留的标记。

## 路径、PWA 与清理

同一份 Web 资源支持 / 和 /jcgo/，后端为入口及 SPA fallback 生成相应 base。API、WebSocket、音效、图标和 SGF 分享地址按当前入口构造；原有本机 /worker 与前缀 /jcgo/worker 使用相同协议和鉴权。

manifest 使用相对 id、start_url、scope、图标及 share_target，Service Worker 只在相应入口注册。根路径沿用 jcgo-shared-v1 分享缓存，前缀使用包含编码路径的命名空间，更新仅清理本入口的旧 JCGO 缓存，并保留分享缓存和其他应用缓存。

Android Remote Shell 保存完整 HTTPS 地址并保留 /jcgo/。切换入口时注入脚本只清理 jcgo.* 存储键、当前入口的 JCGO 缓存与注册，不使用全局 WebStorage、Cookie、缓存或所有 Service Worker 清理。不同应用共享 Origin 时，路径和命名空间不是安全隔离边界。

## 部署维护

受管维护先在 Monitor 停 Worker，再停 Server，确认退出后部署，成功后重新 Start。不要直接强杀进程：Hub 会对异常退出执行自己的重启策略。维护期间重启 Hub 会重新启动配置中的应用。

部署和停止脚本遇到活动受管所有者时，在强杀或替换安装目录前拒绝操作并提示 Hub Monitor。旧启动脚本不会重复启动已有根进程；独立运行仍可使用 start.bat / stop.bat。配置合并脚本不替用户控制 Hub，也不改变期望启停状态。

发布映射变化会重建同 Hub 的 apps 隧道，其他应用的转发可能短暂重连；业务进程不联动启停。维护时应区分“其他应用进程持续运行”和“所有活动转发连接均不中断”。

## 验证与来源

2026-10-18 已验证真实 AppHost 与应用隧道、Server/Worker 独立生命周期、长分析时健康和退出、注册恢复、双路径认证与静态资源、实际浏览器 PWA 分享与更新隔离，以及已安装 KataGo + b18 模型的真实分析结果。Android 地址策略与 Remote Shell 共 15 项 JVM 测试通过；当次无 ADB 设备，原生设备运行未执行，清理脚本另在真实浏览器验证。

实现入口：[Server](../../cmd/jcgo/main.go)、[Worker](../../cmd/jcgo-worker/main.go)、[受管适配](../../internal/managed/control.go)、[本机发布](../../internal/hubregistration/publisher.go)、[浏览器集成验收](../../e2e/wheelmaker-integration.mjs)。设计基线位于同级 WheelMaker 仓库 docs/scope/2026-10-18-jcgo-wheelmaker-integration.md。

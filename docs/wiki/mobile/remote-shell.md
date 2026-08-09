> 摘要：JCGO Android 使用本地 Bootstrap 加载 HTTPS 远程 Web UI，APK 壳与 Web 功能独立更新。

# Android Remote Shell

JCGO Android 采用 Kotlin 原生 WebView Remote Shell，不把 React/Vite 的生产资源作为 APK 主体打包。APK 只内置一个本地 Bootstrap 页面，用户输入 HTTPS 服务地址后，原生层校验并探测地址、持久化地址，然后让 WebView 加载远端 JCGO Web UI。

## 服务边界

- Nginx 负责 HTTPS 和 WSS 入口，反向代理 `/` 与 `/ws` 到本机 Go 服务。
- Go 服务和 KataGo 继续运行在服务器端；Android 不运行 Go 后端、数据库或 KataGo。
- JCGO 现有网页 token gate 继续负责访问 token；Bootstrap 只负责服务地址，不保存 token。
- WebView 仅允许 HTTPS 站点和配置服务地址范围内的导航，禁止明文流量、文件访问、内容访问和混合内容。

## 更新模型

前端更新通过服务器完成：重新发布服务端的 `web/dist` 后，APK 重启或重新加载即可使用新 Web UI。当前不实现 APK 自身下载、签名校验和自更新；只有原生壳能力变化时才需要重新构建 APK。

## 服务切换

切换到新的 HTTPS 服务地址时，原生层应清理旧服务的 WebView storage、缓存、Service Worker 和 Android 侧服务状态，避免不同 JCGO 实例之间共享登录或业务数据。

## 来源

该架构参考同级 WheelMaker 的 `mobile/android` Remote Shell 实现，结合 JCGO 现有 PWA、WebSocket token 鉴权和 Nginx HTTPS 入口确定。

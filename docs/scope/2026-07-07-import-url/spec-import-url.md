# Import SGF from URL

> 由 scope skill 于 2026-07-07 生成

## 目标

JCGO 当前支持从本地 SGF 文件导入棋谱。用户希望扩展此功能，支持从 URL 直接导入棋谱，首期支持元萝卜（yuanluobo.com）的复盘链接。用户在元萝卜 APP 中分享复盘链接后，粘贴到 JCGO 即可自动获取棋谱数据并导入，无需手动导出 SGF 文件。

## 决策

1. **UI 交互**：点击 "+" 按钮弹出对话框，显示「选择 SGF 文件」和「从链接导入」两个按钮。点击「从链接导入」后对话框切换为 URL 输入界面。
2. **API 设计**：扩展现有 `game.importSgf` 方法，新增可选参数 `url`，不新增独立方法。
3. **代码组织**：URL 解析和平台调用逻辑放在 `internal/app/sgf_import.go`，不新建独立包。
4. **平台识别**：基于域名匹配，`jupiter.yuanluobo.com` 匹配元萝卜。首期只实现元萝卜，代码结构预留扩展性。
5. **前端验证**：不做 URL 格式预验证，直接提交给后端。
6. **游戏名称**：自动使用对局双方名称生成，如 "苏景澄 vs V268990357"，不弹窗让用户输入。
7. **错误处理**：后端返回具体错误信息（如 "不支持的链接格式"、"获取棋谱失败"），前端弹窗显示。
8. **加载状态**：提交后按钮禁用并显示 "导入中..."，成功后关闭对话框并自动选中新游戏，失败后恢复按钮并显示错误。
9. **对话框切换**：同一对话框内切换内容，不弹出新对话框。

## 架构

前端 `ImportDialog` 组件增加 "从链接导入" 按钮和 URL 输入界面。后端 `handlers.go` 的 `importSGF` 方法扩展 `importParams` 结构体，新增 `url` 字段。URL 解析和元萝卜 API 调用逻辑放在 `internal/app/sgf_import.go`。

```
ImportDialog (前端)
  ├─ "选择 SGF 文件" → 现有流程
  └─ "从链接导入" → URL 输入 → 提交
                         ↓
              game.importSgf { url: "..." }
                         ↓
              handlers.go importSGF()
                         ↓
              sgf_import.go
                ├─ parseReviewURL() → 提取 session_id
                ├─ fetchYuanluoboSGF() → 调用 API
                └─ convertToSGF() → 转换格式
                         ↓
              现有 SGF 导入流程
```

## 流程

1. 用户点击 "+" → 弹出对话框，显示两个按钮
2. 用户点击「从链接导入」→ 对话框切换为 URL 输入框 + 确认/取消
3. 用户粘贴 URL，点击确认
4. 前端调用 `game.importSgf`，传 `{ url: "..." }`
5. 后端解析 URL 域名，匹配元萝卜
6. 提取 `session_id`，调用元萝卜 API 获取棋谱数据
7. 转换为 SGF 格式
8. 自动生成显示名称（如 "苏景澄 vs V268990357"）
9. 创建游戏记录，写入 SGF 文件
10. 返回结果，前端自动选中新游戏

## 验收标准

- 点击 "+" 按钮弹出对话框，显示「选择 SGF 文件」和「从链接导入」两个按钮
- 点击「从链接导入」后对话框切换为 URL 输入界面，有确认和取消按钮
- 点取消返回两个按钮界面
- 输入元萝卜复盘链接（如 `https://jupiter.yuanluobo.com/robot-public/all-in-app/go/review?session_id=XXX&...`）点确认后，按钮显示 "导入中..."
- 导入成功后对话框关闭，新游戏自动选中，游戏名称为对局双方名称
- 导入失败时弹窗显示具体错误信息，按钮恢复
- 输入非 yuanluobo.com 域名的 URL 时返回 "不支持的链接格式" 错误
- 输入无法解析的 URL 时返回 "无效的 URL" 错误
- 元萝卜 API 调用失败时返回 "获取棋谱失败" 错误
- 导入的 SGF 文件格式与现有 SGF 导入一致，可被 JCGO 正常解析和分析

### 测试

- 后端：`parseReviewURL()` 单元测试，覆盖正常 URL、非 yuanluobo 域名、缺少 session_id
- 后端：`convertToSGF()` 单元测试，验证 SGF 格式正确性
- 前端：不写新测试，保持现有测试通过

## 范围之外

- 不支持元萝卜棋谱列表批量导入
- 不支持其他平台（如 OGS、KGS 等）
- 不支持需要登录认证的 API（如棋谱列表接口）
- 不做 URL 格式前端预验证
- 不做 URL 历史记录或收藏功能

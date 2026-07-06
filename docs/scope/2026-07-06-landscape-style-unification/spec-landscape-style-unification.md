# 横屏样式统一化

> 由 scope skill 于 2026-07-06 生成

## 目标

竖屏已完成扁平化重构（无边框卡片、透明背景、32px 按钮、7px 圆角），横屏仍保留旧的卡片式设计（有边框、有阴影、36px 按钮、8px 圆角）。目标是让横屏在样式上完全对齐竖屏的扁平化设计语言，仅保留布局（grid 排列方式）的差异。同时将横屏 board-info 改为三行独立结构（⚫黑方 / ⚪白方 / 结果）。

## 决策

1. **统一走竖屏扁平化风格** — 横屏不再使用卡片式设计（`var(--shadow-frame)`、`var(--surface-soft)` 背景、带边框的 rail-section），改用竖屏的透明/无边框风格。
2. **CSS 变量方案** — 提取按钮尺寸、圆角、间距、阴影等为 CSS 自定义属性，base 层定义一套扁平化值，横竖屏 media query 只覆盖布局相关的 grid/padding/方向。不抽公共组件 class（改动面太大）。
3. **Board-info 横竖屏表现不同是合理的** — 竖屏保持横向排列（⚫黑 vs 白 + 结果），横屏改为三行纵向（⚫黑方名 / ⚪白方名 / 结果各自独立）。组件内部结构通过 CSS 控制方向，不拆组件。

## 架构

修改集中在 `web/src/styles.css` 一个文件。组件文件不需要改动（BoardInfo 的横屏三行通过 CSS `flex-direction: column` + `order` 实现，或在 JSX 中通过 class 切换结构）。

关键文件：
- `web/src/styles.css` — 主要修改目标
- `web/src/components/BoardInfo.tsx` — 不改组件结构，横屏通过 `.board-info { flex-direction: column }` + `.board-matchup { flex-direction: column }` 实现三行布局（⚫黑方名 / ⚪白方名 / 结果），竖屏保持 `flex-direction: row`
- `web/src/components/GameSidebar.tsx` — 无需改动
- `web/src/components/NavigationControls.tsx` — 无需改动

## 验收标准

- 横屏 sidebar 按钮尺寸与竖屏一致（32×32px、radius 7px、font 12px）
- 横屏 action-rail 导航按钮与竖屏一致（透明背景、无边框、pill 圆角）
- 横屏 analysis-rail 与竖屏一致（透明背景、无边框、无阴影）
- 横屏 board-info 显示为三行：⚫黑方名、⚪白方名、结果
- 竖屏表现无任何变化
- 横竖屏切换无样式闪烁或布局错乱
- `npm run build` 无报错
- `npm test -- --run` 通过

### 测试

- 视觉回归：横屏 desktop（>1220px）、横屏 tablet（820-1220px）、横屏 small（≤820px）三个断点逐一验证
- 竖屏 narrow（≤820px）和 wide（700-1220px）确认无变化
- 横竖屏旋转切换测试

## 范围之外

- 竖屏的任何样式改动
- 组件逻辑重构（仅 CSS 层面统一）
- 响应式断点重新划分
- side-action-layout 的浮层逻辑

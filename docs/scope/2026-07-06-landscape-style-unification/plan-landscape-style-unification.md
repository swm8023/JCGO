# 横屏样式统一化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让横屏在样式上完全对齐竖屏的扁平化设计语言，仅保留布局差异，同时将横屏 board-info 改为三行独立结构。

**Architecture:** 通过在 `:root` 中提取 UI 组件的 CSS 变量（按钮尺寸、圆角、字号等），将竖屏的扁平化值作为 base 层默认值。横屏 media query 只保留 grid 布局、padding、方向等布局属性，不再覆盖样式值。BoardInfo 通过 CSS `flex-direction` 切换横竖屏方向。

**Tech Stack:** CSS custom properties, React (BoardInfo.tsx), Vitest

---

### Task 1: 提取 CSS 变量到 `:root`

**Files:**
- Modify: `web/src/styles.css:1-49`

- [ ] **Step 1: 在 `:root` 中添加 UI 组件变量**

在 `--app-content-height` 之后、`font-family` 之前添加：

```css
  --ui-btn-size: 32px;
  --ui-btn-radius: 7px;
  --ui-btn-font: 12px;
  --ui-toggle-size: 32px;
  --ui-toggle-radius: 7px;
  --ui-toggle-font: 12px;
  --ui-nav-height: 30px;
  --ui-nav-width: 32px;
  --ui-nav-radius: 999px;
  --ui-nav-try-size: 30px;
  --ui-move-stone-size: 30px;
  --ui-card-radius: 8px;
  --ui-card-min-height: 28px;
  --ui-card-font: 12px;
```

- [ ] **Step 2: 验证 CSS 变量无语法错误**

Run: `cd web && npm run build`
Expected: 无报错

- [ ] **Step 3: Commit**

```bash
git add web/src/styles.css
git commit -m "style: extract UI component CSS variables to :root"
```

---

### Task 2: 更新 base 层 sidebar 样式使用变量

**Files:**
- Modify: `web/src/styles.css` (`.game-sidebar`, `.overlay-toggles .toggle`, `.icon-button`, `.analysis-action-button`)

- [ ] **Step 1: 更新 `.game-sidebar` base 样式**

将 `.game-sidebar`（约 line 204）的 gap 和 padding 改为竖屏风格：

```css
.game-sidebar {
  position: relative;
  z-index: 4;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 6px;
  height: 100%;
  box-sizing: border-box;
  padding: 6px;
  border: 0;
  background: var(--frame);
  box-shadow: none;
}
```

- [ ] **Step 2: 更新 `.overlay-toggles .toggle` 使用变量**

```css
.overlay-toggles .toggle {
  width: var(--ui-toggle-size);
  height: var(--ui-toggle-size);
  border: 1px solid var(--frame-accent);
  border-radius: var(--ui-toggle-radius);
  background: transparent;
  color: var(--frame-muted);
  cursor: pointer;
  font-size: var(--ui-toggle-font);
  font-weight: 700;
  line-height: 1;
}
```

- [ ] **Step 3: 更新 `.icon-button` 使用变量**

```css
.icon-button {
  width: var(--ui-btn-size);
  min-width: var(--ui-btn-size);
  height: var(--ui-btn-size);
  padding: 0;
  border: 1px solid var(--frame-accent);
  border-radius: var(--ui-btn-radius);
  background: var(--frame-accent);
  color: var(--frame-text);
  cursor: pointer;
  font-size: var(--ui-btn-font);
  line-height: 1;
  display: grid;
  place-items: center;
  transition: all 140ms ease;
}
```

- [ ] **Step 4: 更新 `.analysis-action-button` 使用变量**

```css
.analysis-action-button {
  width: var(--ui-btn-size);
  min-width: var(--ui-btn-size);
  max-width: none;
  height: var(--ui-btn-size);
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 0;
  box-sizing: border-box;
  border: 1px solid var(--table-deep);
  border-radius: var(--ui-btn-radius);
  background: var(--table);
  color: var(--surface);
  font-size: var(--ui-btn-font);
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 5: Build 验证**

Run: `cd web && npm run build`
Expected: 无报错

- [ ] **Step 6: Commit**

```bash
git add web/src/styles.css
git commit -m "style: use CSS variables for sidebar button sizing"
```

---

### Task 3: 更新 base 层 action-rail 和 navigation-controls 样式

**Files:**
- Modify: `web/src/styles.css` (`.action-rail`, `.navigation-controls`, `.navigation-controls button`, `.try-action-button`, `.move-number-stone`)

- [ ] **Step 1: 更新 `.action-rail` base 样式**

将 `.action-rail`（约 line 635）改为扁平化风格：

```css
.action-rail {
  display: grid;
  align-content: center;
  justify-content: center;
  padding: 8px 4px;
  background: transparent;
  border: 0;
}
```

- [ ] **Step 2: 更新 `.navigation-controls button` 使用变量**

```css
.navigation-controls button {
  min-width: 0;
  width: 100%;
  max-width: var(--ui-nav-width);
  height: var(--ui-nav-height);
  padding: 0 2px;
  border: 1px solid var(--line);
  border-radius: var(--ui-nav-radius);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
  font-size: var(--ui-btn-font);
  font-weight: 600;
  box-shadow: none;
  overflow: hidden;
  text-overflow: clip;
  white-space: nowrap;
}
```

- [ ] **Step 3: 更新 `.try-action-button` 和 `.move-number-stone` 使用变量**

```css
.try-action-button {
  border-radius: 50%;
  line-height: 1;
}

.navigation-controls .try-action-button {
  width: var(--ui-nav-try-size);
  min-width: var(--ui-nav-try-size);
  max-width: var(--ui-nav-try-size);
  height: var(--ui-nav-try-size);
  padding: 0;
  color: var(--surface);
  font-size: 15px;
  font-weight: 800;
}

.move-number-stone {
  width: var(--ui-move-stone-size);
  height: var(--ui-move-stone-size);
  /* 其余属性不变 */
}
```

- [ ] **Step 4: Build 验证**

Run: `cd web && npm run build`
Expected: 无报错

- [ ] **Step 5: Commit**

```bash
git add web/src/styles.css
git commit -m "style: use CSS variables for navigation controls sizing"
```

---

### Task 4: 更新 base 层 analysis-rail 样式

**Files:**
- Modify: `web/src/styles.css` (`.analysis-rail`, `.rail-section`, `.candidate-row`, `.bad-move`)

- [ ] **Step 1: 更新 `.analysis-rail` base 样式**

```css
.analysis-rail {
  display: grid;
  grid-template-rows: minmax(188px, 264px) minmax(0, 1fr);
  gap: 8px;
  color: var(--muted);
  overflow: hidden;
  max-height: calc(var(--app-content-height) - 16px);
  padding: 8px 8px 8px 4px;
  background: var(--board-zone);
}
```

- [ ] **Step 2: 更新 `.rail-section` 移除卡片样式**

```css
.rail-section {
  display: grid;
  min-height: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
```

- [ ] **Step 3: 更新 `.candidate-row` 和 `.bad-move` 使用变量**

```css
.candidate-row,
.bad-move {
  min-height: var(--ui-card-min-height);
  border: 1px solid var(--line);
  border-radius: var(--ui-card-radius);
  background: var(--surface);
  color: var(--ink);
  box-shadow: none;
}
```

- [ ] **Step 4: 更新 `.candidate-list` 和 `.bad-move-list` gap**

```css
.candidate-list,
.bad-move-list {
  display: grid;
  gap: 4px;
  padding: 1px;
}
```

- [ ] **Step 5: Build 验证**

Run: `cd web && npm run build`
Expected: 无报错

- [ ] **Step 6: Commit**

```bash
git add web/src/styles.css
git commit -m "style: flatten analysis-rail to match portrait design language"
```

---

### Task 5: 清理横屏 media query 中的冗余样式覆盖

**Files:**
- Modify: `web/src/styles.css` (landscape media queries ~line 3006-3204)

- [ ] **Step 1: 清理 mobile landscape (≤520px) 中的冗余样式**

在 `@media (orientation: landscape) and (max-height: 520px)` 块中，移除以下已由 base 层变量覆盖的规则，只保留布局相关的：

保留：`.app-layout` grid-template-columns、`.game-sidebar` padding（布局）、`.board-stage` padding/height/max-height、`.board-frame` clearance、`.action-rail` padding、`.navigation-controls` width/gap、`.analysis-rail` grid-template-rows/gap/max-height/padding、`.analysis-overview` grid-template-rows/gap/padding、`.analysis-summary`/`.analysis-tab-list` height/gap、`.summary-metric` 等布局属性

移除/简化：
- `.icon-button { width: 36px; height: 36px; }` → 删除（base 已是 32px）
- `.analysis-action-button { width: 100%; max-width: 36px; height: 32px; ... }` → 只保留 `max-width: var(--ui-btn-size)`
- `.navigation-controls button { width: 100%; max-width: 36px; height: 32px; font-size: 12px; }` → 只保留布局（width/max-width）
- `.navigation-controls .try-action-button` 等尺寸覆盖 → 删除
- `.move-number-stone` 尺寸覆盖 → 删除
- `.candidate-row, .bad-move { min-height: 28px; ... }` → 删除（base 已是 28px）
- `.analysis-tab` font-size/padding → 删除（与 base 相同）

- [ ] **Step 2: 清理 narrow landscape (≤820px) 中的冗余样式**

在 `@media (orientation: landscape) and (max-width: 820px)` 块中：

保留：`.app-layout` grid-template-columns、`.game-sidebar` grid-template-rows、`.analysis-rail` display:none、`.board-stage` max-height、`.board-frame` clearance

移除：
- `.icon-button { width: 36px; }` → 删除
- `.analysis-action-button { width: 36px; height: 32px; }` → 删除

- [ ] **Step 3: 清理 medium landscape (1101-1220px) 中的冗余样式**

检查此块是否有冗余覆盖，如有则清理。

- [ ] **Step 4: 清理 container query 块中的冗余样式**

检查 `@container app-layout (min-aspect-ratio: 1/1)` 相关的几个块，移除已由 base 层变量覆盖的样式覆盖。

- [ ] **Step 5: Build 验证**

Run: `cd web && npm run build`
Expected: 无报错

- [ ] **Step 6: Commit**

```bash
git add web/src/styles.css
git commit -m "style: remove redundant style overrides from landscape media queries"
```

---

### Task 6: 清理竖屏 media query 中的冗余样式覆盖

**Files:**
- Modify: `web/src/styles.css` (portrait media queries ~line 2398-2696, 2700-3002)

- [ ] **Step 1: 清理 narrow portrait (≤820px) 中的冗余样式**

竖屏的值现在是 base 层默认值，所以竖屏 media query 中与 base 相同的覆盖可以移除。

检查并移除：
- `.overlay-toggles .toggle { width: 32px; height: 32px; border-radius: 7px; font-size: 12px; }` → 删除（与 base 相同）
- `.icon-button { width: 32px; ... border-radius: 7px; font-size: 12px; }` → 删除
- `.analysis-action-button { width: 32px; ... border-radius: 7px; font-size: 12px; }` → 删除
- `.navigation-controls button { width: 32px; ... border-radius: 999px; }` → 删除
- `.move-number-stone { width: 30px; height: 30px; }` → 删除
- `.analysis-overview, .analysis-detail-tabs { border-color: transparent; background: transparent; box-shadow: none; }` → 删除（base 已是透明）
- `.candidate-row, .bad-move { min-height: 28px; ... }` → 删除

保留所有布局相关属性（grid-row、grid-template-columns/rows、padding、gap、order 等）

- [ ] **Step 2: 清理 wide portrait (700-1220px) 中的冗余样式**

同上逻辑，移除与 base 层相同的样式覆盖。

- [ ] **Step 3: Build 验证**

Run: `cd web && npm run build`
Expected: 无报错

- [ ] **Step 4: Commit**

```bash
git add web/src/styles.css
git commit -m "style: remove redundant style overrides from portrait media queries"
```

---

### Task 7: 横屏 board-info 改为三行布局

**Files:**
- Modify: `web/src/styles.css` (横屏 media query 中的 `.board-info` 和 `.board-matchup`)

- [ ] **Step 1: 在横屏 media query 中添加 board-info 纵向布局**

在 mobile landscape media query (`@media (orientation: landscape) and (max-height: 520px)`) 中添加：

```css
  .board-info {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    max-width: 168px;
    font-size: 11px;
  }

  .board-matchup {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .board-versus {
    display: none;
  }
```

在 medium landscape media query (`@media (min-width: 1101px) and (max-width: 1220px)`) 中添加同样的规则。

在 desktop base 样式中（无 media query），board-info 保持当前横向布局不变，因为 desktop 棋盘左侧有足够空间显示横向信息。但需要确认：desktop (>1220px) 的 board-info 是否也需要改为三行？

**决策：** desktop 也改为三行，与横屏统一。在 base 层 `.board-info` 中直接改为：

```css
.board-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 168px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.1;
  white-space: nowrap;
  writing-mode: horizontal-tb;
}

.board-matchup {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
  color: var(--ink);
  font-weight: 700;
}

.board-versus {
  display: none;
}
```

竖屏 media query 中 `.board-info` 已有 `flex-direction: row; flex-wrap: wrap; justify-content: center;` 覆盖，所以竖屏不受影响。但需要在竖屏 media query 中显式保留 `.board-versus { display: inline; }` 以确保竖屏仍然显示 "vs"。

- [ ] **Step 2: 在竖屏 media query 中保留 vs 显示**

在 narrow portrait media query 中添加：

```css
  .board-versus {
    display: inline;
  }
```

在 wide portrait media query 中同样添加。

- [ ] **Step 3: Build 验证**

Run: `cd web && npm run build`
Expected: 无报错

- [ ] **Step 4: Commit**

```bash
git add web/src/styles.css
git commit -m "style: change landscape board-info to three-row layout (black/white/result)"
```

---

### Task 8: 更新测试断言

**Files:**
- Modify: `web/src/styles.test.ts`

- [ ] **Step 1: 更新 sidebar 相关断言**

将以下断言从 36px/8px 更新为 32px/7px：

```typescript
// line 54: analysis-action-button
expect(styles).toContain('.analysis-action-button {\n  width: 32px;\n  min-width: 32px;\n  max-width: none;\n  height: 32px;')
```

- [ ] **Step 2: 更新 navigation button 相关断言**

检查 line 78、185 等处的 button 尺寸断言，更新为变量引用或新值。

- [ ] **Step 3: 更新 analysis-rail 相关断言**

更新 `.analysis-rail` background 从 `var(--paper)` 为 `var(--board-zone)`。

更新 `.rail-section` 相关断言（border、box-shadow 等）。

- [ ] **Step 4: 更新 landscape 断言中的冗余样式**

更新 line 143 `.candidate-row, .bad-move { min-height: 28px` — 这个值现在在 base 层，landscape 中不再重复声明，断言需要调整。

- [ ] **Step 5: 添加 board-info 三行布局断言**

添加新断言验证：
- base 层 `.board-versus { display: none }`（横屏不显示 vs）
- 竖屏 media query 中 `.board-versus { display: inline }`（竖屏保留 vs）

- [ ] **Step 6: 运行测试验证**

Run: `cd web && npm test -- --run`
Expected: 所有测试通过

- [ ] **Step 7: Commit**

```bash
git add web/src/styles.test.ts
git commit -m "test: update CSS test assertions for unified style variables"
```

---

### Task 9: 最终验证

- [ ] **Step 1: 运行完整测试套件**

Run: `cd web && npm test -- --run`
Expected: 全部通过

- [ ] **Step 2: 运行构建**

Run: `cd web && npm run build`
Expected: 无报错

- [ ] **Step 3: 运行后端测试**

Run: `go test ./...`
Expected: 全部通过（确保无意外影响）

- [ ] **Step 4: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: address test/build issues from style unification"
```

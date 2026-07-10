# Mobile Yuanluobo Visual Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the authenticated mobile interface around the Yuanluobo record-browser visual language while preserving every board hint and existing control meaning, leaving the token gate unchanged, and replacing browser-native prompts with touch-first sheets.

**Architecture:** Keep the React/Vite application and centralized CSS architecture intact. Add one reusable controlled `AppSheet` component for destructive confirmation and SGF naming, then apply a focused token/surface/touch layer in `styles.css` so the home cockpit, analysis rows, library, settings, and import flows share the Yuanluobo paper-grid and glazed-record treatment without changing board data or rendering logic.

**Tech Stack:** React 19, TypeScript 6, vanilla CSS with container queries, Vitest, Testing Library.

---

### Task 1: Lock the mobile visual and touch contracts with tests

**Files:**
- Modify: `web/src/styles.test.ts`
- Test: `web/src/styles.test.ts`

- [x] **Step 1: Write the failing visual-contract test**

Add a test that requires shared paper-grid/glazed-surface tokens, 36px mobile toolbar/navigation controls, a Yuanluobo-style candidate-row marker, a constrained URL field, a reusable app sheet, and coarse-pointer pressed feedback:

```ts
it('uses the Yuanluobo record language for touch-first authenticated surfaces', () => {
  expect(styles).toContain('--paper-grid-line: rgb(26 71 42 / 0.04);')
  expect(styles).toContain('--surface-glaze: linear-gradient(180deg, rgb(255 255 255 / 0.97), rgb(252 250 246 / 0.92));')
  expect(styles).toContain('.app-page-workspace::before {')
  expect(styles).toContain('.candidate-row::before {')
  expect(styles).toContain('.import-url-field {\n  width: min(560px, 100%);')
  expect(styles).toContain('.app-sheet-backdrop {')
  expect(styles).toContain('.app-sheet {')
  expect(styles).toContain('@media (hover: none), (pointer: coarse) {\n  button:not(:disabled):active,')
  expect(styles).toContain('.overlay-toggles .toggle {\n    width: 36px;\n    height: 36px;')
  expect(styles).toContain('.navigation-controls button {\n    width: 36px;\n    min-width: 36px;\n    max-width: 36px;\n    height: 34px;')
})
```

- [x] **Step 2: Run the style test and verify RED**

Run: `cd web; npm test -- --run src/styles.test.ts`

Expected: FAIL because the new tokens, shared sheet selectors, 36px mobile controls, and coarse-pointer pressed block do not yet exist.

### Task 2: Replace native SGF naming with the shared touch sheet

**Files:**
- Create: `web/src/components/AppSheet.tsx`
- Modify: `web/src/components/ImportDialog.tsx`
- Modify: `web/src/components/ImportDialog.test.tsx`
- Test: `web/src/components/ImportDialog.test.tsx`

- [x] **Step 1: Replace the prompt-based test with a failing sheet-flow test**

Update the File System Access test so it verifies the picker opens a named dialog, the default filename is editable, and import happens only after confirmation:

```tsx
await user.click(screen.getByRole('button', { name: /SGF 文件/ }))
const sheet = await screen.findByRole('dialog', { name: '命名棋局' })
const name = within(sheet).getByLabelText('棋局名称')
expect(name).toHaveValue('demo')
await user.clear(name)
await user.type(name, '练习棋局')
await user.click(within(sheet).getByRole('button', { name: '导入' }))
await waitFor(() => expect(onImport).toHaveBeenCalledWith('练习棋局', 'demo.sgf', '(;GM[1]FF[4]SZ[19])'))
expect(window.prompt).not.toHaveBeenCalled()
```

- [x] **Step 2: Run the import test and verify RED**

Run: `cd web; npm test -- --run src/components/ImportDialog.test.tsx`

Expected: FAIL because `ImportDialog` still calls `window.prompt` and does not render a `命名棋局` dialog.

- [x] **Step 3: Add the minimal reusable controlled sheet**

Create `AppSheet.tsx` with a backdrop, `role="dialog"`, `aria-modal="true"`, handle, title, body, actions, backdrop dismissal, and Escape dismissal:

```tsx
import { useEffect, type ReactNode } from 'react'

export function AppSheet({ title, children, actions, onDismiss }: {
  title: string
  children: ReactNode
  actions: ReactNode
  onDismiss(): void
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onDismiss()
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onDismiss])

  return (
    <div className="app-sheet-backdrop" onClick={onDismiss}>
      <section className="app-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <span className="app-sheet-handle" aria-hidden="true" />
        <header className="app-sheet-header"><h2>{title}</h2></header>
        <div className="app-sheet-body">{children}</div>
        <footer className="app-sheet-actions">{actions}</footer>
      </section>
    </div>
  )
}
```

- [x] **Step 4: Implement pending-file naming in `ImportDialog`**

Store the selected `File`, initialize the editable name from the filename, render `AppSheet`, and confirm with the real file contents:

```tsx
const [pendingFile, setPendingFile] = useState<File>()
const [displayName, setDisplayName] = useState('')

const prepareFileImport = (file: File) => {
  setPendingFile(file)
  setDisplayName(file.name.replace(/\.sgf$/i, ''))
}

const confirmFileImport = async () => {
  const name = displayName.trim()
  if (!pendingFile || !name) return
  await onImport(name, pendingFile.name, await pendingFile.text())
  setPendingFile(undefined)
}
```

Use `prepareFileImport` from both native file-input and File System Access paths, and remove `window.prompt` entirely.

- [x] **Step 5: Run the import test and verify GREEN**

Run: `cd web; npm test -- --run src/components/ImportDialog.test.tsx`

Expected: PASS with no native prompt usage.

### Task 3: Replace native deletion confirmation with the shared touch sheet

**Files:**
- Modify: `web/src/components/GameLibraryPage.tsx`
- Modify: `web/src/components/GameLibraryPage.test.tsx`
- Test: `web/src/components/GameLibraryPage.test.tsx`

- [x] **Step 1: Write the failing deletion-sheet test**

Remove the `confirm` stub and require explicit cancellation/confirmation:

```tsx
await user.click(screen.getByLabelText('删除 Lee VS Cho'))
const sheet = screen.getByRole('dialog', { name: '删除棋局' })
expect(sheet).toHaveTextContent('Lee VS Cho')
expect(onDelete).not.toHaveBeenCalled()
await user.click(within(sheet).getByRole('button', { name: '删除' }))
expect(onDelete).toHaveBeenCalledWith('game-1')
expect(window.confirm).not.toHaveBeenCalled()
```

- [x] **Step 2: Run the library test and verify RED**

Run: `cd web; npm test -- --run src/components/GameLibraryPage.test.tsx`

Expected: FAIL because the current delete button immediately invokes `window.confirm` and no `删除棋局` dialog exists.

- [x] **Step 3: Implement controlled deletion confirmation**

Add `pendingDelete` state, use the Chinese accessible label `删除 ${game.displayName}`, open `AppSheet`, and call `onDelete` only from its destructive action:

```tsx
const [pendingDelete, setPendingDelete] = useState<GameRecord>()

<button aria-label={`删除 ${game.displayName}`} onClick={() => setPendingDelete(game)}>
  <Trash2 size={15} aria-hidden="true" />
</button>

{pendingDelete && (
  <AppSheet title="删除棋局" onDismiss={() => setPendingDelete(undefined)} actions={...}>
    <p>删除“{pendingDelete.displayName}”？此操作无法撤销。</p>
  </AppSheet>
)}
```

- [x] **Step 4: Run the library test and verify GREEN**

Run: `cd web; npm test -- --run src/components/GameLibraryPage.test.tsx`

Expected: PASS with no native confirmation usage.

### Task 4: Apply the Yuanluobo visual language without changing board information

**Files:**
- Modify: `web/src/styles.css`
- Modify: `web/src/styles.test.ts`
- Test: `web/src/styles.test.ts`

- [x] **Step 1: Add shared paper, glaze, accent, and touch tokens**

Extend `:root` with reusable values and keep all existing board/candidate colors intact:

```css
--paper-grid-line: rgb(26 71 42 / 0.04);
--surface-glaze: linear-gradient(180deg, rgb(255 255 255 / 0.97), rgb(252 250 246 / 0.92));
--accent-warm: #9a6a2e;
--shadow-warm: 0 8px 20px rgb(42 30 14 / 0.08);
--touch-target: 36px;
```

- [x] **Step 2: Unify authenticated workspace backgrounds and page surfaces**

Add the Yuanluobo 28px fading grid to `.app-page-workspace::before`, lift `.app-page-body` above it, use the same warm surface on the cockpit regions, and do not touch `.token-gate` or `.token-form`.

- [x] **Step 3: Unify analysis rows while preserving every field**

Style `.candidate-row` and `.bad-move` with the glazed record surface, warm shadow, 8px radius, and a narrow left marker. Keep the component markup, candidate count, metrics, labels, ownership, weak-stone markers, and board SVG unchanged.

- [x] **Step 4: Unify library, settings, and import subflows**

Reuse the glaze, warm accent, border, shadow, and grid vocabulary for game rows, worker rows, import source cards, the URL field, and empty/error surfaces. Give `.import-url-field` `width: min(560px, 100%)` so the desktop field no longer stretches across the page.

- [x] **Step 5: Add app-sheet visuals matching the Yuanluobo picker**

Implement `.app-sheet-backdrop`, `.app-sheet`, handle/header/body/actions, neutral and danger actions, and the mobile bottom-attached override using the same dimensions and lighting as `.yuanluobo-picker-sheet`.

- [x] **Step 6: Add coarse-pointer pressed states and enlarge mobile controls**

At the end of component styles, add a late coarse-pointer block that neutralizes translated hover effects and provides `:active` feedback. In the `max-width: 699px` container rules, set toolbar controls to 36px and navigation controls to 36×34px while preserving their labels and behavior.

- [x] **Step 7: Run the style test and verify GREEN**

Run: `cd web; npm test -- --run src/styles.test.ts`

Expected: PASS with the new visual/touch contract and all prior layout contracts intact.

### Task 5: Regression, visual verification, and repository completion gate

**Files:**
- Verify: `web/src/styles.css`
- Verify: `web/src/components/AppSheet.tsx`
- Verify: `web/src/components/ImportDialog.tsx`
- Verify: `web/src/components/GameLibraryPage.tsx`
- Verify: affected tests

- [x] **Step 1: Run focused component and style tests**

Run:

```powershell
cd web
npm test -- --run src/styles.test.ts src/components/ImportDialog.test.tsx src/components/GameLibraryPage.test.tsx
```

Expected: all focused tests pass without warnings.

- [x] **Step 2: Run the complete frontend suite and build**

Run:

```powershell
cd web
npm test -- --run
npm run build
```

Expected: all frontend tests pass and Vite produces a successful production build.

- [x] **Step 3: Capture and inspect real render states**

Using the running local JCGO service, capture 390×844 screenshots for home, local library, import chooser, URL import, settings, and both sheets; capture 1440×900 for home and URL import. Confirm:

- all board hints remain present;
- no horizontal overflow or board shrink regression;
- touch controls fit on one row;
- authenticated pages share paper-grid, glazed surfaces, warm accent, and consistent pressed states;
- token gate remains visually unchanged;
- URL input stays within 560px on desktop.

- [x] **Step 4: Run the exact repository completion tail**

Run from `D:\Code\JCGO`:

```powershell
git add -A
git commit -m "feat: unify mobile interface styling"
git push origin codex/mobile-yuanluobo-ui
```

Expected: commit and push both succeed; if either fails, resolve it before reporting completion.

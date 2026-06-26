# JCGO Working Rules

## Repository Structure

```text
JCGO/
  cmd/       - Go entrypoint for the JCGO server
  internal/  - Go backend packages: app state, SGF/game logic, KataGo, store, server
  web/       - React / Vite PWA frontend
  testdata/  - SGF fixtures
  docs/      - scope, plans, research notes
  e2e/       - Playwright tests
```

## Global Conventions

- Code comments and identifiers use English.
- Prefer extending existing `*_test.go` / `*.test.ts(x)` files; create new test files only when existing files are clearly unsuitable.
- Do not scan generated output or dependency directories. Use exclusions such as `rg --glob '!web/dist/**' --glob '!web/node_modules/**'`.
- Avoid meaningless `strings.TrimSpace`: use it only at explicit input boundaries, not repeatedly in internal flows.
- Requirements clarification, option selection, and design discussion should happen in text conversation; do not propose browser or visual companion tools for those choices.
- Keep backend analysis state authoritative on the server. The frontend renders server payloads and should not reimplement Go rules or KataGo analysis semantics.
- Analysis persistence files live next to SGF files and follow the SGF basename, for example `<gameId>.analysis.json`.

## Development Commands

Backend tests:

```powershell
go test ./...
```

Frontend tests and build:

```powershell
cd web
npm test -- --run
npm run build
```

Run the server:

```powershell
$env:JCGO_ACCESS_TOKEN='dev-token'
$env:JCGO_DATA_DIR='.data'
$env:JCGO_KATAGO_PATH='D:\Code\katrain\.venv\Lib\site-packages\katrain\KataGo\katago.exe'
$env:JCGO_MODEL_PATH='D:\Code\katrain\.venv\Lib\site-packages\katrain\models\kata1-b18c384nbt-s9996604416-d4316597426.bin.gz'
$env:JCGO_ANALYSIS_CONFIG_PATH='D:\Code\katrain\.venv\Lib\site-packages\katrain\KataGo\analysis_config.cfg'
go run ./cmd/jcgo
```

## Completion Gate (Highest Priority)

Before the final user-facing completion message in any implementation task, execute this exact tail sequence:

1. `git add -A`
2. `git commit -m "<message>"`
3. `git push origin <branch>`

If any step fails, report the failure and keep working until resolved. Do not claim completion early.

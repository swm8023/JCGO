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

Run Windows deploy:

```powershell
.\deploy.bat
~\.jcgo\start.bat
```

Runtime config lives at `~\.jcgo\config.json`. The server uses `server.token`; the worker uses `worker.url`, `worker.token`, `worker.model`, and `worker.maxVisits`.

## Completion Gate (Highest Priority)

Before the final user-facing completion message in any implementation task, execute this exact tail sequence:

1. `git add -A`
2. `git commit -m "<message>"`
3. `git push origin <branch>`

If any step fails, report the failure and keep working until resolved. Do not claim completion early.

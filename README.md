# JCGO

JCGO is a remote single-token Go + React PWA for SGF-based KataGo analysis review.

## Development

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

Open `http://127.0.0.1:4380` and enter `dev-token`.

If the KataGo paths are not configured, the server still starts and SGF import/review remains available; analysis actions report that analysis is unavailable.

## Remote Worker

Build a Windows worker package:

```powershell
.\scripts\build-worker.ps1
```

The script writes `dist\worker\jcgo-worker.exe`, `dist\worker\jcgo-worker.example.json`, and `dist\worker\jcgo-worker.json` when the editable config does not already exist.

Edit `dist\worker\jcgo-worker.json` on the worker machine, then double-click `jcgo-worker.exe`. The worker writes `jcgo-worker.log` next to the executable and connects to the JCGO `/worker` WebSocket endpoint with the existing `JCGO_ACCESS_TOKEN`.

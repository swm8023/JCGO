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

## Windows Deploy

Put optional runtime assets under `release-assets` before deploying:

```text
release-assets/
  katago.exe
  analysis_config.cfg
  model/
    your-model.bin.gz
```

Deploy from the repository root:

```powershell
.\deploy.bat
```

The deploy command installs to `~\.jcgo`, creates `config.json` only when it does not already exist, publishes Web assets, and writes `start.bat` / `stop.bat`.

Start JCGO:

```powershell
~\.jcgo\start.bat
```

Stop JCGO:

```powershell
~\.jcgo\stop.bat
```

Open `http://127.0.0.1:4380` and enter `server.token` from `~\.jcgo\config.json`.

JCGO uses Worker-only analysis. The server does not start KataGo directly. When `worker.enabled` is true, `jcgo-worker.exe` reads the same `config.json`, connects to `worker.url`, and starts KataGo from:

```text
~/.jcgo/bin/katago.exe
~/.jcgo/model/<worker.model>
~/.jcgo/config/analysis_config.cfg
```

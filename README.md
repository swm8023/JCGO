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

Deploy is driven by `deploy-manifest.json` in the repository root. Downloads and generated publish assets are staged under `.stage`:

```text
.stage/
  .download/
    katago/
    model/
  bin/
    jcgo.exe
    jcgo-worker.exe
    katago.exe
    *.dll
    KataGoData/
  config/
    analysis_config.cfg
    katago_backend.json
  model/
    kata1-*.bin.gz
  web/
    index.html
    assets/
```

Deploy from the repository root:

```powershell
.\deploy.bat
```

The deploy command downloads missing KataGo assets into `.stage\.download`, rebuilds `.stage\bin`, `.stage\model`, `.stage\config`, and `.stage\web`, then installs to `~\.jcgo` only after staging succeeds. It creates `config.json` only when it does not already exist, publishes Web assets, and writes `start.bat` / `stop.bat`. When launched by double-clicking, the deploy window stays open at the end and writes output to `~\.jcgo\log\deploy.bat.log`.

Start JCGO:

```powershell
~\.jcgo\start.bat
```

Stop JCGO:

```powershell
~\.jcgo\stop.bat
```

Both scripts keep the window open when double-clicked and write logs under `~\.jcgo\log`. `stop.bat` stops the installed `jcgo.exe`, `jcgo-worker.exe`, `katago.exe`, and their child processes. If another development or external KataGo process is still running outside `~\.jcgo`, it reports it as unmanaged instead of killing it.

Open `http://127.0.0.1:4380` and enter `server.token` from `~\.jcgo\config.json`.

JCGO uses Worker-only analysis. The server does not start KataGo directly. When `worker.enabled` is true, `jcgo-worker.exe` reads the same `config.json`, connects to `worker.url`, and starts KataGo from:

```text
~/.jcgo/bin/katago.exe
~/.jcgo/model/<worker.model>
~/.jcgo/config/analysis_config.cfg
```

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

## WheelMaker Management and Forwarding

JCGO supports separate **JCGO Server** (`jcgo-server`) and **JCGO Worker**
(`jcgo-worker`) entries in Hub Apps → Monitor. Each entry has its own lifecycle,
health and logs; Worker owns KataGo. Stopping Worker leaves the Server available
for browsing games and saved analysis. Worker reconnects when Server returns.

After deploying this version, stop any independently launched JCGO instances and
merge the two launch definitions and the JCGO publication switch:

```powershell
.\scripts\connect-wheelmaker.ps1
```

The script preserves existing tokens, projects and other Hub apps. Optional
`-JcgoDir` and `-HubStateDir` select non-default installation/state directories.
Then choose **Hub Apps → Monitor → Reload**. Hub launches the two installed
executables directly in the foreground; do not use `start.bat` for Hub management.

Server independently registers the `jcgo` forwarding ID. Forward shows its actual
public address once ready, normally `https://<applications-origin>/jcgo/`. The
local root address continues to work. Both use JCGO's existing access token;
Worker's existing local `/worker` address remains valid. PWA resources, SGF sharing
and Android Remote Shell support the prefixed address. Forwarding requires a Hub,
Registry and Gateway with registered-app support and a configured apps origin.

JCGO's optional publication configuration is separate from Hub process management:

```json
{
  "hub": {
    "enabled": true,
    "stateDir": "C:/Users/alice/.wheelmaker"
  }
}
```

This is a fragment to merge into JCGO's config. Omit `stateDir` to use the current
account's `~/.wheelmaker`; omit `hub` or disable it for local-only operation. Hub
and JCGO must use the same OS account. No Hub token is needed by JCGO.

For managed upgrades, use Monitor to **Stop Worker, then Stop Server**, wait for
both to stop, run `deploy.bat`, then Start Server and Worker. Deployment and stop
scripts reject live managed instances before killing processes or replacing
installation files. Keep Hub running during this maintenance: restarting Hub
starts all configured apps again. A failed deployment leaves the apps stopped;
fix it before starting them. Per-directory role locks prevent duplicate roots.

See [the integration wiki](docs/wiki/wheelmaker-integration.md) for protocol,
cache-isolation and validation details.

JCGO uses Worker-only analysis. The server does not start KataGo directly. When `worker.enabled` is true, `jcgo-worker.exe` reads the same `config.json`, connects to `worker.url`, and starts KataGo from:

```text
~/.jcgo/bin/katago.exe
~/.jcgo/model/<worker.model>
~/.jcgo/config/analysis_config.cfg
```

## Android APK

JCGO Android uses a Kotlin WebView Remote Shell. The APK embeds only a Bootstrap page, asks for an HTTPS JCGO server address, and then loads the remote Web UI. Deploying a new `web/dist` on the HTTPS server updates the UI without rebuilding the APK.

Build a directly installable Debug APK from the repository root:

```powershell
.\scripts\build-android.ps1
```

The APK is written to `dist\jcgo-android-debug.apk`. See [`mobile/android/README.md`](mobile/android/README.md) for ADB installation and server requirements. APK self-update is intentionally not included.

# JCGO Android Remote Shell

JCGO Android is a Kotlin WebView shell. The APK embeds only the Bootstrap page; after the first launch it loads the JCGO Web UI from a configured HTTPS server.

## Build a directly installable APK

From the repository root:

```powershell
.\scripts\build-android.ps1
```

The output is:

```text
dist/jcgo-android-debug.apk
```

With an Android device connected through ADB:

```powershell
.\scripts\build-android.ps1 -Install
```

The build requires Java 17, Android SDK, and Gradle. The Android project uses `compileSdk 36`, `minSdk 23`, and package name `com.jcgo.android`.

## Server requirements

The Bootstrap page accepts HTTPS addresses only. Put JCGO behind Nginx or another HTTPS reverse proxy that serves the current `web/dist` and forwards `/ws` as WebSocket to the Go server on `127.0.0.1:4380`.

After deploying a new `web/dist`, restart the APK or reload the remote page to receive the new Web UI. The APK does not download or install new APK versions in this release.

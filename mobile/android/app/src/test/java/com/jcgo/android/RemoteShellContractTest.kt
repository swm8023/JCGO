package com.jcgo.android

import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path

class RemoteShellContractTest {
    @Test
    fun manifestRequiresSecureRemoteWebView() {
        val manifest = source("src/main/AndroidManifest.xml")

        assertTrue(manifest.contains("android.permission.INTERNET"))
        assertTrue(manifest.contains("android:usesCleartextTraffic=\"false\""))
        assertTrue(manifest.contains(".MainActivity"))
    }

    @Test
    fun launcherUsesTheOfficialWebJcgoIcon() {
        val manifest = source("src/main/AndroidManifest.xml")
        val androidIcon = Path.of("src/main/res/drawable-nodpi/jcgo_launcher.png")
        val webIcon = Path.of("../../../web/public/icons/jcgo-512.png")

        assertTrue(manifest.contains("android:icon=\"@drawable/jcgo_launcher\""))
        assertTrue(Files.isRegularFile(androidIcon))
        assertTrue(Files.isRegularFile(webIcon))
        assertTrue(Files.readAllBytes(androidIcon).contentEquals(Files.readAllBytes(webIcon)))
    }

    @Test
    fun activityLoadsLocalBootstrapAndConfiguredRemotePage() {
        val activity = source("src/main/java/com/jcgo/android/MainActivity.kt")

        assertTrue(activity.contains("loadUrl(ANDROID_BOOTSTRAP_URL)"))
        assertTrue(activity.contains("loadConfiguredRemote"))
        assertTrue(activity.contains("BaseUrlProbe"))
        assertTrue(activity.contains("WebViewCompat.addWebMessageListener"))
    }

    @Test
    fun activityServesEmbeddedBootstrapThroughWebViewAssetLoader() {
        val activity = source("src/main/java/com/jcgo/android/MainActivity.kt")
        val client = source("src/main/java/com/jcgo/android/StableOriginWebViewClient.kt")

        assertTrue(activity.contains("StableOriginWebViewClient"))
        assertTrue(client.contains("WebViewAssetLoader.Builder"))
        assertTrue(client.contains("AssetsPathHandler(context)"))
        assertTrue(client.contains("url.toString() == ANDROID_BOOTSTRAP_URL"))
        assertTrue(client.contains("assetLoader.shouldInterceptRequest(url)"))
    }

    @Test
    fun activityDisablesFileAccessAndUsesAndroidFileChooser() {
        val activity = source("src/main/java/com/jcgo/android/MainActivity.kt")

        assertTrue(activity.contains("allowFileAccess = false"))
        assertTrue(activity.contains("allowContentAccess = false"))
        assertTrue(activity.contains("MIXED_CONTENT_NEVER_ALLOW"))
        assertTrue(activity.contains("onShowFileChooser"))
        assertTrue(activity.contains("ACTION_OPEN_DOCUMENT"))
    }

    @Test
    fun serverSwitchClearsOnlyJcgoState() {
        val activity = source("src/main/java/com/jcgo/android/MainActivity.kt")

        assertTrue(!activity.contains("WebStorage.getInstance().deleteAllData()"))
        assertTrue(activity.contains("key.startsWith('jcgo.')"))
        assertTrue(!activity.contains("CookieManager.getInstance().removeAllCookies"))
        assertTrue(activity.contains("awaitRemoteCleanup"))
    }

    @Test
    fun activityRecreatesWebViewAfterRendererTermination() {
        val activity = source("src/main/java/com/jcgo/android/MainActivity.kt")

        assertTrue(activity.contains("onRenderProcessGone"))
        assertTrue(activity.contains("removeView(view)"))
        assertTrue(activity.contains("view.destroy()"))
        assertTrue(activity.contains("createWebView()"))
        assertTrue(activity.contains("return true"))
    }

    @Test
    fun activityDefersRendererRecoveryUntilResume() {
        val activity = source("src/main/java/com/jcgo/android/MainActivity.kt")

        assertTrue(activity.contains("pendingWebViewRecovery"))
        assertTrue(activity.contains("override fun onResume()"))
        assertTrue(activity.contains("recoverWebView()"))
    }

    @Test
    fun activityPausesAndResumesWebViewWithItsLifecycle() {
        val activity = source("src/main/java/com/jcgo/android/MainActivity.kt")

        assertTrue(activity.contains("target?.onPause()"))
        assertTrue(activity.contains("target?.onResume()"))
    }

    @Test
    fun bootstrapPageUsesOnlyTheNativeBootstrapBridge() {
        val bootstrap = source("src/main/assets/bootstrap/index.html")

        assertTrue(bootstrap.contains("window.jcgoBootstrap"))
        assertTrue(bootstrap.contains("bootstrap.saveBaseUrl"))
        assertTrue(bootstrap.contains("bootstrap.retry"))
        assertTrue(bootstrap.contains("bootstrap.reset"))
    }

    private fun source(relativePath: String): String {
        val path = Path.of(relativePath)
        return if (Files.isRegularFile(path)) String(Files.readAllBytes(path)) else ""
    }
}

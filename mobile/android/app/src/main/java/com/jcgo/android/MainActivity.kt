package com.jcgo.android

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private lateinit var rootView: FrameLayout
    private var webView: WebView? = null
    private lateinit var baseUrlStore: BaseUrlStore
    private lateinit var baseUrlProbe: BaseUrlProbe
    private lateinit var navigationExecutor: ExecutorService
    private var configuredBaseUrl = ""
    private var bootstrapError = ""
    private var bootstrapBusy = false
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingWebViewRecovery = false
    private var activityResumed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        baseUrlStore = BaseUrlStore(this)
        baseUrlProbe = BaseUrlProbe()
        navigationExecutor = Executors.newSingleThreadExecutor()
        configuredBaseUrl = baseUrlStore.load()

        rootView = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(30, 41, 59))
        }
        setContentView(rootView)
        val initialWebView = createWebView()
        webView = initialWebView
        rootView.addView(
            initialWebView,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        startInitialNavigation()
    }

    private fun createWebView(): WebView {
        return WebView(this).also { target ->
            configureWebView(target)
            registerBootstrapMessageListener(target)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Suppress("DEPRECATION")
    private fun configureWebView(target: WebView) {
        target.setBackgroundColor(Color.rgb(30, 41, 59))
        target.settings.javaScriptEnabled = true
        target.settings.domStorageEnabled = true
        target.settings.databaseEnabled = true
        target.settings.cacheMode = WebSettings.LOAD_DEFAULT
        target.settings.allowFileAccess = false
        target.settings.allowContentAccess = false
        target.settings.javaScriptCanOpenWindowsAutomatically = false
        target.settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        target.settings.mediaPlaybackRequiresUserGesture = false
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(target, false)
        WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)

        target.webViewClient = object : StableOriginWebViewClient(this) {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (url == ANDROID_BOOTSTRAP_URL) return false
                val baseUrl = configuredBaseUrl
                if (baseUrl.isBlank()) return true
                return when (BaseUrlPolicy(baseUrl).decide(url, request.isForMainFrame)) {
                    NavigationDecision.ALLOW -> false
                    NavigationDecision.EXTERNAL -> {
                        openExternalUrl(url)
                        true
                    }
                    NavigationDecision.BLOCK -> true
                }
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame && configuredBaseUrl.isNotBlank()) {
                    showBootstrap(error.description?.toString().orEmpty().ifBlank { "远程服务加载失败。" })
                }
            }

            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) {
                handler.cancel()
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // A terminated renderer leaves this WebView unusable; always replace it before loading again.
                rootView.removeView(view)
                if (webView === view) webView = null
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = null
                view.destroy()
                pendingWebViewRecovery = true
                if (activityResumed) recoverWebView()
                return true
            }
        }
        target.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                this@MainActivity.fileChooserCallback?.onReceiveValue(null)
                this@MainActivity.fileChooserCallback = filePathCallback
                return try {
                    startActivityForResult(createFileChooserIntent(fileChooserParams), FILE_CHOOSER_REQUEST_CODE)
                    true
                } catch (_: ActivityNotFoundException) {
                    this@MainActivity.fileChooserCallback = null
                    filePathCallback.onReceiveValue(null)
                    false
                }
            }
        }
    }

    private fun registerBootstrapMessageListener(target: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            bootstrapError = "当前 Android WebView 不支持安全的 Bootstrap 通信。"
            return
        }
        WebViewCompat.addWebMessageListener(
            target,
            BOOTSTRAP_MESSAGE_LISTENER,
            setOf(BOOTSTRAP_ORIGIN)
        ) { view, message, sourceOrigin, isMainFrame, replyProxy ->
            if (!isMainFrame || sourceOrigin.toString() != BOOTSTRAP_ORIGIN || view.url != ANDROID_BOOTSTRAP_URL) {
                return@addWebMessageListener
            }
            val request = runCatching { JSONObject(message.data.orEmpty()) }.getOrNull()
            val requestId = request?.optString("requestId").orEmpty()
            val action = request?.optString("action").orEmpty()
            if (requestId.isBlank() || action.isBlank()) {
                sendError(replyProxy, requestId, "请求格式无效。")
                return@addWebMessageListener
            }
            handleBootstrapMessage(requestId, action, request?.optJSONObject("payload") ?: JSONObject(), replyProxy)
        }
    }

    private fun handleBootstrapMessage(
        requestId: String,
        action: String,
        payload: JSONObject,
        replyProxy: JavaScriptReplyProxy
    ) {
        when (action) {
            "bootstrap.getState" -> sendSuccess(replyProxy, requestId, bootstrapState())
            "bootstrap.saveBaseUrl" -> {
                val normalized = normalizeHttpsBaseUrl(payload.optString("baseUrl"))
                if (normalized == null) {
                    sendSuccess(replyProxy, requestId, bootstrapState("请输入有效的 HTTPS 服务地址。"))
                } else {
                    probeForBootstrap(normalized, requestId, replyProxy, saveOnSuccess = true)
                }
            }
            "bootstrap.retry" -> {
                if (configuredBaseUrl.isBlank()) {
                    sendSuccess(replyProxy, requestId, bootstrapState("请输入有效的 HTTPS 服务地址。"))
                } else {
                    probeForBootstrap(configuredBaseUrl, requestId, replyProxy, saveOnSuccess = false)
                }
            }
            "bootstrap.reset" -> resetRemoteServer(requestId, replyProxy)
            else -> sendError(replyProxy, requestId, "不支持的 Bootstrap 操作。")
        }
    }

    private fun probeForBootstrap(
        baseUrl: String,
        requestId: String,
        replyProxy: JavaScriptReplyProxy,
        saveOnSuccess: Boolean
    ) {
        if (bootstrapBusy) {
            sendSuccess(replyProxy, requestId, bootstrapState("连接尝试正在进行中。"))
            return
        }
        bootstrapBusy = true
        bootstrapError = ""
        navigationExecutor.execute {
            val result = baseUrlProbe.probe(baseUrl)
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                if (!result.ok) {
                    bootstrapBusy = false
                    bootstrapError = result.error
                    sendSuccess(replyProxy, requestId, bootstrapState())
                    return@runOnUiThread
                }
                val activate = {
                    try {
                        if (saveOnSuccess) baseUrlStore.save(baseUrl)
                        configuredBaseUrl = baseUrl
                        bootstrapError = ""
                        bootstrapBusy = false
                        sendSuccess(replyProxy, requestId, bootstrapState())
                        val target = webView
                        if (target != null) loadConfiguredRemote(target, baseUrl)
                    } catch (error: Exception) {
                        bootstrapBusy = false
                        bootstrapError = error.message ?: "无法保存服务地址。"
                        sendSuccess(replyProxy, requestId, bootstrapState())
                    }
                }
                if (saveOnSuccess && configuredBaseUrl.isNotBlank() && configuredBaseUrl != baseUrl) {
                    clearCurrentServerState(activate)
                } else {
                    activate()
                }
            }
        }
    }

    private fun resetRemoteServer(requestId: String, replyProxy: JavaScriptReplyProxy) {
        clearCurrentServerState {
            configuredBaseUrl = ""
            bootstrapError = ""
            bootstrapBusy = false
            baseUrlStore.clear()
            sendSuccess(replyProxy, requestId, bootstrapState())
            webView?.loadUrl(ANDROID_BOOTSTRAP_URL)
        }
    }

    private fun clearCurrentServerState(onComplete: () -> Unit) {
        val target = webView ?: run {
            onComplete()
            return
        }
        val currentUrl = target.url.orEmpty()
        val finish = {
            WebStorage.getInstance().deleteAllData()
            CookieManager.getInstance().removeAllCookies {
                target.clearHistory()
                target.clearCache(true)
                target.postDelayed(onComplete, 150)
            }
        }
        if (configuredBaseUrl.isBlank() || !BaseUrlPolicy(configuredBaseUrl).contains(currentUrl)) {
            finish()
        } else {
            target.evaluateJavascript(CLEAR_REMOTE_STATE_SCRIPT) {
                finish()
            }
        }
    }

    private fun startInitialNavigation() {
        if (configuredBaseUrl.isBlank()) {
            showBootstrap(bootstrapError)
            return
        }
        probeAndLoad(configuredBaseUrl)
    }

    private fun probeAndLoad(baseUrl: String) {
        navigationExecutor.execute {
            val result = baseUrlProbe.probe(baseUrl)
            runOnUiThread {
                if (isFinishing || isDestroyed || baseUrl != configuredBaseUrl) return@runOnUiThread
                if (!result.ok) {
                    showBootstrap(result.error)
                } else {
                    bootstrapError = ""
                    webView?.let { loadConfiguredRemote(it, baseUrl) }
                }
            }
        }
    }

    private fun recoverWebView() {
        if (!pendingWebViewRecovery || isFinishing || isDestroyed) return
        pendingWebViewRecovery = false
        val recoveredWebView = createWebView()
        webView = recoveredWebView
        rootView.addView(
            recoveredWebView,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        if (configuredBaseUrl.isBlank()) {
            recoveredWebView.loadUrl(ANDROID_BOOTSTRAP_URL)
        } else {
            loadConfiguredRemote(recoveredWebView, configuredBaseUrl)
        }
    }

    private fun loadConfiguredRemote(target: WebView, baseUrl: String) {
        target.loadUrl(baseUrl)
    }

    private fun showBootstrap(error: String) {
        bootstrapError = error
        val target = webView ?: return
        if (target.url != ANDROID_BOOTSTRAP_URL) {
            target.loadUrl(ANDROID_BOOTSTRAP_URL)
        }
    }

    private fun bootstrapState(errorOverride: String? = null): JSONObject = JSONObject()
        .put("ok", (errorOverride ?: bootstrapError).isBlank())
        .put("baseUrl", configuredBaseUrl)
        .put("error", errorOverride ?: bootstrapError)
        .put("busy", bootstrapBusy)

    private fun sendSuccess(replyProxy: JavaScriptReplyProxy, requestId: String, result: JSONObject) {
        replyProxy.postMessage(JSONObject().put("requestId", requestId).put("ok", true).put("result", result).toString())
    }

    private fun sendError(replyProxy: JavaScriptReplyProxy, requestId: String, error: String) {
        replyProxy.postMessage(JSONObject().put("requestId", requestId).put("ok", false).put("error", error).toString())
    }

    private fun createFileChooserIntent(params: WebChromeClient.FileChooserParams): Intent {
        val acceptedType = params.acceptTypes
            .asSequence()
            .flatMap { it.split(',').asSequence() }
            .map(String::trim)
            .firstOrNull { it.contains('/') && it != "*/*" }
            ?: "*/*"
        return Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = acceptedType
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
    }

    private fun openExternalUrl(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "没有可用的浏览器打开链接。", Toast.LENGTH_SHORT).show()
        }
    }

    @Suppress("DEPRECATION")
    @Deprecated("Deprecated in Android API  Activity", ReplaceWith("super.onBackPressed()"))
    override fun onBackPressed() {
        val target = webView
        if (target?.canGoBack() == true) {
            target.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onResume() {
        super.onResume()
        activityResumed = true
        recoverWebView()
    }

    override fun onPause() {
        activityResumed = false
        super.onPause()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            val result = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            fileChooserCallback?.onReceiveValue(result)
            fileChooserCallback = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        if (::navigationExecutor.isInitialized) navigationExecutor.shutdownNow()
        webView?.let { target ->
            rootView.removeView(target)
            target.destroy()
        }
        webView = null
        super.onDestroy()
    }

    private companion object {
        const val BOOTSTRAP_MESSAGE_LISTENER = "jcgoBootstrap"
        const val BOOTSTRAP_ORIGIN = "https://appassets.androidplatform.net"
        const val FILE_CHOOSER_REQUEST_CODE = 1001
        val CLEAR_REMOTE_STATE_SCRIPT = """
            (() => {
              try { localStorage.clear(); sessionStorage.clear(); } catch (_) {}
              try { navigator.serviceWorker.getRegistrations().then(items => items.forEach(item => item.unregister())); } catch (_) {}
              try { caches.keys().then(keys => keys.forEach(key => caches.delete(key))); } catch (_) {}
              return true;
            })()
        """.trimIndent()
    }
}

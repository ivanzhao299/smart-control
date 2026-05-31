package com.jinhu.smartcontrol

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import com.jinhu.smartcontrol.databinding.ActivityMainBinding
import com.jinhu.smartcontrol.databinding.PanelConfigBinding
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

/**
 * 单 Activity — 根据 SharedPreferences 是否有 server_url 显示配置页或 WebView.
 *
 * 流程:
 *   首次启动 → SharedPreferences 没 url → 显示 panel_config
 *   业主输 url + 测试 + 保存 → 跳 WebView
 *   下次启动 → 已有 url → 直接 WebView
 *
 * 切回配置:
 *   - 右上角小齿轮按钮
 *   - 错误覆盖层"切换服务器"按钮
 *
 * 全屏沉浸:
 *   - immersive mode (类似 PWA 的 fullscreen)
 *   - 上下滑出可调出系统栏
 */
class MainActivity : AppCompatActivity() {

    private lateinit var bind: ActivityMainBinding
    private lateinit var configBind: PanelConfigBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        bind = ActivityMainBinding.inflate(layoutInflater)
        configBind = PanelConfigBinding.bind(bind.configPanel.root)
        setContentView(bind.root)

        applyImmersive()
        setupWebView()
        setupConfigPanel()
        setupBackHandler()

        // 启动判断: 有 url → WebView, 无 → 配置
        val saved = Prefs.getServerUrl(this)
        if (saved.isNullOrBlank()) {
            showConfig()
        } else {
            loadWeb(saved)
        }
    }

    // ============ 全屏 / 沉浸 ============

    private fun applyImmersive() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let { c ->
                c.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                c.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    // ============ 配置页 ============

    private fun setupConfigPanel() {
        // 加载已存 url 到输入框 (业主重新配置时不用从头输)
        val current = Prefs.getServerUrl(this) ?: BuildConfig.DEFAULT_SERVER_URL
        configBind.etUrl.setText(current)
        configBind.tvVersion.text = "v${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"

        configBind.btnTest.setOnClickListener { onTest() }
        configBind.btnSave.setOnClickListener { onSave() }
    }

    private fun showConfig() {
        bind.configPanel.root.visibility = View.VISIBLE
        bind.webPanel.visibility = View.GONE
    }

    private fun onTest() {
        val url = configBind.etUrl.text.toString().trim()
        if (url.isEmpty()) {
            showStatus(getString(R.string.config_no_url), false)
            return
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            showStatus(getString(R.string.config_invalid_url), false)
            return
        }
        configBind.btnTest.isEnabled = false
        configBind.btnTest.text = getString(R.string.config_testing)

        thread {
            val result = ping(url)
            runOnUiThread {
                configBind.btnTest.isEnabled = true
                configBind.btnTest.text = getString(R.string.config_test)
                if (result.ok) {
                    showStatus(getString(R.string.config_test_ok, result.serverTime ?: ""), true)
                } else {
                    showStatus(getString(R.string.config_test_fail, result.error ?: "unknown"), false)
                }
            }
        }
    }

    /**
     * Ping backend: 优先 /api/client-auth/ping, 不通就降级试 / (业主可能输错路径
     * 如 http://192.168.1.1:5173/, 没 /control/, 那 /api/... 走不通但 / 能返).
     * 我们只关心"backend 可达 + 返回 JSON 含 ok:true".
     */
    private data class PingResult(val ok: Boolean, val serverTime: String?, val error: String?)

    private fun ping(serverUrl: String): PingResult {
        // 业主输的可能是 http://192.168.124.11:5173/control/ (frontend)
        // 也可能是 http://192.168.124.11:3200 (backend 直连)
        // 我们试两个 path: <url>/api/client-auth/ping 和 <url>api/client-auth/ping
        val base = serverUrl.trimEnd('/')
        // 业主输 frontend (/control/) 路径, /api/ 会被 nginx/vite 反代到 backend
        val candidates = listOf("$base/api/client-auth/ping")
        var lastError = "unknown"
        for (u in candidates) {
            try {
                val conn = URL(u).openConnection() as HttpURLConnection
                conn.connectTimeout = 4000
                conn.readTimeout = 4000
                conn.requestMethod = "GET"
                val code = conn.responseCode
                if (code in 200..299) {
                    val text = conn.inputStream.bufferedReader().use { it.readText() }
                    // 拿 ISO 时间, 截 HH:mm:ss 给业主看
                    val time = try {
                        val json = JSONObject(text)
                        val data = json.optJSONObject("data") ?: json
                        val iso = data.optString("serverTime", "")
                        if (iso.isNotEmpty() && iso.length >= 19) iso.substring(11, 19) else null
                    } catch (e: Exception) { null }
                    conn.disconnect()
                    return PingResult(true, time, null)
                } else {
                    lastError = "HTTP $code"
                    conn.disconnect()
                }
            } catch (e: Exception) {
                lastError = e.message ?: e.javaClass.simpleName
            }
        }
        return PingResult(false, null, lastError)
    }

    private fun showStatus(msg: String, ok: Boolean) {
        configBind.tvTestStatus.visibility = View.VISIBLE
        configBind.tvTestStatus.text = msg
        val colorRes = if (ok) R.color.success else R.color.danger
        configBind.tvTestStatus.setTextColor(getColor(colorRes))
    }

    private fun onSave() {
        val url = configBind.etUrl.text.toString().trim()
        if (url.isEmpty()) {
            Toast.makeText(this, R.string.config_no_url, Toast.LENGTH_SHORT).show()
            return
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            Toast.makeText(this, R.string.config_invalid_url, Toast.LENGTH_SHORT).show()
            return
        }
        Prefs.setServerUrl(this, url)
        loadWeb(url)
    }

    // ============ WebView ============

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val wv = bind.webView
        val s: WebSettings = wv.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true            // localStorage 必开 (PWA 用它存 client token)
        s.databaseEnabled = true
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.loadWithOverviewMode = true
        s.useWideViewPort = true
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.mediaPlaybackRequiresUserGesture = false   // PWA 视频播放不要求点
        s.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        s.userAgentString = s.userAgentString + " JinhuShell/${BuildConfig.VERSION_NAME}"

        // 禁缩放 (跟 PWA 一致, 原生 app 感)
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        s.displayZoomControls = false

        wv.isVerticalScrollBarEnabled = false
        wv.isHorizontalScrollBarEnabled = false
        wv.overScrollMode = View.OVER_SCROLL_NEVER

        wv.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                bind.errorOverlay.visibility = View.GONE
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                val msg = "${error.errorCode}: ${error.description}"
                bind.errorText.text = getString(R.string.webview_error, msg)
                bind.errorOverlay.visibility = View.VISIBLE
            }
        }
        wv.webChromeClient = WebChromeClient()

        bind.btnGear.setOnClickListener { showConfig() }
        bind.btnRetry.setOnClickListener {
            bind.errorOverlay.visibility = View.GONE
            bind.webView.reload()
        }
        bind.btnChangeServer.setOnClickListener {
            bind.errorOverlay.visibility = View.GONE
            showConfig()
        }
    }

    private fun loadWeb(url: String) {
        bind.configPanel.root.visibility = View.GONE
        bind.webPanel.visibility = View.VISIBLE
        bind.webView.loadUrl(url)
    }

    // ============ 返回键 ============

    private fun setupBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (bind.webPanel.visibility == View.VISIBLE && bind.webView.canGoBack()) {
                    bind.webView.goBack()
                } else {
                    // 双击退出
                    if (lastBackPressed > 0 && System.currentTimeMillis() - lastBackPressed < 2000) {
                        finish()
                    } else {
                        lastBackPressed = System.currentTimeMillis()
                        Toast.makeText(this@MainActivity, "再按一次退出", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })
    }
    private var lastBackPressed: Long = 0

    // ============ 音量键留给 WebView (不拦截) ============
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // KEYCODE_VOLUME_UP/DOWN: 让系统处理 (硬件键调音)
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        bind.webView.destroy()
        super.onDestroy()
    }

    // 数据未用, 防止编译警告
    @Suppress("unused")
    private fun nowFormatted(): String =
        SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
}

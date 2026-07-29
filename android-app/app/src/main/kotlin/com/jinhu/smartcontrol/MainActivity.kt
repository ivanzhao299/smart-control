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
        registerNetworkCallback()

        // 启动判断: 有 url → 探测双地址后进 WebView, 无 → 配置
        val saved = Prefs.getServerUrl(this)
        if (saved.isNullOrBlank()) {
            showConfig()
        } else {
            resolveAndLoad()
        }
    }

    // ============ 双地址自动选择 (2026-07-25) ============
    //
    // 业主: "远程连上了应用, 到展厅现场以后可以自动切换为局域网"。
    // 现场地址 (server_url, 展厅 LAN) + 远程地址 (remote_url, WireGuard 隧道/公网)。
    // 规则: **现场优先** (LAN 快且不占隧道) —— ping 现场通就用现场, 不通再试远程,
    // 都不通就仍加载现场地址 (让 WebView 的错误覆盖层出来, 业主可重试/重配)。
    // 触发: 启动 + 保存配置 + 系统网络变化 (Wi-Fi 切换/隧道连断, 2s 防抖)。

    /** 当前 WebView 实际加载的地址 (探测选中的那个) */
    private var activeUrl: String? = null
    private var resolving = false
    private val netHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var netCallback: android.net.ConnectivityManager.NetworkCallback? = null

    private fun resolveAndLoad() {
        val local = Prefs.getServerUrl(this) ?: return
        val remote = Prefs.getRemoteUrl(this)
        if (resolving) return
        resolving = true
        // 首次进入 (还没加载过页面): 探测期间亮"连接中"动画, 别黑屏 (2026-07-29 业主)
        if (activeUrl == null) {
            bind.configPanel.root.visibility = View.GONE
            bind.webPanel.visibility = View.VISIBLE
            bind.errorOverlay.visibility = View.GONE
            bind.loadingOverlay.visibility = View.VISIBLE
        }
        thread {
            val chosen = when {
                ping(local).ok -> local
                !remote.isNullOrBlank() && ping(remote).ok -> remote
                // 都不通返回 null: **第一时间**弹错误覆盖层 (2026-07-29 业主), 不再把
                // 死地址塞给 WebView 等 Chromium 慢慢超时黑屏
                else -> null
            }
            runOnUiThread {
                resolving = false
                if (chosen == null) {
                    if (activeUrl == null) {
                        bind.loadingOverlay.visibility = View.GONE
                        bind.errorText.text = getString(R.string.webview_error, "现场与远程地址都连不上, 正在自动重试")
                        bind.errorOverlay.visibility = View.VISIBLE
                        bind.btnGear.visibility = View.VISIBLE
                        // 4s 自动重探 — 网络恢复后无感自动进入
                        netHandler.postDelayed({ if (activeUrl == null) resolveAndLoad() }, 4000)
                    }
                    // 已在页面里: 不打扰, WebView 自己的错误覆盖层兜底
                    return@runOnUiThread
                }
                if (chosen != activeUrl) {
                    loadWeb(chosen)
                    if (activeUrl != null) {
                        val label = if (chosen == local) "现场局域网" else "远程隧道"
                        Toast.makeText(this, "已自动切换到$label", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    /** 系统网络一变 (进出展厅 Wi-Fi / 隧道连断) 就重探; 2s 防抖挡掉连环回调 */
    private fun registerNetworkCallback() {
        val cm = getSystemService(android.net.ConnectivityManager::class.java) ?: return
        val cb = object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) = scheduleResolve()
            override fun onLost(network: android.net.Network) = scheduleResolve()
            private fun scheduleResolve() {
                netHandler.removeCallbacksAndMessages(null)
                netHandler.postDelayed({
                    if (bind.webPanel.visibility == View.VISIBLE && !Prefs.getServerUrl(this@MainActivity).isNullOrBlank()) {
                        resolveAndLoad()
                    }
                }, 2000)
            }
        }
        try {
            cm.registerDefaultNetworkCallback(cb)
            netCallback = cb
        } catch (e: Exception) { /* 个别 ROM 限制注册数, 失败就退化为仅启动时探测 */ }
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
        // 两个地址都预填 (2026-07-29 业主: "远程地址也要默认填好, 不需每次重填"):
        // 存过就回显上次配置, 没存过填默认值
        val current = Prefs.getServerUrl(this) ?: BuildConfig.DEFAULT_SERVER_URL
        configBind.etUrl.setText(current)
        configBind.etRemoteUrl.setText(Prefs.getRemoteUrl(this) ?: BuildConfig.DEFAULT_REMOTE_URL)
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
        val remote = configBind.etRemoteUrl.text.toString().trim()
        if (url.isEmpty()) {
            showStatus(getString(R.string.config_no_url), false)
            return
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            showStatus(getString(R.string.config_invalid_url), false)
            return
        }
        if (remote.isNotEmpty() && !remote.startsWith("http://") && !remote.startsWith("https://")) {
            showStatus(getString(R.string.config_invalid_url), false)
            return
        }
        configBind.btnTest.isEnabled = false
        configBind.btnTest.text = getString(R.string.config_testing)

        thread {
            // 两个地址都测, 结果并排给业主看 (现场在展厅只有 LAN 通、在外面只有隧道通都是正常态)
            val localResult = ping(url)
            val remoteResult = if (remote.isNotEmpty()) ping(remote) else null
            runOnUiThread {
                configBind.btnTest.isEnabled = true
                configBind.btnTest.text = getString(R.string.config_test)
                val sb = StringBuilder()
                sb.append(if (localResult.ok) "现场: 连接成功 ✓ ${localResult.serverTime ?: ""}" else "现场: 连不上 (${localResult.error})")
                if (remoteResult != null) {
                    sb.append('\n')
                    sb.append(if (remoteResult.ok) "远程: 连接成功 ✓ ${remoteResult.serverTime ?: ""}" else "远程: 连不上 (${remoteResult.error})")
                }
                showStatus(sb.toString(), localResult.ok || remoteResult?.ok == true)
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
        val remote = configBind.etRemoteUrl.text.toString().trim()
        if (url.isEmpty()) {
            Toast.makeText(this, R.string.config_no_url, Toast.LENGTH_SHORT).show()
            return
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            Toast.makeText(this, R.string.config_invalid_url, Toast.LENGTH_SHORT).show()
            return
        }
        if (remote.isNotEmpty() && !remote.startsWith("http://") && !remote.startsWith("https://")) {
            Toast.makeText(this, R.string.config_invalid_url, Toast.LENGTH_SHORT).show()
            return
        }
        Prefs.setServerUrl(this, url)
        Prefs.setRemoteUrl(this, remote.ifEmpty { null })
        activeUrl = null   // 强制重新探测选择
        resolveAndLoad()
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

        // A2 (2026-07-25): 触感桥 — PWA 调 window.JinhuShell.vibrate(ms) 落到系统马达。
        // 只暴露这一个只写方法, 不开任何读取口子。
        wv.addJavascriptInterface(object {
            @android.webkit.JavascriptInterface
            fun vibrate(ms: Int) {
                try {
                    val v = getSystemService(android.os.Vibrator::class.java) ?: return
                    val dur = ms.coerceIn(1, 200).toLong()
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v.vibrate(android.os.VibrationEffect.createOneShot(dur, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
                    } else {
                        @Suppress("DEPRECATION") v.vibrate(dur)
                    }
                } catch (e: Exception) { /* 触感失败无所谓 */ }
            }
        }, "JinhuShell")

        wv.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                bind.errorOverlay.visibility = View.GONE
                applyGearVisibility(url)
            }
            override fun onPageFinished(view: WebView, url: String) {
                bind.loadingOverlay.visibility = View.GONE   // 页面到位, 收起连接中动画
                applyGearVisibility(url)
            }
            /** PWA 是 SPA, router.push 不走 onPageStarted, 但走 doUpdateVisitedHistory. */
            override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                applyGearVisibility(url)
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                val msg = "${error.errorCode}: ${error.description}"
                bind.loadingOverlay.visibility = View.GONE
                bind.errorText.text = getString(R.string.webview_error, msg)
                bind.errorOverlay.visibility = View.VISIBLE
                // 出错也露出齿轮, 业主可以切换服务器
                bind.btnGear.visibility = View.VISIBLE
            }
        }
        wv.webChromeClient = WebChromeClient()

        bind.btnGear.setOnClickListener { showConfig() }
        bind.btnRetry.setOnClickListener {
            bind.errorOverlay.visibility = View.GONE
            // 还没成功加载过 (探测全败的第一时间提示) → 重新探测; 加载过 → 刷新页面
            if (activeUrl == null) resolveAndLoad() else bind.webView.reload()
        }
        bind.btnChangeServer.setOnClickListener {
            bind.errorOverlay.visibility = View.GONE
            showConfig()
        }
    }

    private fun loadWeb(url: String) {
        activeUrl = url
        bind.configPanel.root.visibility = View.GONE
        bind.webPanel.visibility = View.VISIBLE
        bind.webView.loadUrl(url)
        // 加载 PWA 之后异步检查 APP 自身版本
        UpdateChecker.checkAsync(this, url)
    }

    /**
     * 齿轮按钮可见性策略:
     *   - PWA 登录页 (/client-login)  → 显示 (业主可能要换 server)
     *   - 进入业主侧主页面 (dashboard / lighting / ...) → 隐藏 (避免遮挡 PWA 顶部时钟)
     *   - 出错 → onReceivedError 那边显式显示
     *
     * 业主反馈 2026-05-31: 登录成功后这个图标没必要再存在.
     */
    private fun applyGearVisibility(url: String?) {
        val show = url?.contains("/client-login") == true
        bind.btnGear.visibility = if (show) View.VISIBLE else View.GONE
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
        netCallback?.let {
            try { getSystemService(android.net.ConnectivityManager::class.java)?.unregisterNetworkCallback(it) } catch (e: Exception) { /* already gone */ }
        }
        netHandler.removeCallbacksAndMessages(null)
        bind.webView.destroy()
        super.onDestroy()
    }

    // 数据未用, 防止编译警告
    @Suppress("unused")
    private fun nowFormatted(): String =
        SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
}

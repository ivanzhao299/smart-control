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
        setupBiometricLock()

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

    // ============ 面容/指纹应用锁 (2026-07-30 业主要求) ============
    //
    // 形态是"应用锁"而非"登录方式": 客户端令牌本就 30 天自动登录, 真正缺的是
    // "拿到手机就能开灯断电"的防线。开着时: 冷启动必验; 切后台超过宽限期
    // (60s) 回来重验。验证走系统 BiometricPrompt, 自动落到面部/指纹/锁屏密码。
    // 默认关, 配置页开关; 开与关都要先过一次验证 (防配置页被人顺手关锁)。

    private companion object { const val LOCK_GRACE_MS = 60_000L }

    /** 本进程内是否已验证通过 (冷启动为 false) */
    private var unlocked = false
    private var lastBackgroundAt = 0L
    private var authInFlight = false

    override fun onStart() {
        super.onStart()
        maybeLock()
    }

    override fun onStop() {
        super.onStop()
        lastBackgroundAt = System.currentTimeMillis()
    }

    private fun setupBiometricLock() {
        bind.btnUnlock.setOnClickListener { if (!authInFlight) startUnlockAuth() }
    }

    private fun maybeLock() {
        if (!Prefs.isBiometricLock(this)) return
        val awayTooLong = lastBackgroundAt > 0 &&
            System.currentTimeMillis() - lastBackgroundAt > LOCK_GRACE_MS
        if (unlocked && !awayTooLong) return
        unlocked = false
        bind.lockOverlay.visibility = View.VISIBLE
        if (!authInFlight) startUnlockAuth()
    }

    private fun startUnlockAuth() {
        authenticate(
            onSuccess = {
                unlocked = true
                bind.lockOverlay.visibility = View.GONE
            },
            onFail = { /* 覆盖层留着, 业主点"解锁"重试 */ },
        )
    }

    /** 系统生物验证弹窗 — 面部/指纹优先, 兜底锁屏密码 (所以不设取消按钮文案) */
    private fun authenticate(onSuccess: () -> Unit, onFail: () -> Unit) {
        val authenticators = androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK or
            androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
        authInFlight = true
        val prompt = androidx.biometric.BiometricPrompt(
            this,
            androidx.core.content.ContextCompat.getMainExecutor(this),
            object : androidx.biometric.BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: androidx.biometric.BiometricPrompt.AuthenticationResult) {
                    authInFlight = false
                    onSuccess()
                }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    authInFlight = false
                    onFail()
                }
                // onAuthenticationFailed = 单次没认出来, 系统弹窗自己继续收, 不处理
            },
        )
        val info = androidx.biometric.BiometricPrompt.PromptInfo.Builder()
            .setTitle(getString(R.string.biometric_prompt_title))
            .setSubtitle(getString(R.string.biometric_prompt_subtitle))
            .setAllowedAuthenticators(authenticators)
            .build()
        prompt.authenticate(info)
    }

    /** 主线程上往 WebView 注 JS (面容登录回调用) */
    private fun evalJs(js: String) {
        runOnUiThread { bind.webView.evaluateJavascript(js, null) }
    }

    /** 设备是否配了任一可用验证方式 (面部/指纹/锁屏密码) */
    private fun canAuthenticate(): Boolean {
        val bm = androidx.biometric.BiometricManager.from(this)
        return bm.canAuthenticate(
            androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK or
                androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL,
        ) == androidx.biometric.BiometricManager.BIOMETRIC_SUCCESS
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
        // 清除页面缓存 (2026-07-29 业主: 改动后手机端看不到新版) —— 清 WebView HTTP
        // 缓存 + localStorage/Service Worker 存储, 然后重进页面强制拉全新资源。
        // 注意: 客户端登录 token 也存 localStorage, 清完要重登一次 —— 提示里说清楚。
        configBind.btnClearCache.setOnClickListener {
            bind.webView.clearCache(true)
            try { android.webkit.WebStorage.getInstance().deleteAllData() } catch (e: Exception) { }
            try {
                android.webkit.CookieManager.getInstance().removeAllCookies(null)
                android.webkit.CookieManager.getInstance().flush()
            } catch (e: Exception) { }
            Toast.makeText(this, R.string.config_cache_cleared, Toast.LENGTH_LONG).show()
            activeUrl = null           // 强制重探重载
            resolveAndLoad()
        }

        // 面容/指纹解锁开关 — 开与关都先过一次系统验证 (防配置页被人顺手关锁)
        var suppressSwitch = false
        configBind.swBiometric.isChecked = Prefs.isBiometricLock(this)
        configBind.swBiometric.setOnCheckedChangeListener { _, checked ->
            if (suppressSwitch) return@setOnCheckedChangeListener
            fun revert() {
                suppressSwitch = true
                configBind.swBiometric.isChecked = !checked
                suppressSwitch = false
            }
            if (checked && !canAuthenticate()) {
                Toast.makeText(this, R.string.biometric_unavailable, Toast.LENGTH_LONG).show()
                revert()
                return@setOnCheckedChangeListener
            }
            authenticate(
                onSuccess = {
                    Prefs.setBiometricLock(this, checked)
                    if (checked) unlocked = true   // 刚验过, 本次会话不再弹
                    Toast.makeText(
                        this,
                        if (checked) R.string.biometric_enabled else R.string.biometric_disabled,
                        Toast.LENGTH_SHORT,
                    ).show()
                },
                onFail = { revert() },
            )
        }
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
        // 2026-07-31 扩展面容登录四方法: bioInfo / saveBioPassword / clearBioPassword /
        // requestBioLogin。密码只进 Keystore 加密 prefs, 只在系统生物验证通过后
        // 经回调注回登录页 —— 不提供任何"不验证直接读"的口子。
        // ⚠️ @JavascriptInterface 方法跑在 binder 线程, 碰 UI/弹窗必须 runOnUiThread。
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

            // ---- 面容登录 v1.1.9 老接口 (固定 client 槽), 兼容已发布的 PWA ----
            @android.webkit.JavascriptInterface
            fun bioInfo(): String = bioInfoScoped("client")

            @android.webkit.JavascriptInterface
            fun saveBioPassword(pwd: String) = saveBioPasswordScoped("client", pwd)

            @android.webkit.JavascriptInterface
            fun clearBioPassword() = clearBioPasswordScoped("client")

            @android.webkit.JavascriptInterface
            fun requestBioLogin() = requestBioLoginScoped("client")

            // ---- v1.1.10 双槽位: scope = "client"(业主密码) / "admin"(后台管理密码) ----
            @android.webkit.JavascriptInterface
            fun bioInfoScoped(scope: String): String {
                val saved = Prefs.getBioPassword(this@MainActivity, scope) != null
                return "{\"available\":${canAuthenticate()},\"saved\":$saved}"
            }

            @android.webkit.JavascriptInterface
            fun saveBioPasswordScoped(scope: String, pwd: String) {
                if (pwd.isNotEmpty()) Prefs.setBioPassword(this@MainActivity, pwd, scope)
            }

            @android.webkit.JavascriptInterface
            fun clearBioPasswordScoped(scope: String) {
                Prefs.clearBioPassword(this@MainActivity, scope)
            }

            @android.webkit.JavascriptInterface
            fun requestBioLoginScoped(scope: String) {
                runOnUiThread {
                    val pwd = Prefs.getBioPassword(this@MainActivity, scope)
                    if (pwd.isNullOrEmpty() || !canAuthenticate()) {
                        evalJs("window.__jinhuBioLoginFail&&window.__jinhuBioLoginFail()")
                        return@runOnUiThread
                    }
                    authenticate(
                        onSuccess = {
                            evalJs(
                                "window.__jinhuBioLoginOk&&window.__jinhuBioLoginOk(" +
                                    org.json.JSONObject.quote(pwd) + ")",
                            )
                        },
                        onFail = { evalJs("window.__jinhuBioLoginFail&&window.__jinhuBioLoginFail()") },
                    )
                }
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

# 金湖智控 iOS 壳 (SmartControl)

WKWebView 包 PWA 的原生壳,行为与安卓壳 (`android-app/`) 1:1 对齐:

- 首次启动:配置页输入服务器地址 → "测试连接"(打 `/api/client-auth/ping`,显示服务器时间)→ 保存进入
- 之后启动:直接全屏 WebView 加载 PWA(localStorage/自动播放/黑底/常亮)
- 齿轮按钮只在 PWA 登录页(`/client-login`)或加载出错时出现,可切换服务器
- 加载失败:错误覆盖层(重试 / 切换服务器)
- 启动后异步检查 `/api/app/ios/latest`,按后台"APP 版本管理"的配置弹更新提示
  (支持 forceUpdate / minSupportedVersionCode / 7 天"稍后"免打扰,同安卓)

## 工程结构

不入库 `.xcodeproj` —— 用 [XcodeGen](https://github.com/yonaskolb/XcodeGen) 从
`project.yml` 生成:

```bash
brew install xcodegen
cd ios-app
xcodegen generate        # 生成 SmartControl.xcodeproj
open SmartControl.xcodeproj
```

## CI 构建 (GitHub Actions)

`.github/workflows/ios-build.yml`:push 到 main 且 `ios-app/**` 有改动时自动跑
(也可 Actions 页面手动触发),产物是 **SmartControl-unsigned.ipa**(未签名)。

## 安装到 iPhone(未签名 IPA 怎么装)

GitHub runner 没有 Apple 证书,IPA 未签名,不能直接点开安装。两条路:

### 路线 A:免费侧载(现在就能用,零成本)

1. 电脑装 [Sideloadly](https://sideloadly.io/)(Win/Mac 都有)或 AltStore
2. 从 Actions 下载 `SmartControl-unsigned.ipa`
3. iPhone 用数据线连电脑,Sideloadly 里选 IPA + 输入自己的 Apple ID → Start
4. iPhone 上:设置 → 通用 → VPN与设备管理 → 信任该开发者
5. **免费 Apple ID 签名 7 天有效**,过期后 app 打不开,重新侧载一次即可
   (Sideloadly 可以设自动续签)

### 路线 B:Apple Developer 账号($99/年,正式分发)

1. 注册 [Apple Developer Program](https://developer.apple.com/programs/)
2. 生成发布证书(.p12)+ App ID(com.jinhu.smartcontrol)+ 描述文件
3. 把 p12(base64)和描述文件放进 repo Secrets,在 ios-build.yml 里加
   `import-codesign-certs` + `xcodebuild archive/-exportArchive` 签名步骤
4. 之后可走 **TestFlight**(最多 100 内部测试员,免审核快速分发,90 天)
   或 **Ad Hoc**(指定设备 UDID 直装)
5. 后台"APP 版本管理 → ios"里把 downloadUrl 填 TestFlight 邀请链接,
   APP 内更新提示即可跳转

## 后台联动

后台 → APP 版本管理 → ios tab:填 versionCode/versionName/downloadUrl/更新说明,
APP 启动时会按规则弹更新提示(同安卓)。

# 金湖智控原生 iOS 系统 (SmartControl)

从 2.0 起，登录、服务器自动选择、情景模式、灯光、空调、电源、设备状态与
播放状态均由 SwiftUI + URLSession 原生实现。媒体上传、音响矩阵和后台配置
在迁移期间继续通过应用内“兼容工作台”提供，避免功能倒退。

发布沿用独立的 SwiftUI → GitHub Actions → App Store Connect 云签名 →
TestFlight 路线。只复用 Air Control Media 验证过的流程结构；Bundle ID
`com.jinhu.smartcontrol`、应用记录、测试组和 Secrets 必须保持独立。

原生版出现生产级问题时，使用固定 tag `ios-shell-v1.1.10-build7` 恢复上一版
WKWebView 壳；只恢复 `ios-app/`，不回退后端、数据库或其他终端。完整步骤见
[`../docs/IOS_NATIVE_ROLLBACK.md`](../docs/IOS_NATIVE_ROLLBACK.md)。

## 1.x 兼容壳说明

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

### 路线 B:TestFlight(已配好 CI,只差 4 个 Secrets)

1. **生成 API 密钥**:appstoreconnect.apple.com → 用户和访问 → 集成 →
   App Store Connect API → 团队密钥 → ➕(名称 `ci`,权限 **App 管理**)。
   记下 **Issuer ID**、**密钥 ID**,下载 `AuthKey_XXXX.p8`(只能下载一次!)
2. **Team ID**:developer.apple.com → Membership 页面,10 位字符。
3. **注册 App**:developer.apple.com → Identifiers → ➕ App ID
   (`com.jinhu.smartcontrol`);再到 App Store Connect → 我的 App → ➕ 新建
   (名称如「金湖智控」,若被占换「金湖展贸智控」;语言简体中文;SKU 随意)。
4. **配 Secrets**(GitHub 仓库 → Settings → Secrets → Actions):
   `APPSTORE_KEY_ID` / `APPSTORE_ISSUER_ID` / `APPLE_TEAM_ID` /
   `APPSTORE_P8_BASE64`(p8 文件 base64:`base64 -i AuthKey_XXXX.p8`)。
5. 之后每次 push,CI 自动签名并上传 TestFlight;iPhone 装 TestFlight APP
   接受邀请即可安装/自动更新。后台"APP 版本管理" ios downloadUrl 填
   TestFlight 公开链接。

### 旧路线:Apple Developer 手动($99/年,正式分发)

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

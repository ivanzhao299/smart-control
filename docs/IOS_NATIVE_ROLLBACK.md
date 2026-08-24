# iOS 原生版生产回滚手册

## 保留的稳定壳版本

- Git tag: `ios-shell-v1.1.10-build7`
- Commit: `6fc60780d5f832527a74ac7d5318eca99fa2ac69`
- App version: `1.1.10 (7)`
- Bundle ID: `com.jinhu.smartcontrol`
- 形态: SwiftUI 容器 + WKWebView 加载生产 PWA

该 tag 固定在原生 2.0 改造之前，包含当时完整的 iOS 壳、Face ID、Keychain、
现场/公网自动切换和 TestFlight 工作流。tag 已推送到 GitHub，不依赖某台 Mac。

## 回滚原则

只恢复 `ios-app/`，不要回退整个仓库。后端、前端、Android、数据库、部署脚本和
GK9000 运行状态都继续留在当前版本，避免为了回滚手机 UI 而回退生产系统。

TestFlight 不允许上传比当前构建号更旧的包。回滚时恢复壳源码后，仍需使用新的
版本号和构建号重新上传；不能把旧的 `1.1.10 (7)` 原样再次上传。

## 标准回滚步骤

在干净的 `main` 上执行：

```bash
git fetch origin --tags
git restore --source ios-shell-v1.1.10-build7 -- ios-app
```

然后编辑 `ios-app/project.yml`：

- `MARKETING_VERSION` 设置为高于当前 TestFlight 版本的补丁版本，例如 `2.0.1`；
- `CURRENT_PROJECT_VERSION` 可保留占位值，GitHub Actions 归档时会使用新的
  workflow run number 作为构建号。

本地验证：

```bash
cd ios-app
xcodegen generate
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project SmartControl.xcodeproj \
  -scheme SmartControl \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build
```

验证成功后提交并推送 `main`。`iOS IPA` 工作流会重新构建、云签名并上传
TestFlight。必须等 Apple Processing 完成并在实际 iPhone 上确认壳版可用，才算
回滚完成。

## 紧急情况下不应做的事

- 不要执行整个仓库的 `git reset --hard`。
- 不要恢复旧数据库或旧后端来配合手机回滚。
- 不要删除原生分支、TestFlight 构建或 App Store Connect 应用记录。
- 不要覆盖、复制或导出其他 Apple 应用的签名凭据。
- 不要把“上传成功”当作“手机已经回滚”，必须验证 TestFlight 和真机。

## 恢复原生开发

壳版回滚只改变随后发布的 iOS 源码，不会删除原生开发历史。原生 2.0 起点为：

- Commit: `f4049c562036da476e345b4cdd916f0dd5761e5a`

问题修复后可以从该提交或后续修复分支继续开发，再用更高版本号发布。

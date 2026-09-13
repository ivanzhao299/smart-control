# 金湖中控 v2 · 设计 Mockup

> 2026-05-27 · 重构 v2 设计语言演示稿
> 平板优先 · 现代视觉 · 触控友好

## 文件

| 文件 | 场景 | 视口 |
|---|---|---|
| `01-dashboard.html` | 首页 Dashboard:KPI / 场景一键切换 / 子系统状态 | 1180×820 (iPad 10.9") |
| `02-lighting.html` | 灯光分区控制:总览 + 分区卡 + 滑条 + 预设 | 1180×820 (iPad 10.9") |

## 查看方式

### 在 GK9000 上(本地文件)

```
file:///D:/smart-control/docs/design-mockups/01-dashboard.html
file:///D:/smart-control/docs/design-mockups/02-lighting.html
```

Edge / Chrome 打开即可。F11 进全屏(模拟平板沉浸效果)。

### 在平板上

通过 cnjinhu.top 访问(需要 nginx 加一条路由),或 RDP 进 GK9000 后 USB 拷到平板。

### 在你的 Mac 上

```
open ~/projects/smart-control/docs/design-mockups/01-dashboard.html
open ~/projects/smart-control/docs/design-mockups/02-lighting.html
```

## 设计要点

- **配色**:深石板蓝灰底 + 青(主)+ 琥珀(暖强调),场景各保留一抹独特色但收敛饱和度
- **玻璃面板**:`backdrop-blur(20px)` + 极淡描边,层级用 surface-1 / surface-2 区分
- **图标**:Lucide(线条 1.8 描边),尺寸跟字号比例 1:1
- **字体**:中文系统(PingFang/微软雅黑)+ 数字 Inter(等宽 numerals)
- **触控目标**:主交互最小 44×44pt,滑条 12px 高带 20px 圆点
- **场景按钮**:从大磁贴 → 3×2 紧凑卡,激活态用渐变 + 脉冲点
- **子系统卡**:从五列长条 → 单行紧凑 chips,带在线/离线状态

## 跟当前页面对比

| 维度 | 当前 (v1) | v2 |
|---|---|---|
| Dashboard 是否需要滚动 | 是,内容超视口 | 否,单屏装下 |
| 场景卡尺寸 | 110px 高,占大块 | 144px 高 3×2 网格,紧凑 |
| 子系统卡 | 5 张长条卡 | 单行 chips,操作更轻 |
| 侧栏 | 100px 宽,中等图标 | 72px 宽,图标 only |
| 顶部告警 | 90px 红条常驻 | 折叠到 pill,展开按需 |
| 信息密度 | 中 | 高 + 易扫读 |
| 配色基调 | 蓝紫渐变(品牌) | 深石板 + 青琥珀(现代) |

## 不在 mockup 里(P3+ 后续)

- 子系统页:LED / 音响 / 空调 / 媒体 / 状态 / 后台(同一组件体系自然套用)
- 手机端版本(目前只画了平板)
- 暗黑/明亮主题切换
- 动效细节(打开 mockup 看 hover 已能感受一部分)

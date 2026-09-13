# 金湖中控 v3 设计系统

> "蔚来/小鹏车机风" — 深空蓝 + 极光紫 + 电光青 + 多色 glow + 玻璃拟态.
> 2026-05-31 业主明确锁定方向后整理. 后续所有新页面 / 新组件按这套来,
> 不要再回到"专业克制"的灰扑扑路子.

---

## 目录

1. [设计哲学](#1-设计哲学)
2. [技术栈](#2-技术栈)
3. [色彩系统](#3-色彩系统)
4. [字体规范](#4-字体规范)
5. [间距 / 圆角 / 阴影](#5-间距--圆角--阴影)
6. [七大设计模式](#6-七大设计模式)
7. [Element Plus 暗黑覆盖](#7-element-plus-暗黑覆盖)
8. [Aurora 背景动效](#8-aurora-背景动效)
9. [反模式 (不要做)](#9-反模式)
10. [新组件 / 新页面快速模板](#10-新组件--新页面快速模板)

---

## 1. 设计哲学

### 业主明确反馈过的两版

| 版本 | 业主原话 | 状态 |
|---|---|---|
| v2 (旧) | "性冷淡 / 蓝色脏 / 暗陈无趣 / 没科技感" | 已废 |
| v3 (现) | "非常给力, 按钮很明显, 便于操作" | 锁定 |

### 场景定位

展厅中控, **业主带客户来就觉得"哇这中控屏挺贵"**.
平板 (业主操作) + 大屏 (现场展示) 同套设计.

### 视觉灵感

不抄, 但参考:
- 蔚来 NIO ET7 / 小鹏 X9 车机屏 (主参考)
- Tesla 中控 — 极简数据 + 等宽数字
- Apple Vision Pro 控制中心 — 玻璃拟态 + glow
- Cyberpunk 2077 menu — 高饱和霓虹 + 顶部光带
- 中国天宫 / SpaceX Mission Control — 数据可视化

---

## 2. 技术栈

| 层 | 用了什么 |
|---|---|
| 组件库 | Element Plus 2.14 (按需引入, EP 暗黑变量覆盖) |
| 图标 | lucide-vue-next (线性, tree-shake) |
| 字体 | 系统栈 (Inter / JetBrains Mono / PingFang SC) |
| CSS 框架 | **无** — 全 raw CSS + CSS variables |
| 动效 | 全 CSS @keyframes + transitions, **无** GSAP/Motion |
| 构建 | Vite 5 + vite-plugin-pwa + ElementPlusResolver |

样式架构:

```
frontend/src/styles/
├─ design-tokens.css   # CSS variables 池 (颜色/间距/字号/阴影/动画)
├─ theme.css           # 全局 reset + body + Element Plus 暗黑覆盖
└─ (各 .vue <style scoped>)
```

---

## 3. 色彩系统

### 中性 / 背景 / 表面

```css
--v2-bg-0: #060818;                          /* 深空蓝底 (不是纯黑, 暖一点带紫) */
--v2-bg-1: #0E0F2A;                          /* 渐变低点, 加紫调 */
--v2-surf-1: rgba(140, 180, 255, 0.10);      /* 卡片底: 微紫白玻璃 */
--v2-surf-1-hover: rgba(140, 180, 255, 0.16);
--v2-surf-2: rgba(255, 255, 255, 0.10);      /* 卡内嵌 (表格行/输入框) */
--v2-surf-3: rgba(140, 180, 255, 0.18);      /* 抽屉/dialog */

--v2-border-soft: rgba(120, 180, 255, 0.22);
--v2-border-strong: rgba(0, 229, 255, 0.45);

--v2-text-1: rgba(255, 255, 255, 0.98);      /* 主文字 — 几乎纯白 */
--v2-text-2: rgba(220, 230, 255, 0.72);      /* 二级 — 带紫调 */
--v2-text-3: rgba(180, 200, 240, 0.52);      /* 三级 — 弱化/placeholder */
```

### 品牌 + 副 + 强调

```css
/* 主色三件套 — v3 灵魂 */
--v2-primary:       #00E5FF;                 /* 电光青 (不要 #06b6d4 灰青) */
--v2-primary-dark:  #00B8D4;
--v2-primary-hover: #67FFFF;                 /* hover 更亮 */
--v2-primary-soft:  rgba(0, 229, 255, 0.32);

--v2-purple:       #A855F7;                  /* 极光紫 — 副色 */
--v2-purple-soft:  rgba(168, 85, 247, 0.32);
--v2-purple-glow:  rgba(168, 85, 247, 0.55);

--v2-pink:         #F472B6;                  /* 霓虹粉 — 强调/告警 */
--v2-pink-soft:    rgba(244, 114, 182, 0.30);
```

### 状态色

```css
--v2-amber:    #FFB800;                      /* 灯光琥珀, 提亮版 */
--v2-success:  #00E78A;                      /* 霓虹绿 */
--v2-warning:  #FFB800;
--v2-danger:   #FF4757;                      /* 鲜红, 不闷 */
--v2-info:     #5B8FFF;                      /* 信息蓝, 带紫 */

--v2-amber-soft:   rgba(255, 184, 0, 0.32);
--v2-success-soft: rgba(0, 231, 138, 0.32);
--v2-warning-soft: rgba(255, 184, 0, 0.32);
--v2-danger-soft:  rgba(255, 71, 87, 0.32);
--v2-info-soft:    rgba(91, 143, 255, 0.32);
```

### 多色 Glow Text-shadow (给 KPI / 大数字)

```css
--v2-text-glow-primary: 0 0 20px rgba(0, 229, 255, 0.7), 0 0 6px rgba(0, 229, 255, 0.45);
--v2-text-glow-amber:   0 0 20px rgba(255, 184, 0, 0.7), 0 0 6px rgba(255, 184, 0, 0.45);
--v2-text-glow-purple:  0 0 20px rgba(168, 85, 247, 0.7), 0 0 6px rgba(168, 85, 247, 0.45);
--v2-text-glow-success: 0 0 20px rgba(0, 231, 138, 0.7), 0 0 6px rgba(0, 231, 138, 0.45);
--v2-text-glow-danger:  0 0 20px rgba(255, 71, 87, 0.7), 0 0 6px rgba(255, 71, 87, 0.45);
--v2-text-glow-pink:    0 0 20px rgba(244, 114, 182, 0.7), 0 0 6px rgba(244, 114, 182, 0.45);
```

### 子系统色对位 (重要 — 改任何子系统按此)

| 子系统 | 主色 | hex | 用在 |
|---|---|---|---|
| **灯光** | 琥珀 | `#FFB800` | LightingPage zone 卡 + 亮度滑条 + on glow |
| **LED 大屏** | 电光青 | `#00E5FF` | LedPage screen 卡 + 输入源 chip |
| **音响** | 霓虹绿 | `#00E78A` | AudioPage 通道卡 + 音量滑条 |
| **空调** | 深空蓝紫 | `#5B8FFF → #A855F7` | HvacPage 区卡 + 温度数字 gradient |
| **电源** | 极光紫 | `#A855F7` | PowerPage 回路卡 + 数据值 |

新加的子系统要选个**还没用过的鲜亮色**, 不要重复.

---

## 4. 字体规范

```css
/* 字号 */
--v2-fs-xs:    11px;    /* label / hint / 小说明 */
--v2-fs-sm:    13px;    /* 普通文本 */
--v2-fs-base:  14px;
--v2-fs-md:    16px;    /* 小标题 */
--v2-fs-lg:    20px;    /* 卡片标题 */
--v2-fs-xl:    26px;    /* KPI / 亮度 / 温度 */
--v2-fs-display: 36px;  /* 大显示数字 */
```

### 字体栈

```css
body {
  font-family: -apple-system, BlinkMacSystemFont,
               "PingFang SC", "Microsoft YaHei",
               "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.02em;
}

/* 数字专用 — 等宽 + tabular-nums (KPI / 时钟 / 表格数字) */
.v2-inter {
  font-family: "Inter", "SF Pro Display", system-ui, sans-serif;
  font-variant-numeric: tabular-nums;  /* 数字宽度对齐, 不抖 */
  letter-spacing: 0.5px;
}

/* code 块 / 调试信息 / 等宽数字 */
code {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace;
  font-variant-numeric: tabular-nums;
}
```

### 大数字一律 Bold + Glow

```css
.kpi-value {
  font-size: 24px;           /* 比 v2 大 30% */
  font-weight: 700;
  letter-spacing: 0.5px;
  text-shadow: var(--v2-text-glow-primary);   /* 多色池, 按品类选 */
}
```

---

## 5. 间距 / 圆角 / 阴影

### 间距 (4px 基准)

```css
--v2-sp-1: 4px;
--v2-sp-2: 8px;
--v2-sp-3: 12px;
--v2-sp-4: 16px;
--v2-sp-5: 24px;
--v2-sp-6: 32px;
```

### 圆角

```css
--v2-r-sm:  8px;     /* 按钮 / chip */
--v2-r-md:  12px;    /* 输入框 / icon box */
--v2-r-lg:  16px;    /* 卡片 (默认) */
--v2-r-xl:  22px;    /* 大卡 / 弹层 */
```

### 阴影 (4 档 + 2 cyan glow)

```css
--v2-elev-0: none;
--v2-elev-1: 0 2px 8px -2px rgba(0, 0, 0, 0.35),
             0 0 0 1px rgba(255, 255, 255, 0.05) inset;
--v2-elev-2: 0 8px 24px -8px rgba(0, 0, 0, 0.55),
             0 0 0 1px rgba(255, 255, 255, 0.08) inset;
--v2-elev-3: 0 24px 56px -16px rgba(0, 0, 0, 0.7),
             0 0 0 1px rgba(255, 255, 255, 0.10) inset;

--v2-glow-primary:        0 4px 16px -4px rgba(6, 182, 212, 0.5);
--v2-glow-primary-strong: 0 6px 24px -6px rgba(6, 182, 212, 0.7);
```

---

## 6. 七大设计模式

### 模式 1: 顶部 1px 光带 (Top Hairline Glow)

**v3 卡片"通电"的标志**. 默认弱, hover/on 更强.

```css
.my-card::after {
  content: '';
  position: absolute;
  top: 0; left: 12%; right: 12%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--main-color) 50%, transparent);
  box-shadow: 0 0 8px var(--main-color);
  opacity: 0.35;          /* 默认 */
  transition: opacity 0.28s ease;
}
.my-card:hover::after { opacity: 0.85; }
.my-card.on::after { opacity: 1; }
```

### 模式 2: 玻璃拟态卡片 (Glassmorphism)

```css
.my-card {
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg);
  backdrop-filter: blur(14px);       /* 14px, 不是 10px */
  -webkit-backdrop-filter: blur(14px);
  box-shadow: inset 0 1px 0 rgba(0, 229, 255, 0.5),  /* 顶部光晕 */
              var(--v2-elev-1);
  transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}
```

### 模式 3: Hover 浮起 + 双层 Halo

```css
.my-card:hover {
  transform: translateY(-3px);
  border-color: rgba(0, 229, 255, 0.45);
  box-shadow:
    inset 0 1px 0 rgba(0, 229, 255, 0.75),
    0 0 0 1px rgba(0, 229, 255, 0.18),
    0 12px 32px -10px rgba(0, 229, 255, 0.35),
    var(--v2-elev-2);
}
```

### 模式 4: on / active 状态 = 整卡发光

```css
.my-card.on {
  background: linear-gradient(135deg,
              rgba(0, 229, 255, 0.10),
              rgba(0, 184, 212, 0.04));
  border-color: rgba(0, 229, 255, 0.55);
  box-shadow:
    inset 0 1px 0 rgba(0, 229, 255, 0.65),
    0 8px 32px -8px rgba(0, 229, 255, 0.45),   /* 近层 */
    0 0 40px -10px rgba(0, 229, 255, 0.35);    /* 远层 */
}
```

### 模式 5: 大数字 Bold + Glow

```css
.my-num {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.5px;
  font-family: "Inter";
  font-variant-numeric: tabular-nums;
}
/* on 时点亮 */
.my-card.on .my-num {
  color: #67FFFF;                              /* 比主色亮 */
  text-shadow: var(--v2-text-glow-primary);
}
```

### 模式 6: 侧栏选中 — 左边光柱

```css
.nav-item.is-active::before {
  content: '';
  position: absolute;
  left: -10px; top: 50%;
  transform: translateY(-50%);
  width: 4px; height: 30px;
  background: linear-gradient(180deg,
              transparent,
              var(--v2-primary) 30%,
              var(--v2-primary-hover) 50%,
              var(--v2-primary) 70%,
              transparent);
  border-radius: 0 4px 4px 0;
  box-shadow:
    0 0 12px var(--v2-primary),                 /* 12px halo */
    0 0 24px var(--v2-primary-soft);            /* 24px outer halo */
}
.nav-item.is-active {
  background: linear-gradient(90deg,
              rgba(0, 229, 255, 0.20) 0%,
              rgba(0, 229, 255, 0.04) 100%);
  color: var(--v2-primary-hover);
}
.nav-item.is-active svg {
  filter: drop-shadow(0 0 10px var(--v2-primary));
}
```

### 模式 7: 图标 drop-shadow Glow

```css
.my-icon {
  filter: drop-shadow(0 0 8px var(--main-color-soft));
  transition: filter 0.22s ease;
}
.my-card:hover .my-icon { filter: drop-shadow(0 0 12px var(--main-color)); }
.my-card.on .my-icon { filter: drop-shadow(0 0 14px white); }
```

---

## 7. Element Plus 暗黑覆盖

design-tokens.css 末尾大段, 关键点:

```css
html {
  /* 主色映射 */
  --el-color-primary:          var(--v2-primary);
  --el-color-primary-light-3:  rgba(6, 182, 212, 0.45);
  /* ... 9 档 light/dark */

  /* 表面色 */
  --el-bg-color:               #161B2A;          /* 实色, 用于 overlay */
  --el-bg-color-overlay:       #1B2034;          /* dialog / dropdown */
  --el-bg-color-page:          var(--v2-bg-0);

  /* 文字 — 全覆盖 */
  --el-text-color-primary:     var(--v2-text-1);
  --el-text-color-regular:     var(--v2-text-1);
  --el-text-color-secondary:   var(--v2-text-2);
  --el-text-color-placeholder: var(--v2-text-3);

  /* 表格 */
  --el-table-bg-color:         transparent;
  --el-table-tr-bg-color:      transparent;
  --el-table-row-hover-bg-color: rgba(0, 229, 255, 0.10);
}
```

### 五种 type 的 el-tag 重设

EP 默认浅底深字, 在深主题下看不清, 必须**深底浅字**:

```css
.el-tag.el-tag--primary {
  background-color: rgba(0, 229, 255, 0.18) !important;
  border-color: rgba(0, 229, 255, 0.45) !important;
  color: #67E8F9 !important;       /* 亮青 */
}
.el-tag.el-tag--success {
  background-color: rgba(16, 185, 129, 0.18) !important;
  border-color: rgba(16, 185, 129, 0.45) !important;
  color: #6EE7B7 !important;
}
/* warning / danger / info 同模式 */
```

### el-button[link] 透明 + 亮字

```css
.el-button.is-link {
  background: transparent !important;
  border: none !important;
  font-weight: 500;
}
.el-button.is-link.el-button--primary { color: #67E8F9 !important; }
.el-button.is-link.el-button--success { color: #6EE7B7 !important; }
.el-button.is-link.el-button--danger  { color: #FCA5A5 !important; }
.el-button.is-link.el-button--warning { color: #FCD34D !important; }
.el-button.is-link:hover {
  background: transparent !important;
  filter: brightness(1.3);
  text-decoration: underline;
}
```

### el-switch inline-prompt 强制白字

EP 默认 inline 字色跟底色同, 看不见. 强制白 + 1px shadow:

```css
.el-switch__inner,
.el-switch__inner span {
  color: #ffffff !important;
  font-weight: 600;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}
```

### el-button[type=primary] 实色发光 — 但要排除 link

```css
.el-button--primary:not(.is-link):not(.is-text) {
  background: linear-gradient(135deg,
              var(--v2-primary) 0%,
              var(--v2-primary-dark) 100%) !important;
  box-shadow: var(--v2-glow-primary);
}
```

**踩过的坑**: 不加 `:not(.is-link):not(.is-text)` 会把 link primary 按钮也加 gradient bg, 跟字同色看不见.

---

## 8. Aurora 背景动效

```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 50% 45% at 15% 10%, rgba(0, 229, 255, 0.22) 0%, transparent 55%),
    radial-gradient(ellipse 55% 40% at 85% 25%, rgba(168, 85, 247, 0.20) 0%, transparent 60%),
    radial-gradient(ellipse 45% 35% at 70% 95%, rgba(244, 114, 182, 0.16) 0%, transparent 55%),
    radial-gradient(ellipse 40% 30% at 10% 90%, rgba(255, 184, 0, 0.10) 0%, transparent 50%);
  animation: v2-aurora-drift 60s ease-in-out infinite;
}
@keyframes v2-aurora-drift {
  0%, 100% { transform: translate(0, 0) scale(1); }
  25%      { transform: translate(-3%, 2%) scale(1.05); }
  50%      { transform: translate(2%, -2%) scale(0.98); }
  75%      { transform: translate(-2%, -3%) scale(1.03); }
}
```

**关键**: 60s 一圈, 慢到不晕眩, 但有"宇宙在呼吸"感.

### 细网格 (科技感打底)

```css
body::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(120, 200, 255, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(120, 200, 255, 0.045) 1px, transparent 1px);
  background-size: 35px 35px;
  mask-image: radial-gradient(ellipse 80% 70% at 50% 30%, black 0%, rgba(0,0,0,0.4) 80%);
}
```

### 局部静态 (登录页 / 弹层): 关掉动画

```css
.admin-login {
  position: fixed;
  inset: 0;
  isolation: isolate;          /* 屏蔽全局 body::before */
  background: var(--v2-bg-0);  /* 实色 */
}
.admin-login .login-bg { animation: none; }   /* 显式禁动 */
```

---

## 9. 反模式 (不要做)

❌ **卡片底色 8.5% 微青** (灰扑扑, v2 老毛病)
❌ **主色用 `#06b6d4`** (闷)
❌ **文字全部 96% 白** (没层次)
❌ **box-shadow 单层** (没体积)
❌ **icon 平贴无 filter** (没"通电"感)
❌ **KPI 数字平字** (没仪表盘感)
❌ **静态背景** (科技 UI 必须有缓动 — aurora 漂浮)
❌ **el-tag 用 EP 默认浅底** (深主题下看不清)
❌ **el-button.is-link 不区分 type** (没色彩, 灰)
❌ **不必要的 hover 浮动** (登录页等"工具型"页面要稳)
❌ **`backdrop-filter: blur(10px)`** (太弱, 用 14px)
❌ **scoped style 用 `var(--el-text-color-primary)` 拿主色**
   (EP fallback 链不稳, 用 `var(--v2-text-1)` 直接)

---

## 10. 新组件 / 新页面快速模板

### 卡片模板 (照抄, 改主色)

```vue
<style scoped>
.my-card {
  position: relative;
  padding: var(--v2-sp-4);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg);
  backdrop-filter: blur(14px);
  transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
/* 顶光带 — 改 var(--v2-primary) 成该子系统主色 */
.my-card::after {
  content: '';
  position: absolute;
  top: 0; left: 12%; right: 12%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--v2-primary) 50%, transparent);
  box-shadow: 0 0 8px var(--v2-primary);
  opacity: 0.35;
  transition: opacity 0.28s ease;
}
.my-card:hover {
  transform: translateY(-3px);
  border-color: rgba(0, 229, 255, 0.45);
  box-shadow:
    inset 0 1px 0 rgba(0, 229, 255, 0.55),
    0 0 0 1px rgba(0, 229, 255, 0.15),
    0 14px 32px -10px rgba(0, 229, 255, 0.3);
}
.my-card:hover::after { opacity: 0.85; }
.my-card.on {
  border-color: rgba(0, 229, 255, 0.55);
  background: linear-gradient(135deg,
              rgba(0, 229, 255, 0.10),
              rgba(0, 184, 212, 0.04));
  box-shadow:
    inset 0 1px 0 rgba(0, 229, 255, 0.65),
    0 8px 32px -8px rgba(0, 229, 255, 0.45),
    0 0 40px -10px rgba(0, 229, 255, 0.35) !important;
}
.my-card.on::after { opacity: 1; }
/* 大数字 */
.my-card .big-num {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.5px;
  font-family: "Inter", system-ui;
  font-variant-numeric: tabular-nums;
}
.my-card.on .big-num {
  color: #67FFFF;                              /* 或该子系统亮色 */
  text-shadow: var(--v2-text-glow-primary);    /* 或对应 glow 池 */
}
</style>
```

### 切色给别的子系统

要做新子系统页 (e.g. 安防系统), 选个还没用过的色 (e.g. 霓虹粉 `#F472B6`),
然后:

1. 把上面模板里 `var(--v2-primary)` / `#00E5FF` 替换为该子系统色
2. on 状态 text-shadow 用 `var(--v2-text-glow-pink)`
3. 数字亮色用比主色亮一档的 (e.g. `#F9A8D4`)

### Page 结构 (照 LightingPage / PowerPage 抄)

```
PageRoot
├─ .v2-page-head (back button + title + tabs + quick-actions)
├─ .v2-overview (4 KPI summary cards)
├─ 加载/错误/空态 (state-card)
└─ .grid (cards × N)
```

### Admin Page 结构 (照 LightZonesAdmin / PowerCircuitsAdmin 抄)

```
SectionRoot ([class$="-admin"])
├─ .page-head (h2 + .sub + .actions filters/buttons)
├─ el-table (列表)
└─ el-drawer (新增/编辑 form)
```

---

## 11. CSS Variables 总览表

复制贴到任何文件的开头, 一份完整 token cheat sheet:

```css
/* === 中性 === */
var(--v2-bg-0)            /* #060818 深空蓝底 */
var(--v2-bg-1)            /* #0E0F2A 渐变低 */
var(--v2-surf-1)          /* 卡片底 */
var(--v2-surf-1-hover)    /* 卡片 hover 底 */
var(--v2-surf-2)          /* 卡内嵌 */
var(--v2-surf-3)          /* 抽屉 */
var(--v2-border-soft)     /* 默认边 */
var(--v2-border-strong)   /* hover/focus 边 */
var(--v2-text-1)          /* 主文字 96% 白 */
var(--v2-text-2)          /* 二级 72% */
var(--v2-text-3)          /* 三级 52% */

/* === 主色 === */
var(--v2-primary)         /* #00E5FF 电光青 */
var(--v2-primary-dark)
var(--v2-primary-hover)   /* #67FFFF 更亮 */
var(--v2-primary-soft)    /* 32% */
var(--v2-purple)          /* #A855F7 极光紫 */
var(--v2-purple-soft)
var(--v2-purple-glow)
var(--v2-pink)            /* #F472B6 霓虹粉 */
var(--v2-pink-soft)

/* === 状态 === */
var(--v2-amber)           /* #FFB800 灯光琥珀 */
var(--v2-success)         /* #00E78A 霓虹绿 */
var(--v2-warning)
var(--v2-danger)          /* #FF4757 鲜红 */
var(--v2-info)            /* #5B8FFF 信息蓝 */
var(--v2-{amber,success,warning,danger,info}-soft)

/* === Glow text-shadow 池 === */
var(--v2-text-glow-primary)
var(--v2-text-glow-amber)
var(--v2-text-glow-purple)
var(--v2-text-glow-success)
var(--v2-text-glow-danger)
var(--v2-text-glow-pink)

/* === 间距 === */
var(--v2-sp-1)  /* 4 */
var(--v2-sp-2)  /* 8 */
var(--v2-sp-3)  /* 12 */
var(--v2-sp-4)  /* 16 */
var(--v2-sp-5)  /* 24 */
var(--v2-sp-6)  /* 32 */

/* === 圆角 === */
var(--v2-r-sm)  /* 8 */
var(--v2-r-md)  /* 12 */
var(--v2-r-lg)  /* 16 */
var(--v2-r-xl)  /* 22 */

/* === 阴影 === */
var(--v2-elev-1)  /* 一档浮起 */
var(--v2-elev-2)  /* 二档浮起 */
var(--v2-elev-3)  /* 三档 — dialog */
var(--v2-glow-primary)
var(--v2-glow-primary-strong)

/* === 字号 === */
var(--v2-fs-xs)         /* 11 */
var(--v2-fs-sm)         /* 13 */
var(--v2-fs-base)       /* 14 */
var(--v2-fs-md)         /* 16 */
var(--v2-fs-lg)         /* 20 */
var(--v2-fs-xl)         /* 26 */
var(--v2-fs-display)    /* 36 */
```

---

## 维护

文件位置: `docs/DESIGN_SYSTEM.md` (这份)
对应代码: `frontend/src/styles/{design-tokens.css, theme.css}`
对应 memory: `feedback_visual_v3_aurora.md`

色彩 / 间距 / 模式如有调整, 同步更新这三个地方.

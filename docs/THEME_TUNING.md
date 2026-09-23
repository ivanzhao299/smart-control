# 主题调参速查（Theme Tuning）

> 日常配色 / 边缘 / 文字微调，**只改本文件列出的变量值**即可，不必每次重新审计。
> 单一真相文件：`frontend/src/styles/design-tokens.css`
> - 深色值在开头的 `:root { … }`
> - 浅色值在 `:root:root[data-theme='light'] { … }`
>
> **怎么改**：dev 运行时直接改变量，Vite HMR 秒级生效、**无需本地构建**；满意后一次提交、走门禁部署（构建由 CI 完成）。
> 完整设计语言见 [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md)；本文件只解决"快速改值"。

---

## 1. 浅色 · 页面与表面底色

| 变量 | 当前值 | 作用 |
|---|---|---|
| `--v2-bg-0` | `#e9eef4` | 页面最底（冷灰） |
| `--v2-bg-1` | `#e6ecf2` | 背景层次 |
| `--v2-bg-2` | `#e2e9f1` | 背景层次 |
| `--v2-surf-1` | `#ffffff` | 卡片主面 |
| `--v2-surf-1-hover` | `#f6f9fc` | 卡片悬停 |
| `--v2-surf-2` | `#f1f5f9` | 次级面 / 标签底 / 表头 |
| `--v2-surf-3` | `#ffffff` | 弹层（dialog/drawer） |

## 2. 浅色 · 卡片描边与阴影（边缘锐利度）

| 项 | 当前值 | 作用 / 调整 |
|---|---|---|
| `--v2-border-soft` | `#c7d2de` | 常规描边（对白对比 1.50）；边缘发虚就加深，如 `#b6c3d2` |
| `--v2-border-strong` | `#9aa8b8` | 强调描边 / 悬停（对白 2.21） |
| 卡片浅色阴影 | `0 1px 2px rgba(20,32,51,.07), 0 2px 10px rgba(20,32,51,.06)` | 卡片浮不起→把 `.07/.06` 调大（如 `.10/.08`）；太硬→减小 |

阴影作用于：`.v2-kpi / .ch-card / .metric / .v2-card / .v2-subsystems / .v2-overview / .circuit-card:not(.on)`。
通电卡 `.circuit-card.on` 用青绿辉光，已用 `:not(.on)` 排除，勿覆盖。

## 3. 浅色 · 文字（对白底对比度）

| 变量 | 当前值 | 对比度 / 等级 | 用途 |
|---|---|---|---|
| `--v2-text-1` | `#142033` | 16.1 : 1 · AAA | 主文字、数字 |
| `--v2-text-2` | `#425063` | 8.2 : 1 · AAA | 次要文字、标签 |
| `--v2-text-3` | `#5b6878` | 5.5 : 1 · AA | 占位、弱化 |

文字发淡就把 `text-2/3` 往 `#142033` 方向加深。浅色已用 `subpixel-antialiased` 让笔画更实，勿改回 `antialiased`。

## 4. 浅色 · 标签 chip（改 token 即全局生效）

| chip 状态 | 背景 | 描边 | 文字（默认字重 700） |
|---|---|---|---|
| 默认（含 audio-seq） | `surf-2` | `border-strong` | `text-1` |
| `muted` / `off`（断电、CH x） | `surf-2` | `border-strong` | `text-2` |
| `on`（通电）/ `audio` | `success-soft` | `success` | `success` |
| `lighting` | `warning-soft` | `warning` | `warning` |
| `socket` / `hvac` / `led` | `primary-soft` | `primary` | `primary-dark` |
| `misc` | `surf-2` | `border-strong` | `text-2` |

## 5. 浅色 · 主色 / 状态色 / 层级叠底

| 变量 | 当前值 | 对白对比 / 用途 |
|---|---|---|
| `--v2-primary` | `#2563eb` | 5.56 : 1 · AA，按钮 / 链接 |
| `--v2-primary-dark` | `#1d4ed8` | 按下、深色标签字 |
| `--v2-primary-soft` | `rgba(37,99,235,.10)` | 选中 / 标签底 |
| `--v2-on-primary` | `#ffffff` | 主按钮文字 |
| `--v2-success` | `#0f7a52` | 4.93 : 1（大字 / 图标 AA） |
| `--v2-warning` | `#9a5500` | 5.94 : 1 · AA |
| `--v2-danger` | `#b83227` | 5.19 : 1（大字 AA） |
| `--v2-success-soft / warning-soft / danger-soft` | `.10 / .11 / .10` | 对应状态的淡底 |
| `--v2-ov-1` | `rgba(20,32,51,.06)` | 最淡叠底（标签 / 表格条纹） |
| `--v2-ov-2` | `rgba(20,32,51,.10)` | 中等叠底 |
| `--v2-ov-3` | `rgba(20,32,51,.15)` | 较强叠底 / 骨架光 |

标签或条纹与白卡分不开 → 把 `ov-1` 往上调（`.07/.08`）。

## 6. 症状 → 改哪个值

| 看到的现象 | 改这里 |
|---|---|
| 浅色卡片边缘发虚 | 加深 `border-soft`；仍虚就加大卡片阴影 alpha |
| 标签灰成一团 | 加深 `ov-1`；chip 默认底是 `surf-2`，若被页面 scoped 覆盖需移除 scoped 重复定义 |
| 文字淡、不够实 | 加深 `text-2/3`；保持 `subpixel-antialiased` |
| 卡片浮不起来 | 调大阴影 alpha / 模糊 |
| 彩色标签在浅色下刺眼或看不清 | 按第 4 表用 `*-soft 底 + 深色字`，不要用深色主题的亮字 |
| 通电卡失去青绿辉光 | 阴影规则应 `:not(.on)`，检查是否误盖 |

## 7. 红线

- 对比度：正文 ≥ 4.5 : 1，大字（≥24px 或 ≥18.66px 粗体）/ 图标 ≥ 3 : 1（WCAG AA）。当前浅色文字均达 AAA。
- 修浅色只动 `[data-theme='light']` 块；深色 `:root` 不动。
- 颜色 / 描边 / 阴影统一在 `design-tokens.css`，不要在各页面 scoped 里另写一套。
- 改完用 HMR 即时核对即可，不必全量审计；只有新增"组件模式"时才去更新 `DESIGN_SYSTEM.md`。

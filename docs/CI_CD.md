# CI / CD 指南

> 仓库：`ivanzhao299/smart-control`
> 目标：push 到 `main` → GitHub Actions 自动部署到 https://cnjinhu.top/control/

## 流程总览

```
┌──────────────┐  push/PR   ┌─────────┐
│  本地 commit  │ ─────────► │   CI    │  typecheck + build (前后端)
└──────────────┘            └─────────┘
                                   │ push main 且 CI 通过
                                   ▼
                            ┌─────────────┐
                            │   Deploy    │  runner build → SSH → cnjinhu.top
                            └─────────────┘
                                   │
                                   ▼
                            ┌─────────────┐
                            │ Health 校验  │  失败自动回滚
                            └─────────────┘
```

| 触发 | Workflow | 行为 |
| --- | --- | --- |
| push 任意分支 / PR → main | [ci.yml](../.github/workflows/ci.yml) | typecheck + build (前后端) |
| push main | [deploy.yml](../.github/workflows/deploy.yml) | 构建 + 部署 + health check + 失败回滚 |
| GitHub UI "Run workflow" | deploy.yml (dispatch) | 重新部署任意 ref / 一键回滚 |

---

## 首次配置 (一次性)

### 1. 生成专用 deploy SSH key

在**本机**执行（不要上传现有 `~/.ssh/id_ed25519`，那是你的个人 key）：

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy@smart-control" \
  -f ~/.ssh/smart_control_deploy -N ""
```

得到两个文件：
- `~/.ssh/smart_control_deploy`        ← 私钥 (要进 GitHub Secret)
- `~/.ssh/smart_control_deploy.pub`    ← 公钥 (要进服务器)

### 2. 把公钥放到服务器

```bash
# 公钥追加到 root 的 authorized_keys
cat ~/.ssh/smart_control_deploy.pub | \
  ssh -o BindInterface=en0 root@47.236.122.224 \
  'cat >> ~/.ssh/authorized_keys'
```

验证（从本机用新 key 连一下）：

```bash
ssh -o BindInterface=en0 -i ~/.ssh/smart_control_deploy root@47.236.122.224 'echo OK'
# 期望: OK
```

### 3. 配置 GitHub Secrets

打开仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，按下表加 2 个 secret：

| Secret 名 | 值 | 备注 |
| --- | --- | --- |
| `DEPLOY_SSH_KEY` | `~/.ssh/smart_control_deploy` 全部内容（含 `-----BEGIN OPENSSH PRIVATE KEY-----` 到 `-----END OPENSSH PRIVATE KEY-----`） | 私钥, 不要漏首尾换行 |
| `DEPLOY_HOST` | `47.236.122.224` | cnjinhu.top 的 ECS 公网 IP |

复制私钥到剪贴板：

```bash
cat ~/.ssh/smart_control_deploy | pbcopy        # macOS
```

### 4. 配置 Production Environment（强烈推荐）

打开仓库 → **Settings** → **Environments** → **New environment** → 名字填 `production`：

- 勾选 **Required reviewers** → 把自己加进去 → 之后每次部署需要在 GitHub UI 点 "Approve and Deploy"，避免误推到生产
- 也可以加 **Deployment branches** 限制为 `main`

不配也能跑（workflow 里的 `environment: production` 会自动创建匿名环境）。

### 5. 测试一次

最简单的方式：什么都不改，直接 `git commit --allow-empty -m "test ci/cd" && git push`。

- GitHub Actions 页面应该看到 CI + Deploy 两个 workflow
- Deploy 跑完后访问 https://cnjinhu.top/control/api/system/info 看 `commit` 字段是否变了

---

## 日常使用

### 部署新版本

```bash
git add -p && git commit -m "feat: ..."
git push origin main
# → Actions 自动跑 CI → Deploy
# → 5 分钟左右生产更新
```

### 手动重新部署 (不改代码)

GitHub → Actions → **Deploy** → **Run workflow** → 默认参数 → 点击运行。
适用于：

- `.env` 改了想让进程重新读
- 想强制 `pm2 reload`
- 上一次部署被自动回滚后想再试一次

### 一键回滚

GitHub → Actions → **Deploy** → **Run workflow** → `rollback` 设为 `true` → 运行。

服务器端会找到 `current` 之前的最近一个 release，切软链 + `pm2 reload`。不需要重新构建。

### 部署旧版本

GitHub → Actions → **Deploy** → **Run workflow** → `ref` 填 commit hash 或 tag 名 → 运行。

---

## 故障排查

### CI 红了

GitHub Actions 页面看具体 job 的 log。常见：
- typecheck 不过 → 本地 `pnpm --filter ./frontend run typecheck` 复现
- backend build 不过 → 本地 `cd backend && npm run build` 复现

### Deploy 红了

看 **Health check** 这一步的 log：

- `apiStatus != up` → 自动回滚已触发，生产不受影响
- `scp` 拒绝 → 检查 `DEPLOY_SSH_KEY` 是不是完整复制，公钥是不是真的在服务器 `authorized_keys` 里
- `ssh-keyscan` 失败 → 服务器 firewall 改了？登 ECS 后台看安全组

### 看具体的部署历史

```bash
ssh -o BindInterface=en0 root@47.236.122.224 'ls -lat /srv/app/smart-control/releases/'
```

最新一行 = 当前 release。`current` 软链指向其中一个。

### 紧急直连旁路（CI 挂时）

如果 GitHub Actions 不可用，仍然可以用本地直推（旧流程，memory 里 `server_cnjinhu_top.md` 记录的）：

```bash
cd ~/projects/smart-control/frontend && pnpm run build
tar czf /tmp/control-dist.tgz -C frontend/dist .
scp -o BindInterface=en0 /tmp/control-dist.tgz root@47.236.122.224:/tmp/
ssh -o BindInterface=en0 root@47.236.122.224 '
  rm -rf /tmp/stage && mkdir /tmp/stage
  tar xzf /tmp/control-dist.tgz -C /tmp/stage
  /srv/www/cnjinhu.top/bin/release.sh control /tmp/stage
'
```

---

## 安全注意

- `DEPLOY_SSH_KEY` 是 root 私钥，泄露 = 服务器沦陷。GitHub Secret 是加密存储 + 仅在 workflow 运行时注入，但仍避免：
  - 把 secret 直接 echo 到 log
  - 在 fork 出来的 PR 上跑 deploy workflow（GitHub 默认 fork 拿不到 secret）
- 想再加一层保险：在服务器 `~/.ssh/authorized_keys` 给这个公钥加 `from="<github runner IP range>"` 限制，但 GitHub runner IP 段经常变，不太实用。**更好的方案**是把 root 换成 deploy 专用用户（未来 Sprint 可做）。
- `version.json` 里现在带 commit hash，可以从 `/api/system/info` 看到。这是有意为之，便于运维知道线上跑的是哪个 commit。

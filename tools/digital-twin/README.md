# 园区数字孪生资产工作流

Mac 本地完成接收、纹理优化、FBX/GLB 转换、压缩、实体映射及相机验收。MAX 导出需要另外接入兼容的 Windows 工作节点；参见 [WINDOWS-WORKER.md](WINDOWS-WORKER.md) 和 [云端配置及费用准备单](CLOUD-PLAN.md)。这不是完整数字孪生系统，也没有连接生产设备。

## 安装与运行

```sh
cd tools/digital-twin
bash setup-macos.sh
python3 twin.py doctor
python3 twin.py intake --model '/path/模型归档.max' --textures '/path/贴图.zip' --job '/path/new-job'
python3 twin.py pack-worker --job '/path/new-job' --output '/path/worker-package.zip'
python3 twin.py smoke --job '/path/new-job'
python3 twin.py serve --job '/path/new-job'
```

安装锁定 Blender 4.5.9 LTS Apple Silicon、其附带 Python 3.11 的独立 venv、Pillow、glTF Transform、Three.js 与浏览器测试依赖。默认安装至 `~/.local/share/smart-control-twin`，不改动系统 Python/Applications。`TWIN_HOME` 可以指定其它路径。

下载镜像可通过 `TWIN_BLENDER_MIRROR=https://mirrors.aliyun.com/blender/release` 指定，仍强制匹配 Blender 官方 SHA-256。首次开发者生成 lock 后，安装使用 `npm ci`。工作台只监听 `127.0.0.1:5199`，不用后台管理员会话；它是独立本地资产工具，不是生产校准器。

当前输入包的 ZIP 文件名可能有 UTF-8 标记缺失；接收工具会恢复中文名，并按清单中的完整相对路径匹配。拒绝路径穿越、符号链接、重名、超大解包和缺失贴图。原件和优化副本分开存储，每次写入新任务目录。纹理最长边默认 2048，保留宽高比；这些是待材质复核的工作副本。

## 真模型导出后

```sh
python3 twin.py convert --input '/path/max-export/scene.fbx' --output '/path/new-model-revision' --source-id jinhu-park
```

支持 FBX、GLB、glTF。源文件不覆盖。输出 `scene-source.glb`、Meshopt 压缩的 `scene.glb`、`twin-manifest.json`、`validation.json`。默认不减面；只有明确需要时用 `--ratio 0.5` 等参数生成另一版本，逐栋检查建筑边缘和立面。

`smoke` 生成的是带背面标记的合成测试几何，网页有明确标识，绝不能当作真实园区。真实 GLB 可用网页文件选择按钮打开；现阶段预览映射通过 JSON 下载保存，没有服务端写接口。

## 数字孪生约定

- glTF 米制、Y 轴向上；源坐标和坐标变换要保留，需用已知尺寸验收。真实世界地理定位和高程还未标定。
- 每个可管理对象保持 `extras.twinId`，不得因合批丢失楼栋选择能力。实体与业务对象另存 JSON。
- 分区是一期、二期、远期；名称、楼栋号、企业数组、设备 ID 数组独立于几何。
- FBX 导出使用源 handle 生成稳定 ID；普通 GLB 缺失 ID 时由导入节点名生成，重命名/模型重建必须复核映射。
- 实时数据当前 `disconnected`、只读。未来接入 API/WebSocket 时需要数据来源、时间戳、离线/过期状态，不能将模拟值当作真实设备值。
- 后续服务端持久化要接现有管理员权限、版本管理、审核发布和回滚，不以本地 JSON 替代权限控制。

## 性能及验收

初始模型门槛：自包含 GLB ≤20 MiB、渲染三角面 ≤30万、图元实例/绘制批次 ≤200，Khronos 验证器零错误，twinId 唯一且与实体映射一致。尺寸/贴图只是第一层门槛，不等于生产 GPU 内存与温度验收。

Three.js 预览使用按需渲染、DPR≤1、无阴影贴图、无自动旋转、无后处理；切换模型释放几何、材质和纹理。相机预置改变相机，不变换模型。真实园区在部署前还要验收正面/背面/尺度/材质、可选择楼栋、长期运行时内存与实际生产机温度。

```sh
"$HOME/.local/share/smart-control-twin/runtime/py311/bin/python" -m unittest test_intake.py
npm test
TWIN_EVIDENCE='/path/browser-evidence' npm run test:browser
```

浏览器测试使用本机 Google Chrome，独立临时测试上下文。验证相机转到另一侧、模型变换不变、文字空格、不持续渲染、下载映射和原始 MAX 不可通过 HTTP 访问。实际园区相机验收状态默认均为 false。

## 本地数据及发布

模型、贴图、模型处理日志、截图、Windows 转换包全部放在本地任务目录，不进入 Git。仓库只保存工具、说明和锁文件。本地环境准备不会触发生产发布。

停止工作台：在启动它的终端按 Ctrl+C。重开时运行 `twin.py serve`，所有资产仍保存在原任务目录。此工具不安装开机常驻任务。

# 园区数字孪生资产工作流

Mac 本地完成接收、MAX 开源解析、纹理优化、GLB 转换、压缩、实体映射及相机验收。**当前默认不使用云主机、Windows 或 3ds Max 授权**。采用 [nrgsille76/io_scene_max](https://github.com/nrgsille76/io_scene_max)，锁定提交 `37db107126f956f7219152671443080360565691`，另加本仓库的压缩流兼容层。这不是完整数字孪生系统，也没有连接生产设备。

注意纠正旧结论：Blender 官方未原生支持 MAX，不代表不存在第三方解析器。此解析器是逆向兼容路线，不保证所有 MAX 版本、修改器、材质或插件对象无损还原。Windows 工作节点文档仅作未启用的旧备选，不是当前前置条件。

## 安装与运行

```sh
cd tools/digital-twin
bash setup-macos.sh
bash setup-max-local.sh
python3 twin.py doctor
python3 twin.py intake --model '/path/模型归档.max' --textures '/path/贴图.zip' --job '/path/new-job'
python3 twin.py import-max --job '/path/new-job' --output '/path/new-max-extraction'
python3 twin.py max-preview --input '/path/new-max-extraction/imported.blend' --output '/path/new-web-preview'
python3 twin.py smoke --job '/path/new-job'
python3 twin.py serve --job '/path/new-job'
```

要在工作台显示真实园区按钮对应的模型，以 `TWIN_REAL_PREVIEW=/path/new-web-preview python3 twin.py serve --job /path/new-job` 启动。流程测试模型与真实几何版是两个独立入口，不能混淆。

## 2026-09-10 当前版：主体近景满幅

入口仍为 `http://127.0.0.1:5199/screen/index.html?twin=1`，刷新即可。当前资产修订 `jinhu-camera-20260910-v2-filled`，下节 v1 为历史记录。

`render_filled_views.py` 加载既有景观副本，以 1,116 个主体细节网格的投影边界重新构图，移动真实相机、调整镜头与传感器偏移居中。俯视相机改用横向构图。保留原 MAX 与旧相机副本；不旋转、缩放、挪动或复制源建筑。主体选择排除大型地面、外围体块和植被；它是可复查的展示取景范围，不是地理边界或楼栋清单认证。

原参考画框裁切外的空场补建连续地面和外围示意林地（13,476 个共享树实例，仅离线渲染使用），不新增建筑。输出 3000×2400 带外围余量的母画面，网页根据每一视角 `subjectBounds` 计算等比例缩放，裁去外围余量，使主体尽量占满实际展示区。普通屏和 LED 使用同一套资产，不需要常驻 3D 或尺寸切换时重复请求图片。

新版 15 张 WebP 总计 **6,744,172 字节**；最大 **694,334 字节**，默认另一侧日景 **666,640 字节**。分辨率提高是为近景裁切后的清晰度，单张解码约 28.8 MB RGBA，不等同于文件下载体积；网页仍仅保留当前显示逻辑和临时加载对象，不预载整包。实际浏览器缓存与生产机温度需实机验证。

```sh
# 在新目录渲染日景、夜景、白模和相同相机下的标注坐标；--preview 可仅生成半分辨率日景。
blender --background --threads 4 --python render_filled_views.py -- \
  --input /path/landscape.blend --cameras /path/review.json \
  --fit /path/reference-camera-fit.json --landscape /path/landscape.json --output /path/new-filled-render
python package_display_views.py --input /path/new-filled-render --output /path/new-filled-web
TWIN_EVIDENCE=/path/new-framing-evidence node test-filled-framing.mjs
TWIN_EVIDENCE=/path/new-editor-evidence node test-twin-screen.mjs
node --test test-display-assets.mjs
```

已检查 1920×1080、3612×1462、1366×768 × 五视角，共 15 种组合：背景覆盖展示区；所选主体边界未裁切；保持原始图片比例；限制放大的一轴占约 93%。这不是主体面积覆盖 93%，也不意味任何极端长宽比均能无留白且保留完整主体。日夜景、白模、标注交互和失败重试也已验证。

新相机标注使用独立修订存储，旧 v1 草稿原样保留。有旧稿时编辑器显示“下载旧视角标注备份”，不会把旧像素坐标静默套用到新图上。原 `/compare.html` 保留旧同视角参照；当前“原鸟瞰视角”按钮保留观察方向但已重新近景构图，不再是像素等效对照。未发布生产。

## 2026-09-10 v1：多视角低功耗大屏本地候选（历史）

用户已认可原鸟瞰视角对应关系。新入口为 `http://127.0.0.1:5199/screen/index.html?twin=1`，独立模型检查为 `/screen/twin-view/index.html`。默认展示真实相机位于另一侧的视图，模型未旋转或镜像；另有原鸟瞰、侧向 A、侧向 B、俯视及五组白模。旧 `/compare.html` 保留为已认可的历史参照，不冒充最新绿化版。

处理链（每步输出至新的本地任务目录，不覆盖源件）：

1. `inspect_max_scene.py` 读取原 MAX 参数，`prepare_review_scene.py` 根据源 Extrude capStart/capEnd 修复 45 个恢复对象，移除 9,216 个错误补盖面；显示背景底板下移 2 个未标定源单位，使湖面/草地/道路可见。其它对象变换保持不变。这是派生展示修复，不是测绘高程修订。
2. `render_multiview_review.py` 离线输出五个真实相机白模；显式替换材质槽，避免 EEVEE 忽略 material_override。渲染前后几何指纹相同。人工视觉检查未发现主体建筑的大面积破损或翻面；仍有 47 个源线类节点未恢复，不能认定完整 MAX 插件效果、工程尺寸和全部细节已经无损验收。
3. `build_landscape_scene.py` 在草地射线校验后补建 3,593 棵共享网格树，其中园内 1,196 棵。绿化为参考图启发的示意重建，不是原树逐株恢复，也不是现场调查。建筑原几何不变。
4. `render_display_views.py` 离线生成五视角日/夜照明，`package_display_views.py` 编码 WebP 并保存逐文件 SHA-256、尺寸和字节预算。15 张图合计 1,764,356 字节，最大 237,932 字节；默认另一侧日景 172,774 字节。网页只加载所选视角，不下载完整场景，不使用 WebGL 或持续渲染。
5. `frontend/public/park-ops/twin-view/` 提供视角、白模、日夜景及本机标注编辑。标注支持增删、拖动、文字、字号、颜色、撤销和 JSON 导入导出；按视角分别保存，不继承旧鸟瞰图坐标。不虚构官方楼栋号、企业或分期边界；现有四条预置仅是几何参照名。该入口不是旧生产分区端点校准器。

`?twin=1` 是本地候选开关，未带此参数的既有大屏与旧校准器保持不变。候选显式标明业务数据为 DEMO、设备未接入；旧 3D 模块、生产布局 API 和管理员会话逻辑不加载。模型标注草稿只写浏览器本地存储，支持下载备份。关闭编辑后可投屏查看；未进行生产部署、输入源登记或生产草稿覆盖。

这是**真实 3D 模型离线渲染的多视角网页展示**，不是网页自由环绕的实时 3D 模型。它满足固定多视角低负载投屏，完整三维资产继续留在本地用于后续数字孪生。整体页面自适应实际视口且无横纵不等比缩放；中间图片保持原比例，超宽屏允许两侧留出空间，不以拉伸或裁掉建筑换取铺满。

验证：

```sh
npm test
node --test test-display-assets.mjs
TWIN_EVIDENCE=/path/new-browser-evidence node test-twin-screen.mjs
```

覆盖五视角、白模/日夜、文本空格、标注 CRUD/拖动/撤销/JSON、失败保留画面及重试、加载竞态、1920×1080 与 3612×1462、移动端无横溢出。空闲测试没有换图、WebGL 创建或外部请求；这不是生产硬件长期温度/内存验收。生产门槛仍为 `productionEligible: false`，必须先获得用户本地视觉验收，再单独进行发布同步、生产输入源及实机验证。

## 鸟瞰图同视角对照（此前验收步骤）

先对齐参考图，未通过前不继续反向相机或生产替换。`/compare.html` 为静态图像对照页，支持并排、同尺寸透明叠加、单看原图/模型；不加载 GLB、不启动 WebGL。主页有可点击入口。

1. `render_reference_match.py` 用 Blender 对完整导入几何离线渲染，不使用 AI 图像、图片变形或模型翻转。
2. `fit_reference_camera.py` 通过首张几何图中人工选定的屋顶参照点、源几何射线交点、参考图对应像素拟合透视相机。目前选点和初始相机专用于本次园区，是人工近似校准，不是通用自动识图工具，也不是测绘配准。拟合误差只说明这些选点的内部一致性。
3. `render_reference_match.py --fit /path/fit.json --textured --clean-frustum --save-scene` 在新目录产生 `matched.png`、`comparison.blend` 和详细裁切记录。相机画框外的几何仅从新副本裁掉，跨框对象保留框内部分，不覆盖原始 MAX 或完整导入模型。1280×884 保持参考图宽高比。画框范围不是园区地理边界。
4. `validate_reference_scene.py --scene /path/comparison.blend --fit /path/fit.json --output /path/scene-validation.json` 检查真实 Blender 相机投影、分辨率及裁切后顶点范围。完整性与上线状态仍为未通过。
5. `node package-reference-review.mjs /path/render /path/reference.jpg /path/fit.json` 生成仅供本地展示的记录。新增 `TWIN_COMPARISON=/path/render` 启动工作台。服务仅公开两张图片和脱敏摘要，不公开 `.blend`、原始 MAX 或包含源路径的详细记录。
6. `TWIN_EVIDENCE=/path/browser-check node test-reference-browser.mjs` 验证对照、叠加比例、移动端溢出、无 WebGL/GLB 下载和源文件隔离。

该历史对照版本中植被缺失、湖面不可见、地面/道路材质异常；新候选的修复和剩余限制见上节。不得以相机拟合成功或 HTTP 200 认定完整还原，更不能把离线高精度 `.blend` 直接投放到生产端。

## MAX 本地解析与实际限制

`import-max` 输出 `imported.blend` 和 `import-report.json`，记录成功创建、跳过的源节点、异常、贴图请求、缺失贴图、面数和包围盒。禁止执行源文件脚本；原件不覆盖，不上传到第三方。适配层解决本次文件的 `_Compressed` 流名、Zstandard 压缩、新场景头包装，以及贴图 Windows 路径定位。每条解压流限制 1 GiB；大型输入仍可能占用数 GiB 内存，只在资产准备 Mac 上离线运行，不能在生产播放端运行。

本次真实输入首次成功提取 1,522 个网格、11,798,436 个三角面；179 个源节点被跳过，主要为线类。只有部分原始材质被恢复，不能声称完整效果图。实际计数以各次 `import-report.json` 为准。

`max-preview` 产生的是**真实 MAX 几何的简化白模验证版**，主动不用残缺材质冒充完整贴图。细小构件先按源单位聚类，再减面，外观与细节会损失；完整提取版保留在另一目录。默认门槛仍是 20 MiB / 30 万面 / 200 批次，任何失败都不发布。

≤200 面的简单组件不减面，避免把背景建筑减成破碎三角片。主体取景使用密集构件的坐标分位数，仅是相机建议，不是已校准的园区或分期边界；“全场景”可恢复完整范围。导入报告的成功不是几何完整性验收。

为避免 1,522 个构件变成同样数量的绘制调用，验证版合批后用 `_ENTITY_ID` 顶点属性保存源构件选择关系。Meshopt 重排时属性随顶点一起走，不能用会失效的三角面序号区间映射。这些 ID 是同一源文件修订内的组件标识，不是已标定楼栋号；跨 MAX 重新导出必须复核。地理位置、尺度、分期、楼栋与企业关联均未自动认定。

开源导入器保存在用户本地 runtime/vendor，不捆绑进生产网页。上游仓库 LICENSE 与扩展 manifest 的 GPL 版本声明存在差异，重新分发前须核对并保留适用许可；当前只固定引用上游仓库，不内嵌其源代码。

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
"$HOME/.local/share/smart-control-twin/runtime/py311/bin/python" -m unittest test_intake.py test_max_streams.py
npm test
TWIN_EVIDENCE='/path/browser-evidence' npm run test:browser
TWIN_EVIDENCE='/path/real-browser-evidence' node test-real-browser.mjs
```

浏览器测试使用本机 Google Chrome，独立临时测试上下文。验证相机转到另一侧、模型变换不变、文字空格、不持续渲染、下载映射和原始 MAX 不可通过 HTTP 访问。实际园区相机验收状态默认均为 false。

## 本地数据及发布

原始模型、贴图、模型处理日志、诊断截图、Windows 转换包全部放在本地任务目录，不进入 Git。仓库保存工具、说明、锁文件及专门为网页生成的约 1.76 MB 发布候选 WebP 视角包和脱敏清单；不包含 MAX/BLEND 或完整纹理。本地环境准备不会触发生产发布。

停止工作台：在启动它的终端按 Ctrl+C。重开时运行 `twin.py serve`，所有资产仍保存在原任务目录。此工具不安装开机常驻任务。

## 网页运行时加载链路（真机验证经验，勿再踩）

真实模型发布为压缩 GLB（Draco + JPEG），由 `frontend/public/park-ops/3d-twin/model/` 验证页加载。复制 three addons 时必须连同依赖一起放，否则 module 链接失败、整页停在“加载中”且渲染循环不启动：

1. **GLTFLoader 依赖 utils**：three r180 的 `loaders/GLTFLoader.js` 有 `import { toTrianglesDrawMode } from '../utils/BufferGeometryUtils.js'`。只复制 loaders 会报 `Failed to fetch dynamically imported module`。必须把 `examples/jsm/utils/BufferGeometryUtils.js` 放到 model 页的 `utils/`（该文件仅 import 'three'，依赖闭合）。
2. **DRACOLoader 路径要直接含 decoder 文件**：r180 的 `_loadLibrary` 直接在 `decoderPath` 下找 `draco_decoder.wasm` / `draco_wasm_wrapper.js`，**不再自动加 `gltf/` 子目录**。`setDecoderPath('../../vendor/draco/gltf/')`（结尾带 `gltf/`），decoder 文件放 `park-ops/vendor/draco/gltf/`。
3. 验证页 importmap 需同时声明 `three`、`gltf-loader`、`draco-loader`；addons 内部裸 import 'three' 由 importmap 解析。
4. 玻璃/铝板/水面的 Standard 材质需要环境反射：用程序化 equirect 渐变 DataTexture 经 `PMREMGenerator.fromEquirectangular` 设 `scene.environment`，无需额外 HDR 文件。

本地（Mac mini, ANGLE Metal）真机基线：GLB 4.21 MB、加载（下载+Draco解码+构建）约 169 ms、draw calls 38、约 36.8 万三角形、fps 120。GK9000 核显为最终性能口径，需真机实测后再决定是否继续减面。

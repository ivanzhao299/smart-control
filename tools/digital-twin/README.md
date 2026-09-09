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

## 鸟瞰图同视角对照（当前验收步骤）

先对齐参考图，未通过前不继续反向相机或生产替换。`/compare.html` 为静态图像对照页，支持并排、同尺寸透明叠加、单看原图/模型；不加载 GLB、不启动 WebGL。主页有可点击入口。

1. `render_reference_match.py` 用 Blender 对完整导入几何离线渲染，不使用 AI 图像、图片变形或模型翻转。
2. `fit_reference_camera.py` 通过首张几何图中人工选定的屋顶参照点、源几何射线交点、参考图对应像素拟合透视相机。目前选点和初始相机专用于本次园区，是人工近似校准，不是通用自动识图工具，也不是测绘配准。拟合误差只说明这些选点的内部一致性。
3. `render_reference_match.py --fit /path/fit.json --textured --clean-frustum --save-scene` 在新目录产生 `matched.png`、`comparison.blend` 和详细裁切记录。相机画框外的几何仅从新副本裁掉，跨框对象保留框内部分，不覆盖原始 MAX 或完整导入模型。1280×884 保持参考图宽高比。画框范围不是园区地理边界。
4. `validate_reference_scene.py --scene /path/comparison.blend --fit /path/fit.json --output /path/scene-validation.json` 检查真实 Blender 相机投影、分辨率及裁切后顶点范围。完整性与上线状态仍为未通过。
5. `node package-reference-review.mjs /path/render /path/reference.jpg /path/fit.json` 生成仅供本地展示的记录。新增 `TWIN_COMPARISON=/path/render` 启动工作台。服务仅公开两张图片和脱敏摘要，不公开 `.blend`、原始 MAX 或包含源路径的详细记录。
6. `TWIN_EVIDENCE=/path/browser-check node test-reference-browser.mjs` 验证对照、叠加比例、移动端溢出、无 WebGL/GLB 下载和源文件隔离。

当前恢复后的模型与原图主体排布可对应，但植被缺失、湖面不可见、地面/道路材质异常和建筑细节仍是验收阻断项。不得以相机拟合成功或 HTTP 200 认定完整还原，更不能把离线高精度 `.blend` 直接投放到生产端。

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

模型、贴图、模型处理日志、截图、Windows 转换包全部放在本地任务目录，不进入 Git。仓库只保存工具、说明和锁文件。本地环境准备不会触发生产发布。

停止工作台：在启动它的终端按 Ctrl+C。重开时运行 `twin.py serve`，所有资产仍保存在原任务目录。此工具不安装开机常驻任务。

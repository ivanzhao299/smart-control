# Windows MAX 转换节点

此节点是离线资产处理工作站，与园区生产播放电脑分开。当前仅完成脚本准备；尚未有 Windows 节点运行验收。

## 环境

- Windows 11 x64，Intel/AMD CPU。建议起步 8 核、32 GB 内存、100 GB 可用磁盘；这是本项目的初始配置建议，须根据真实场景调整。
- 3ds Max 2024 或已验证兼容的后续版本，完成 Autodesk 安装和激活。
- 与 Max 版本对应的 V-Ray；本模型保存记录是 V-Ray 6 Update 1.1。首次先由有授权的安装环境验证兼容性。
- 批量导出不需要 UE5，不做高开销渲染。交互材质烘焙/检查时再决定显卡配置。
- 使用任务副本，保留原 MAX。模型加载使用软件的安全脚本执行设置，不为来源场景关闭安全检查。

不必购买一台实体电脑：可用有合法软件许可的 Windows x64 云工作站。实际创建需要云账号、软件授权和费用上限。不能把仅安装了 MAX 插件或 ARM 虚拟机当作已验证的导出环境。

## 操作

将本地生成的 worker-package.zip 解压到一个新的任务目录，例如 `C:\TwinJobs\jinhu-001`。包中包括 `worker-input\scene.max`、25 张优化贴图和下面的脚本。

```powershell
powershell -NoProfile -File .\windows-export.ps1 -Job C:\TwinJobs\jinhu-001 -InspectOnly
powershell -NoProfile -File .\windows-export.ps1 -Job C:\TwinJobs\jinhu-001 -SourceId jinhu-park
```

InspectOnly 检查 x64、文件及插件存在性，不能证明授权有效。第二条命令实际运行 3ds Max Batch。必要时用 `-MaxExe` 指定真实安装路径。一次仅执行一个任务。取回整个 `max-export` 目录，包括 FBX、报告和日志。

## 验收与限制

- 缺失贴图、代理树木、Forest/RailClone 等程序化物体会使导出停止，需要在 Max 中烘焙或转为几何后重试。
- 普通 VRayMtl 目前只转换 diffuse 颜色/位图。玻璃、反射、法线、透明、发光均需视觉复核或离线烘焙。不能宣称无损。
- 稳定 ID 基于源场景对象 handle 与 sourceId；删除重建对象后要复核映射。不得把所有楼栋合并成不可选择的单一物体。
- 输出原始模型坐标；FBX 单位由 Blender 导入器转换。最终 GLB 约定米、Y 轴向上，必须按已知建筑尺寸检查比例。
- `export-report.json` 与 Batch 日志共同检查缺失插件警告；有警告时不要将结果发布为真实园区完成版。
- 此脚本在 Mac 只做语法检查，尚未运行在 Max；第一次有工作节点时，先用小场景验证 FBX 自定义属性、材质和日志，再转换本项目。

## Autodesk 云自动化备选

Autodesk APS Automation 支持 3ds Max 引擎，可在没有本地 Windows 的情况下执行作业。但需要 Autodesk 开发者应用、可用额度，以及确认目标引擎和 V-Ray/第三方插件支持；不能假定云引擎自带当前 V-Ray。当前未创建应用、上传模型、申请收费资源或提交作业。

官方依据：

- [3ds Max Batch 调用方式](https://help.autodesk.com/cloudhelp/2024/ENU/3DSMax-Batch/files/GUID-48A78515-C24B-4E46-AC5F-884FBCF40D59.htm)
- [Autodesk Automation APIs](https://aps.autodesk.com/automation-apis)
- [Autodesk APS 计费与开发者中心要求](https://aps.autodesk.com/blog/aps-business-model-evolution)
- [3ds Max 在 Apple 虚拟化环境中的支持说明](https://help.autodesk.com/view/fusion360/ENU/?caas=caas%2Fsfdcarticles%2Fsfdcarticles%2FApple-Boot-Camp-Support-for-Autodesk-3ds-Max.html)

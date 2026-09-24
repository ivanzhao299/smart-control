# ePa 4G 智能断路器接入运行手册

## 目标架构

```text
户外路灯 / 水泵断路器
        │ 4G 公网
        ▼
    MQTT Broker
      ▲       ▲
      │       └── 设备：上行 from/epa/{gatewayId}
      │                  下行 to/epa/{gatewayId}
      └── 中控后端：订阅上行、发送控制、回复心跳
```

4G 设备与 LED 大屏的本地 485 总线完全分开。前端仍使用统一的“电源回路”页面，后端根据硬件类别选择驱动：

- `power-breaker`：本地 485/Modbus，经有人 RTU-TCP 转换器。
- `power-breaker-4g`：公网 MQTT/JSON，使用 `gatewayId + clientId` 精确寻址。

## 已实现的协议

- 订阅设备上行：`from/epa/+`，QoS 0。
- 平台下行：`to/epa/{gatewayId}`，QoS 0。
- 分合闸：`bid=202`，`MoterOperation=1/2`。
- 读取单台设备：`bid=208`。
- 心跳：收到 `bid=101` 后立即回复 `{"bid":101}`。
- 以 `mid` 关联请求和回复，超时或实际开关状态不符时向前端明确报错。
- 主动上报数据缓存；缓存过期后主动读取，电压、电流、电量、温度和报警统一换算到系统单位。
- 同一网关下可以登记多台 `ClientID`；控制按单台发送，避开协议“每包最多 3 台”的限制。

## Broker 上线条件

生产 Broker 必须具备公网域名或固定公网 IP，并满足：

1. 禁止匿名连接，使用独立强密码；中控账号与设备账号分离。
2. ACL 限制设备只能发布自己的 `from/epa/{gatewayId}`、订阅自己的 `to/epa/{gatewayId}`；中控账号只允许反向权限。
3. 开启持久化日志、连接数限制、失败登录限速和监控告警。
4. 如果设备固件支持 TLS，使用 `mqtts://`；不支持时使用专用端口和严格 ACL，不与其它业务共享账号。
5. Broker 时间使用 NTP 校准，公网防火墙只开放实际 MQTT 端口。

协议明确支持把设备切换到自建 MQTT 服务器，分两种模式：

- 模式一只修改服务器 IP/端口，用户名、密码、订阅和发布主题沿用设备默认值。
- 模式二可同时修改服务器 IP/端口、用户名、密码、订阅和发布主题六项。

所以 Broker 地址和端口由我们提供；模式二的账号密码也由我们创建，不需要厂家提供。文档没有披露模式一的默认用户名和密码，因此不能假定为空或直接开放匿名连接。协议同时明确提示服务器切换需厂家技术人员协助，配置错误可能导致设备失联且无法自行重置。

设备到场前需向厂家确认以下资料：

- 每台设备的固定 `gatewayId` 和子设备 `ClientID`。
- 固件支持的 MQTT 地址格式、端口、认证方式及是否支持 TLS。
- 采用“六项全部修改”的模式，把我们创建的 Broker 地址、账号、密码和既定主题写入设备；并确定厂家远程协助窗口。
- 设备当前是否绑定厂家云；切换后如何恢复。

在自建 Broker 完成、设备参数写入并取得真实编号前，生产环境保持 `EPA_MQTT_ENABLED=false`。代码和数据库配置可以提前部署，不会影响现有 LED 大屏总闸。

## 后端配置

在 GK9000 的 `backend/.env` 中填写，密钥不得提交到 Git：

```dotenv
EPA_MQTT_ENABLED=true
EPA_MQTT_URL=mqtts://mqtt.example.com:8883
EPA_MQTT_CLIENT_ID=smart-control-gk9000
EPA_MQTT_USERNAME=smart-control
EPA_MQTT_PASSWORD=替换为独立强密码
EPA_MQTT_COMMAND_TIMEOUT_MS=5000
EPA_MQTT_STALE_MS=600000
```

修改后使用 `pm2 reload smart-control-backend --update-env` 重新载入环境变量。

## 设备和回路登记

在“后台 → 硬件清单”新增一条：

```json
{
  "code": "BREAKER-4G-LIGHT-01",
  "name": "园区东侧路灯",
  "category": "power-breaker-4g",
  "driverKind": "epa-breaker-mqtt",
  "serialNo": "设备铭牌 SN",
  "addressing": "{\"gatewayId\":\"GW00000001\",\"clientId\":\"EP000001\"}",
  "enabled": true
}
```

然后在“后台 → 分区配置 → 电源回路”新增业务回路，控制设备选择上面的硬件编号。智能断路器无需通道号。

同一 `gatewayId + clientId` 不得重复；驱动会在下发前拒绝重复配置，避免误控其它回路。

## 到货验收顺序

1. 设备先接测试负载，不直接接水泵或整组路灯。
2. 检查 Broker 在线连接、两分钟心跳和主动上报是否持续正常。
3. 在后台读取状态和计量，不下发控制，核对 `gatewayId/ClientID` 与现场标签。
4. 单路执行合闸、分闸，确认系统显示与物理触点一致。
5. 断开网络验证“控制失败”会明确提示，不会显示虚假成功。
6. 恢复网络并验证自动重连，然后才接入正式负载。
7. 水泵回路还应由电气设计配置接触器、过载、缺相、干转和液位联锁；中控只发送启停意图，不能替代硬件保护链。

## 故障定位

- 显示 `EPA_MQTT_ENABLED 未启用`：生产开关未打开。
- 显示 `EPA_MQTT_URL 未配置`：Broker 地址缺失。
- 显示等待回复超时：检查设备在线、topic ACL、`gatewayId/ClientID` 和移动网络。
- 显示实际状态与目标不符：设备回复正常但物理闸未到位，检查机械机构、锁定状态和保护告警。
- 设备反复离线：优先检查平台是否在每次 `bid=101` 后及时回复，以及 Broker 是否出现相同 clientId 互踢。

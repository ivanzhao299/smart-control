"""
视频AI分析服务 - 车辆行人检测跟踪与越线计数
基于YOLOv8 + ByteTrack，支持RTSP流输入，FastAPI提供数据接口

2026-09-15 增量（不改动拉子码流 / 模型 / 跟踪 / 不做转码）：
  1) CameraConfig 增加 roi_polygon（检测区域多边形，归一化顶点，区域外目标不计数、不输出）；
  2) 启动读取同目录 camera-ai-config.json 覆盖内置默认线/区域，AI 重启不丢配置；
  3) 新增 POST /api/config（仅允许本机 127.0.0.1 调用，由后端同源反代+管理员鉴权转发），
     内存热更新计数线/ROI/启用状态，分析线程下一帧即生效，无需重启 AI；并原子写回 json；
  4) GET /api/config 回读当前配置；detections 额外回传 roi_polygon 供前端叠加。
"""
import os
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", "1")
import cv2
cv2.setNumThreads(1)
import numpy as np
from ultralytics import YOLO
import torch
torch.set_num_threads(2)
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
import threading
import time
import json
from urllib.parse import quote
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Optional

def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Required environment variable is missing: {name}")
    return value

NVR_PORT5_USER = os.getenv("NVR_PORT5_USERNAME", "admin")
NVR_PORT3_USER = os.getenv("NVR_PORT3_USERNAME", "admin")
NVR_PORT5_PASSWORD = quote(required_env("NVR_PORT5_PASSWORD"), safe="")
NVR_PORT3_PASSWORD = quote(required_env("NVR_PORT3_PASSWORD"), safe="")

# ==================== 配置 ====================
@dataclass
class CameraConfig:
    name: str
    rtsp_url: str
    # 虚拟计数线：两个点定义一条线，(x1,y1) -> (x2,y2)，坐标为0-1的比例
    count_line: Tuple[Tuple[float, float], Tuple[float, float]] = ((0.5, 0.3), (0.5, 0.7))
    # 检测类别：0=person, 1=bicycle, 2=car, 3=motorcycle, 5=bus, 7=truck
    detect_classes: List[int] = field(default_factory=lambda: [0, 1, 2, 3, 5, 7])
    enabled: bool = True
    # 检测区域多边形 ROI：归一化顶点 [(x,y),...]；None/空=全画面检测，>=3 点时区域外不计数、不输出
    roi_polygon: Optional[List[Tuple[float, float]]] = None

# 摄像头配置（3个大门口，使用子码流，分辨率640x360，节约资源）
CAMERAS: Dict[str, CameraConfig] = {
    "d37": CameraConfig(
        name="北大门",
        rtsp_url=f"rtsp://{NVR_PORT5_USER}:{NVR_PORT5_PASSWORD}@192.168.1.5:554/Streaming/Channels/3702",
        count_line=((0.5, 0.2), (0.5, 0.8)),  # 中间竖线
        enabled=True,
    ),
    "d57": CameraConfig(
        name="西大门",
        rtsp_url=f"rtsp://{NVR_PORT5_USER}:{NVR_PORT5_PASSWORD}@192.168.1.5:554/Streaming/Channels/5702",
        count_line=((0.5, 0.2), (0.5, 0.8)),
        enabled=True,
    ),
    "p3-d37": CameraConfig(
        name="东大门",
        rtsp_url=f"rtsp://{NVR_PORT3_USER}:{NVR_PORT3_PASSWORD}@192.168.1.19:554/Streaming/Channels/3702",
        count_line=((0.5, 0.2), (0.5, 0.8)),
        enabled=True,
    ),
}

# 持久化的检测范围配置（与脚本同目录）。后端下发后写这里，AI 重启自动恢复。
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "camera-ai-config.json")


def _as_line(v):
    """把 [[x,y],[x,y]] 安全转成两点 tuple；非法返回 None。"""
    try:
        if not v or len(v) != 2:
            return None
        return ((float(v[0][0]), float(v[0][1])), (float(v[1][0]), float(v[1][1])))
    except Exception:
        return None


def _as_polygon(v):
    """把 [[x,y],...] 转成顶点 tuple 列表；不足 3 点返回 None（即全画面）。"""
    try:
        if not v or len(v) < 3:
            return None
        pts = [(float(p[0]), float(p[1])) for p in v]
        return pts if len(pts) >= 3 else None
    except Exception:
        return None


def apply_camera_config(cam_id: str, cfg: dict) -> bool:
    """把一份 {enabled,count_line,roi_polygon} 热应用到内存 CAMERAS（分析线程下一帧生效）。"""
    cam = CAMERAS.get(cam_id)
    if not cam or not isinstance(cfg, dict):
        return False
    if "enabled" in cfg:
        cam.enabled = bool(cfg["enabled"])
    line = _as_line(cfg.get("count_line"))
    if line:
        cam.count_line = line
    # 空列表/None 显式表示清空 ROI（全画面）
    if "roi_polygon" in cfg:
        cam.roi_polygon = _as_polygon(cfg.get("roi_polygon"))
    return True


def load_config_file():
    """启动时从 CONFIG_FILE 恢复后台配置的线/区域（文件不存在则沿用内置默认）。"""
    if not os.path.exists(CONFIG_FILE):
        return
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        cams = data.get("cameras", {}) if isinstance(data, dict) else {}
        n = 0
        for cid, c in cams.items():
            if apply_camera_config(cid, c):
                n += 1
        print(f"[config] 已从 {os.path.basename(CONFIG_FILE)} 载入 {n} 路 AI 检测配置")
    except Exception as e:
        print(f"[config] 载入失败，沿用内置默认: {e}")


def save_config_file():
    """把当前内存里的线/区域/启用状态原子写回 CONFIG_FILE。"""
    data = {"updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"), "cameras": {}}
    for cid, cam in CAMERAS.items():
        data["cameras"][cid] = {
            "enabled": cam.enabled,
            "count_line": [[cam.count_line[0][0], cam.count_line[0][1]],
                           [cam.count_line[1][0], cam.count_line[1][1]]],
            "roi_polygon": [[p[0], p[1]] for p in (cam.roi_polygon or [])],
        }
    tmp = CONFIG_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CONFIG_FILE)


# 模型配置
MODEL_PATH = "yolov8n.pt"  # 轻量化模型，约6MB
CONF_THRESHOLD = 0.3  # 置信度阈值
IOU_THRESHOLD = 0.5  # NMS IOU阈值
FRAME_SKIP = 8  # 每N帧检测一次（降低CPU占用；门岗慢速目标约3FPS足够，2026-09-14调优）

# ==================== 计数统计 ====================
@dataclass
class CountStats:
    person_in: int = 0
    person_out: int = 0
    car_in: int = 0
    car_out: int = 0
    truck_in: int = 0
    truck_out: int = 0
    bus_in: int = 0
    bus_out: int = 0
    motorcycle_in: int = 0
    motorcycle_out: int = 0
    bicycle_in: int = 0
    bicycle_out: int = 0
    last_update: float = 0.0

    @property
    def vehicle_in(self):
        return self.car_in + self.truck_in + self.bus_in + self.motorcycle_in + self.bicycle_in

    @property
    def vehicle_out(self):
        return self.car_out + self.truck_out + self.bus_out + self.motorcycle_out + self.bicycle_out

    def to_dict(self):
        return {
            "person_in": self.person_in,
            "person_out": self.person_out,
            "car_in": self.car_in,
            "car_out": self.car_out,
            "truck_in": self.truck_in,
            "truck_out": self.truck_out,
            "bus_in": self.bus_in,
            "bus_out": self.bus_out,
            "motorcycle_in": self.motorcycle_in,
            "motorcycle_out": self.motorcycle_out,
            "bicycle_in": self.bicycle_in,
            "bicycle_out": self.bicycle_out,
            "vehicle_in": self.vehicle_in,
            "vehicle_out": self.vehicle_out,
            "person_total": self.person_in + self.person_out,
            "vehicle_total": self.vehicle_in + self.vehicle_out,
            "last_update": self.last_update,
        }

# 全局统计
global_stats: Dict[str, CountStats] = {cam_id: CountStats() for cam_id in CAMERAS}

# 跟踪状态：track_id -> 上一帧中心点位置
track_positions: Dict[str, Dict[int, Tuple[float, float]]] = defaultdict(dict)

# 全局共享YOLO模型（只加载一次，所有线程共用，加锁保证线程安全）
shared_model = None
model_lock = threading.Lock()

# ==================== 工具函数 ====================
def line_crossing_direction(
    prev_point: Tuple[float, float],
    curr_point: Tuple[float, float],
    line_p1: Tuple[float, float],
    line_p2: Tuple[float, float]
) -> Optional[str]:
    """
    判断点是否穿越了线段，返回方向 "in" 或 "out"
    使用叉积判断点在线的哪一侧
    """
    def cross_sign(p, l1, l2):
        return (l2[0] - l1[0]) * (p[1] - l1[1]) - (l2[1] - l1[1]) * (p[0] - l1[0])
    
    prev_side = cross_sign(prev_point, line_p1, line_p2)
    curr_side = cross_sign(curr_point, line_p1, line_p2)
    
    if prev_side * curr_side < 0:  # 穿越了线
        # 假设从左到右为in，从右到左为out（根据实际场景调整）
        if prev_side < 0 and curr_side > 0:
            return "in"
        else:
            return "out"
    return None


def point_in_polygon(px: float, py: float, polygon) -> bool:
    """
    射线法判断归一化点(px,py)是否在归一化多边形内。
    polygon 为空时返回 True（=全画面检测）。
    """
    if not polygon:
        return True
    inside = False
    n = len(polygon)
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if (yi > py) != (yj > py):
            denom = (yj - yi) if (yj - yi) != 0 else 1e-9
            if px < (xj - xi) * (py - yi) / denom + xi:
                inside = not inside
        j = i
    return inside


def is_person(cls_id: int) -> bool:
    return cls_id == 0

def is_vehicle(cls_id: int) -> bool:
    return cls_id in [2, 3, 5, 7]

# ==================== 视频分析线程 ====================
class VideoAnalysisThread(threading.Thread):
    def __init__(self, cam_id: str, config: CameraConfig):
        super().__init__(daemon=True)
        self.cam_id = cam_id
        self.config = config
        self.running = True
        self.frame_count = 0
        self.fps = 0
        self.last_fps_time = time.time()
        self.fps_frame_count = 0
        self.latest_detections = []  # 最新检测结果：[{x1,y1,x2,y2,class,conf,track_id}]
        self.frame_width = 640
        self.frame_height = 360
        
    def run(self):
        global shared_model
        print(f"[{self.cam_id}] 启动视频分析线程: {self.config.name}")
        
        # 等待共享模型加载完成
        while shared_model is None:
            time.sleep(0.5)
        print(f"[{self.cam_id}] 使用共享YOLO模型")
        
        # 打开视频流
        cap = cv2.VideoCapture(self.config.rtsp_url)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # 最小缓冲，降低延迟
        
        if not cap.isOpened():
            print(f"[{self.cam_id}] 无法打开视频流: {self.config.rtsp_url}")
            return
        
        print(f"[{self.cam_id}] 视频流已连接，开始分析...")
        
        try:
            proc_interval = 1.0 / 3.0   # analyze ~3 fps per camera
            last_proc_t = 0.0
            while self.running:
                now_t = time.time()
                if now_t - last_proc_t < proc_interval:
                    cap.grab()  # drain buffered frame without decoding (cheap)
                    time.sleep(0.004)
                    continue
                last_proc_t = now_t

                # 该路被后台禁用：只排空缓冲、不推理，清空残留检测框；重新启用后自动恢复
                if not self.config.enabled:
                    cap.grab()
                    self.latest_detections = []
                    time.sleep(0.01)
                    continue

                ret, frame = cap.read()
                if not ret:
                    print(f"[{self.cam_id}] 读取帧失败，尝试重连...")
                    time.sleep(1)
                    cap = cv2.VideoCapture(self.config.rtsp_url)
                    continue
                
                self.frame_count += 1
                self.fps_frame_count += 1
                
                # FPS统计
                now = time.time()
                if now - self.last_fps_time >= 5:
                    self.fps = self.fps_frame_count / (now - self.last_fps_time)
                    self.fps_frame_count = 0
                    self.last_fps_time = now
                    print(f"[{self.cam_id}] FPS: {self.fps:.1f}, 总帧数: {self.frame_count}")
                
                # 跳帧检测（降低CPU占用）
                # frame pacing is time-based (grab/retrieve) above; infer this frame
                
                # 子码流已是640x360，直接用于检测，无需resize
                frame_small = frame
                
                # YOLO检测+跟踪（使用共享模型，加锁保证线程安全）
                with model_lock:
                    results = shared_model.track(
                        frame_small,
                        persist=True,
                        imgsz=320,
                        classes=self.config.detect_classes,
                        conf=CONF_THRESHOLD,
                        iou=IOU_THRESHOLD,
                        verbose=False
                    )
                
                # 检测日志（每30帧打印一次）
                if self.frame_count % 30 == 0:
                    num_detected = len(results[0].boxes) if results[0].boxes is not None else 0
                    num_tracked = len(results[0].boxes.id) if results[0].boxes is not None and results[0].boxes.id is not None else 0
                    print(f"[{self.cam_id}] 帧{self.frame_count}: 检测到{num_detected}个物体, 跟踪{num_tracked}个")
                
                if results[0].boxes is not None and results[0].boxes.id is not None:
                    boxes = results[0].boxes.xyxy.cpu().numpy()
                    track_ids = results[0].boxes.id.cpu().numpy().astype(int)
                    class_ids = results[0].boxes.cls.cpu().numpy().astype(int)
                    confs = results[0].boxes.conf.cpu().numpy()
                    
                    h, w = frame_small.shape[:2]
                    self.frame_width = w
                    self.frame_height = h
                    # 计数线每帧从（可能被热更新的）config 读取
                    line_p1 = (self.config.count_line[0][0] * w, self.config.count_line[0][1] * h)
                    line_p2 = (self.config.count_line[1][0] * w, self.config.count_line[1][1] * h)
                    roi = self.config.roi_polygon  # 归一化多边形，整体引用，热替换原子
                    
                    # 保存最新检测结果（比例坐标，前端可缩放）
                    detections = []
                    class_names = {0: 'person', 1: 'bicycle', 2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck'}
                    
                    for box, track_id, cls_id, conf in zip(boxes, track_ids, class_ids, confs):
                        # 计算中心点
                        center_x = (box[0] + box[2]) / 2
                        center_y = (box[1] + box[3]) / 2
                        curr_point = (center_x, center_y)

                        # ROI 区域过滤：用中心点（归一化）判断是否在检测区域内
                        in_roi = point_in_polygon(center_x / w, center_y / h, roi)

                        # 获取上一帧位置
                        prev_point = track_positions[self.cam_id].get(track_id)
                        
                        # 仅区域内目标参与越线计数
                        if in_roi and prev_point is not None:
                            # 判断是否越线
                            direction = line_crossing_direction(prev_point, curr_point, line_p1, line_p2)
                            if direction:
                                stats = global_stats[self.cam_id]
                                cls_int = int(cls_id)
                                if is_person(cls_int):
                                    if direction == "in":
                                        stats.person_in += 1
                                    else:
                                        stats.person_out += 1
                                elif cls_int == 2:  # car 轿车
                                    if direction == "in":
                                        stats.car_in += 1
                                    else:
                                        stats.car_out += 1
                                elif cls_int == 7:  # truck 货车
                                    if direction == "in":
                                        stats.truck_in += 1
                                    else:
                                        stats.truck_out += 1
                                elif cls_int == 5:  # bus 客车
                                    if direction == "in":
                                        stats.bus_in += 1
                                    else:
                                        stats.bus_out += 1
                                elif cls_int == 3:  # motorcycle 摩托车/电动车
                                    if direction == "in":
                                        stats.motorcycle_in += 1
                                    else:
                                        stats.motorcycle_out += 1
                                elif cls_int == 1:  # bicycle 自行车
                                    if direction == "in":
                                        stats.bicycle_in += 1
                                    else:
                                        stats.bicycle_out += 1
                                stats.last_update = time.time()
                                print(f"[{self.cam_id}] 越线检测: track_id={track_id}, class={cls_int}, direction={direction}")
                        
                        # 跟踪位置始终更新（含区域外），避免目标跨出再回来时用陈旧位置误判越线
                        track_positions[self.cam_id][track_id] = curr_point
                        
                        # 区域外目标不输出给前端叠加
                        if not in_roi:
                            continue

                        # 保存检测结果（比例坐标0-1）
                        detections.append({
                            'x1': round(float(box[0]) / w, 4),
                            'y1': round(float(box[1]) / h, 4),
                            'x2': round(float(box[2]) / w, 4),
                            'y2': round(float(box[3]) / h, 4),
                            'class': class_names.get(int(cls_id), f'cls_{cls_id}'),
                            'class_id': int(cls_id),
                            'conf': round(float(conf), 3),
                            'track_id': int(track_id)
                        })
                    
                    self.latest_detections = detections
                
                # 清理过期的track_id（保留最近100个）
                if len(track_positions[self.cam_id]) > 200:
                    # 简单清理：保留最近的100个
                    items = list(track_positions[self.cam_id].items())
                    track_positions[self.cam_id] = dict(items[-100:])
        
        except Exception as e:
            print(f"[{self.cam_id}] 线程异常: {e}")
            import traceback
            traceback.print_exc()
            print(f"[{self.cam_id}] 5秒后尝试重启线程...")
            time.sleep(5)
            # 重启线程
            self.running = True
            self.run()
        finally:
            cap.release()
            print(f"[{self.cam_id}] 视频分析线程已停止")

# ==================== FastAPI服务 ====================
app = FastAPI(title="视频AI分析服务", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/stats")
async def get_stats():
    """获取所有摄像头的计数统计"""
    result = {}
    total_person_in = total_person_out = total_vehicle_in = total_vehicle_out = 0
    
    for cam_id, stats in global_stats.items():
        result[cam_id] = {
            "name": CAMERAS[cam_id].name,
            **stats.to_dict()
        }
        total_person_in += stats.person_in
        total_person_out += stats.person_out
        total_vehicle_in += stats.vehicle_in
        total_vehicle_out += stats.vehicle_out
    
    result["total"] = {
        "person_in": total_person_in,
        "person_out": total_person_out,
        "vehicle_in": total_vehicle_in,
        "vehicle_out": total_vehicle_out,
        "person_total": total_person_in + total_person_out,
        "vehicle_total": total_vehicle_in + total_vehicle_out,
        "current_persons": max(0, total_person_in - total_person_out),
        "current_vehicles": max(0, total_vehicle_in - total_vehicle_out),
    }
    return result

@app.get("/api/stats/{cam_id}")
async def get_camera_stats(cam_id: str):
    """获取指定摄像头的计数统计"""
    if cam_id not in global_stats:
        return {"error": f"Camera {cam_id} not found"}
    return {
        "name": CAMERAS[cam_id].name,
        **global_stats[cam_id].to_dict()
    }

@app.post("/api/reset/{cam_id}")
async def reset_stats(cam_id: str):
    """重置指定摄像头的计数"""
    if cam_id in global_stats:
        global_stats[cam_id] = CountStats()
        return {"status": "success", "message": f"Reset {cam_id} stats"}
    return {"error": f"Camera {cam_id} not found"}

@app.post("/api/reset/all")
async def reset_all_stats():
    """重置所有摄像头的计数"""
    for cam_id in global_stats:
        global_stats[cam_id] = CountStats()
    return {"status": "success", "message": "Reset all stats"}

@app.get("/api/health")
async def health():
    """健康检查"""
    return {
        "status": "ok",
        "cameras": {cam_id: {"name": cfg.name, "enabled": cfg.enabled} for cam_id, cfg in CAMERAS.items()},
        "model": MODEL_PATH,
    }

def _camera_config_payload(cam_id: str):
    cam = CAMERAS[cam_id]
    return {
        "enabled": cam.enabled,
        "count_line": [[cam.count_line[0][0], cam.count_line[0][1]],
                       [cam.count_line[1][0], cam.count_line[1][1]]],
        "roi_polygon": [[p[0], p[1]] for p in (cam.roi_polygon or [])],
    }

@app.get("/api/config")
async def get_config():
    """回读当前每路启用状态/计数线/ROI（供后台核对）。"""
    return {"cameras": {cid: _camera_config_payload(cid) for cid in CAMERAS}}

@app.post("/api/config")
async def set_config(request: Request):
    """
    热更新检测范围（内存下帧生效 + 原子持久化）。
    安全：只接受本机回环调用（由 GK 本机后端同源反代 + 管理员登录鉴权转发），拒绝外部直连。
    body: {"cameras": {"d37": {"enabled": true, "count_line": [[x,y],[x,y]], "roi_polygon": [[x,y],...]}}}
    """
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost"):
        return JSONResponse(status_code=403, content={"error": "config_write_local_only", "host": host})
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "bad_json"})
    cams = body.get("cameras", {}) if isinstance(body, dict) else {}
    changed = []
    for cid, c in cams.items():
        if apply_camera_config(cid, c):
            changed.append(cid)
    if not changed:
        return JSONResponse(status_code=404, content={"error": "no_matching_camera"})
    try:
        save_config_file()
    except Exception as e:
        return {"status": "applied_not_saved", "changed": changed, "error": str(e)}
    return {"status": "ok", "changed": changed}

@app.get("/api/detections")
async def get_detections():
    """获取所有摄像头的最新检测框（用于前端可视化叠加）"""
    result = {}
    for cam_id, thread in analysis_threads.items():
        result[cam_id] = {
            "name": CAMERAS[cam_id].name,
            "detections": thread.latest_detections,
            "frame_width": thread.frame_width,
            "frame_height": thread.frame_height,
            "fps": round(thread.fps, 1),
            "count_line": [
                {"x": CAMERAS[cam_id].count_line[0][0], "y": CAMERAS[cam_id].count_line[0][1]},
                {"x": CAMERAS[cam_id].count_line[1][0], "y": CAMERAS[cam_id].count_line[1][1]}
            ],
            "roi_polygon": [
                {"x": p[0], "y": p[1]} for p in (CAMERAS[cam_id].roi_polygon or [])
            ]
        }
    return result

@app.get("/api/detections/{cam_id}")
async def get_camera_detections(cam_id: str):
    """获取指定摄像头的最新检测框"""
    if cam_id not in analysis_threads:
        return {"error": f"Camera {cam_id} not found"}
    thread = analysis_threads[cam_id]
    return {
        "name": CAMERAS[cam_id].name,
        "detections": thread.latest_detections,
        "frame_width": thread.frame_width,
        "frame_height": thread.frame_height,
        "fps": round(thread.fps, 1),
        "count_line": [
            {"x": CAMERAS[cam_id].count_line[0][0], "y": CAMERAS[cam_id].count_line[0][1]},
            {"x": CAMERAS[cam_id].count_line[1][0], "y": CAMERAS[cam_id].count_line[1][1]}
        ],
        "roi_polygon": [
            {"x": p[0], "y": p[1]} for p in (CAMERAS[cam_id].roi_polygon or [])
        ]
    }

# ==================== 主函数 ====================
analysis_threads = {}  # 全局分析线程引用，供API访问

def main():
    global shared_model, analysis_threads
    
    # 先加载一次共享YOLO模型（所有线程共用）
    print("正在加载共享YOLO模型...")
    try:
        shared_model = YOLO(MODEL_PATH)
        print(f"共享模型加载成功: {MODEL_PATH}")
    except Exception as e:
        print(f"共享模型加载失败: {e}")
        return

    # 恢复后台持久化的计数线 / ROI（覆盖内置默认），必须在起分析线程前
    load_config_file()
    
    # 启动所有视频分析线程
    for cam_id, config in CAMERAS.items():
        if config.enabled:
            t = VideoAnalysisThread(cam_id, config)
            t.start()
            analysis_threads[cam_id] = t
            time.sleep(0.5)  # 错开启动，避免同时连接RTSP
    
    # 启动FastAPI服务
    print("\n" + "="*50)
    print("视频AI分析服务已启动")
    print("API地址: http://0.0.0.0:8000")
    print("统计接口: http://0.0.0.0:8000/api/stats")
    print("检测框接口: http://0.0.0.0:8000/api/detections")
    print("检测范围配置: http://127.0.0.1:8000/api/config (GET/POST, POST仅本机)")
    print("健康检查: http://0.0.0.0:8000/api/health")
    print("="*50 + "\n")
    
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")

if __name__ == "__main__":
    main()

"""
视频AI分析服务 - 车辆行人检测跟踪与越线计数
基于YOLOv8 + ByteTrack，支持RTSP流输入，FastAPI提供数据接口
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
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
                    line_p1 = (self.config.count_line[0][0] * w, self.config.count_line[0][1] * h)
                    line_p2 = (self.config.count_line[1][0] * w, self.config.count_line[1][1] * h)
                    
                    # 保存最新检测结果（比例坐标，前端可缩放）
                    detections = []
                    class_names = {0: 'person', 1: 'bicycle', 2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck'}
                    
                    for box, track_id, cls_id, conf in zip(boxes, track_ids, class_ids, confs):
                        # 计算中心点
                        center_x = (box[0] + box[2]) / 2
                        center_y = (box[1] + box[3]) / 2
                        curr_point = (center_x, center_y)
                        
                        # 获取上一帧位置
                        prev_point = track_positions[self.cam_id].get(track_id)
                        
                        if prev_point is not None:
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
                        
                        # 更新位置
                        track_positions[self.cam_id][track_id] = curr_point
                        
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
app = FastAPI(title="视频AI分析服务", version="1.0.0")

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
        "fps": round(thread.fps, 1)
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
    print("健康检查: http://0.0.0.0:8000/api/health")
    print("="*50 + "\n")
    
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")

if __name__ == "__main__":
    main()

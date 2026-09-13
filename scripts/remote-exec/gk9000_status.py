#!/usr/bin/env python3
"""GK9000 状态检查脚本 - 通过远程执行工具运行"""
import subprocess
import os
import sqlite3
import datetime

print("=" * 60)
print("GK9000 系统状态检查")
print("=" * 60)

# 1. PM2服务状态
print("\n[1/5] PM2 服务状态:")
try:
    result = subprocess.run(['pm2', 'list'], capture_output=True, text=True, timeout=10)
    print(result.stdout)
except Exception as e:
    print(f"  错误: {e}")

# 2. 数据库状态
print("\n[2/5] 数据库状态:")
db_path = r'D:\smart-control\database\smart-control.db'
if os.path.exists(db_path):
    size = os.path.getsize(db_path)
    mtime = os.path.getmtime(db_path)
    print(f"  路径: {db_path}")
    print(f"  大小: {size/1024/1024:.2f} MB")
    print(f"  修改时间: {datetime.datetime.fromtimestamp(mtime)}")
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM migrations")
        print(f"  迁移数: {cursor.fetchone()[0]}")
        cursor.execute("SELECT COUNT(*) FROM users")
        print(f"  用户数: {cursor.fetchone()[0]}")
        cursor.execute("SELECT COUNT(*) FROM operation_logs")
        print(f"  操作日志: {cursor.fetchone()[0]}")
        conn.close()
    except Exception as e:
        print(f"  数据库查询错误: {e}")
else:
    print(f"  数据库不存在: {db_path}")

# 3. 备份状态
print("\n[3/5] 备份状态:")
backup_dirs = [r'D:\smart-control-backups', r'D:\smart-control\backups']
for bd in backup_dirs:
    if os.path.exists(bd):
        items = sorted(os.listdir(bd), reverse=True)
        print(f"  {bd}: {len(items)} 个备份")
        for item in items[:5]:
            full = os.path.join(bd, item)
            if os.path.isdir(full):
                total_size = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(full) for f in fs)
                mtime = os.path.getmtime(full)
                print(f"    {item} ({total_size/1024/1024:.2f} MB, {datetime.datetime.fromtimestamp(mtime)})")
    else:
        print(f"  {bd}: 不存在")

# 4. 视频流状态
print("\n[4/5] 视频流状态:")
try:
    result = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq ffmpeg.exe'], capture_output=True, text=True, timeout=10)
    lines = result.stdout.strip().split('\n')
    ffmpeg_count = len([l for l in lines if 'ffmpeg.exe' in l])
    print(f"  FFmpeg进程数: {ffmpeg_count}")
except Exception as e:
    print(f"  错误: {e}")

# 5. AI分析服务状态
print("\n[5/5] AI分析服务状态:")
try:
    result = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq python.exe'], capture_output=True, text=True, timeout=10)
    lines = result.stdout.strip().split('\n')
    python_count = len([l for l in lines if 'python.exe' in l])
    print(f"  Python进程数: {python_count}")
except Exception as e:
    print(f"  错误: {e}")

print("\n" + "=" * 60)
print("状态检查完成")
print("=" * 60)

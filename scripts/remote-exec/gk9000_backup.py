#!/usr/bin/env python3
"""GK9000 数据库备份脚本 - 通过远程执行工具运行"""
import subprocess
import os
import datetime

print("=" * 60)
print("GK9000 数据库备份")
print("=" * 60)

backup_script = r'D:\smart-control\scripts\backup.ps1'
backup_dest = r'D:\smart-control-backups'

if not os.path.exists(backup_script):
    print(f"错误: 备份脚本不存在: {backup_script}")
    exit(1)

print(f"\n备份脚本: {backup_script}")
print(f"备份目标: {backup_dest}")
print(f"开始时间: {datetime.datetime.now()}")

try:
    result = subprocess.run(
        ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', backup_script, '-Dest', backup_dest],
        capture_output=True, text=True, timeout=120
    )
    print("\n备份输出:")
    print(result.stdout)
    if result.stderr:
        print("错误输出:")
        print(result.stderr)
    print(f"\n返回码: {result.returncode}")
except Exception as e:
    print(f"备份异常: {e}")

print(f"\n结束时间: {datetime.datetime.now()}")
print("=" * 60)

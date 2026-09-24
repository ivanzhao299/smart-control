# GK9000 远程执行工具

## 问题背景
通过SSH多层嵌套执行PowerShell命令时，引号、特殊字符、&&等会被多层转义，导致命令频繁失败。

## 解决方案
使用 `gk9000_exec.sh` 工具，通过base64编码Python脚本传输，在GK9000上用Python执行，完全避免PowerShell转义问题。

## 用法

### 1. 执行任意Python脚本
```bash
./scripts/remote-exec/gk9000_exec.sh <你的脚本.py> [参数...]
```

### 2. 检查系统状态
```bash
./scripts/remote-exec/gk9000_exec.sh scripts/remote-exec/gk9000_status.py
```

### 3. 执行数据库备份
```bash
./scripts/remote-exec/gk9000_exec.sh scripts/remote-exec/gk9000_backup.py
```

## 编写远程脚本的注意事项

1. **使用Python标准库**：os, sys, subprocess, sqlite3, shutil, datetime等
2. **路径使用原始字符串**：`r'D:\smart-control\database'`
3. **执行外部命令用subprocess**：不要用os.system（有转义问题）
4. **中文输出正常**：Python 3默认UTF-8，中文无问题
5. **特殊字符正常**：& | > < " ' $ ` \ % ! 都可以正常处理

## 禁止事项

1. **禁止直接在SSH命令中嵌套PowerShell命令**
2. **禁止使用 `&&` 连接命令**（PowerShell不支持）
3. **禁止在命令行中直接写复杂的PowerShell脚本**
4. **所有远程操作必须通过本工具执行**

## 常用操作示例

### 检查PM2状态
```python
import subprocess
result = subprocess.run(['pm2', 'list'], capture_output=True, text=True, timeout=10)
print(result.stdout)
```

### 查询数据库
```python
import sqlite3
conn = sqlite3.connect(r'D:\smart-control\database\smart-control.db')
cursor = conn.cursor()
cursor.execute("SELECT COUNT(*) FROM users")
print(cursor.fetchone())
conn.close()
```

### 复制文件
```python
import shutil
shutil.copy2(r'D:\source\file.txt', r'D:\dest\file.txt')
```

### 创建目录
```python
import os
os.makedirs(r'D:\new\directory', exist_ok=True)
```

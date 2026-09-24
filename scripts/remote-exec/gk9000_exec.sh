#!/bin/bash
# GK9000 远程执行工具 - 彻底解决PowerShell转义问题
# 用法: ./gk9000_exec.sh <python脚本文件> [参数...]
# 原理: 用base64编码Python脚本，通过SSH传输，在GK9000上用Python执行
# 完全避免PowerShell引号转义、特殊字符、&&不支持等问题

set -e

JUMP_HOST="root@123.57.220.65"
GK9000_HOST="user@10.66.66.3"
SSH_KEY="$HOME/.ssh/id_ed25519"
GK9000_KEY="/root/.ssh/anksen-gk9000-deploy"
REMOTE_TMP="D:\\smart-control\\tmp"

if [ $# -lt 1 ]; then
    echo "用法: $0 <python脚本文件> [参数...]"
    echo "示例: $0 check_db.py"
    exit 1
fi

SCRIPT_FILE="$1"
shift

if [ ! -f "$SCRIPT_FILE" ]; then
    echo "错误: 脚本文件不存在: $SCRIPT_FILE"
    exit 1
fi

# 1. base64编码脚本
SCRIPT_B64=$(base64 -i "$SCRIPT_FILE")
SCRIPT_NAME=$(basename "$SCRIPT_FILE")
REMOTE_PATH="${REMOTE_TMP}\\${SCRIPT_NAME}"

# 2. 传输并执行（用Python解码，完全避免PowerShell转义）
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$JUMP_HOST" \
    "ssh -i $GK9000_KEY -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 $GK9000_HOST \
        \"python -c \\\"import base64,pathlib,sys; pathlib.Path(r'$REMOTE_PATH').write_bytes(base64.b64decode('$SCRIPT_B64')); print('script transferred')\\\"\""

# 3. 执行脚本
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$JUMP_HOST" \
    "ssh -i $GK9000_KEY -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 $GK9000_HOST \
        \"python $REMOTE_PATH $@\""

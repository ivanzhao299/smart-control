/**
 * PM2 配置 - 展贸中心智能化中控系统
 * 跨平台 (Windows 11 / Linux / macOS)
 *
 * Windows (中控主机 ARK-1220L):
 *   pm2 start deploy/ecosystem.config.js --env production
 *   pm2 save
 *   pm2-startup install      # 装 pm2-windows-startup 后开机自启
 *
 * Linux (云服务器):
 *   pm2 start deploy/ecosystem.config.js --env production
 *   pm2 startup ; pm2 save
 *
 * 通用命令:
 *   pm2 status / pm2 logs smart-control-backend
 *   pm2 reload smart-control-backend --update-env
 *   pm2 stop smart-control-backend
 */
const path = require('path');

// 默认日志目录: 优先 env LOG_DIR (Windows 现场推荐 D:\smart-control\logs)
const defaultLogDir = process.env.LOG_DIR || path.resolve(__dirname, '..', 'logs');

module.exports = {
  apps: [
    {
      name: 'smart-control-backend',
      cwd: path.resolve(__dirname, '..', 'backend'),
      script: 'dist/main.js',
      // Windows 下 PM2 推荐 fork 模式
      instances: 1,
      exec_mode: 'fork',

      // 自愈
      autorestart: true,
      max_restarts: 50,
      min_uptime: '15s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 200,

      // 资源限制
      max_memory_restart: '512M',
      // 显式收紧 Node heap, 让 GC 提前清理而不是涨到 OOM kill
      // 比 max_memory_restart 早触发, 避免硬重启 (PERFORMANCE_AUDIT P2-#17)
      node_args: ['--max-old-space-size=400'],

      // 优雅关闭
      kill_timeout: 8000,
      wait_ready: false,
      listen_timeout: 10000,
      shutdown_with_message: true,

      // 不监控代码改动 (生产环境)
      watch: false,
      ignore_watch: ['node_modules', 'logs', '*.db', 'database'],

      // 环境变量 (优先级低于服务器 .env)
      env: {
        NODE_ENV: 'production',
        PORT: 3200,
      },
      env_production: {
        // 生产用 3200 — frontend bundle 里硬编码了
        // baseURL=http://192.168.77.54:3200/api (.env.local 覆盖 .env.production
        // 的 /control/api), PWA 直连此端口, 不能再用 3000.
        NODE_ENV: 'production',
        PORT: 3200,
        // Windows 现场推荐 (在 backend/.env 中覆盖):
        //   DB_PATH=D:\\smart-control\\database\\smart-control.db
        //   LOG_DIR=D:\\smart-control\\logs
        //   MOCK_MODE=false      (现场接入真实设备后改)
        //   HOST_MACHINE=Advantech ARK-1220L-S6A2
        //   PLATFORM=windows
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
      },

      // 日志分离
      error_file: path.join(defaultLogDir, 'pm2-error.log'),
      out_file: path.join(defaultLogDir, 'pm2-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      time: true,
    },
    // smart-control-frontend — Vite preview 静态服务 (PWA 入口 :5173)
    // 之前是手动 npm run preview 起的孤儿进程, PS 一关就死, 重启不自启 →
    // 现场每次出问题都得 RDC 进去重新跑. 收编到 pm2 后:
    //   - autorestart=true: 崩了 pm2 自动拉
    //   - max_restarts=50 + min_uptime=15s: 防 crash-loop 死循环
    //   - pm2 save + boot.ps1 resurrect: 开机自启
    //   - watcher npm run build 写完新 dist 后, vite preview 静态文件 server
    //     每次请求 fs.read, 自然就吃新文件, 无需重启 vite (零停机更新)
    {
      name: 'smart-control-frontend',
      cwd: path.resolve(__dirname, '..', 'frontend'),
      // 直接调 vite 二进制 (Node script, pm2 fork 模式稳)
      script: path.resolve(__dirname, '..', 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'),
      args: 'preview --host 0.0.0.0 --port 5173 --strictPort',
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      max_restarts: 50,
      min_uptime: '15s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 200,

      max_memory_restart: '400M',

      kill_timeout: 5000,
      wait_ready: false,
      listen_timeout: 8000,

      watch: false,

      env: { NODE_ENV: 'production' },
      env_production: { NODE_ENV: 'production' },

      error_file: path.join(defaultLogDir, 'pm2-frontend-error.log'),
      out_file: path.join(defaultLogDir, 'pm2-frontend-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      time: true,
    },
  ],
};

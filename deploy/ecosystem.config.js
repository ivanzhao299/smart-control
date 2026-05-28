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
        // baseURL=http://192.168.124.11:3200/api (.env.local 覆盖 .env.production
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
  ],
};

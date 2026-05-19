/**
 * PM2 配置 - 展贸中心智能化中控系统 (Sprint-08 完善)
 *
 * 启动:        pm2 start deploy/ecosystem.config.js --env production
 * 查看状态:    pm2 status
 * 查看日志:    pm2 logs smart-control-backend
 * 重启服务:    pm2 reload smart-control-backend --update-env
 * 停止服务:    pm2 stop smart-control-backend
 * 持久化:      pm2 save && pm2 startup    (开机自启)
 *
 * 生产环境推荐: 配合服务器 .env 文件控制 PORT / MOCK_MODE / DB_PATH / LOG_DIR
 */
module.exports = {
  apps: [
    {
      name: 'smart-control-backend',
      cwd: './backend',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',

      // 自愈
      autorestart: true,
      max_restarts: 50,
      min_uptime: '15s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 200,

      // 资源限制 (内存超限自动重启)
      max_memory_restart: '512M',

      // 优雅关闭 (给后端 8s 处理未完成的场景执行)
      kill_timeout: 8000,
      wait_ready: false,
      listen_timeout: 10000,
      shutdown_with_message: true,

      // 不监控代码改动 (生产环境)
      watch: false,
      ignore_watch: ['node_modules', 'logs', '*.db'],

      // 环境变量 (优先级最低, 会被服务器 .env 覆盖)
      env: {
        NODE_ENV: 'production',
        PORT: 3200,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3200,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
      },

      // 日志分离 (out + error)
      error_file: '../logs/pm2-error.log',
      out_file: '../logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      time: true,
    },
  ],
};

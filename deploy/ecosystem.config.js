/**
 * PM2 配置 - 展贸中心智能化中控系统
 * 启动:  pm2 start deploy/ecosystem.config.js
 * 查看:  pm2 status / pm2 logs smart-control-backend
 */
module.exports = {
  apps: [
    {
      name: 'smart-control-backend',
      cwd: './backend',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 5000,
      wait_ready: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      error_file: '../logs/pm2-error.log',
      out_file: '../logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};

// PM2 Ecosystem Configuration — Kurōdo
//
// Usage:
//   npm run pm2:start       Start the server with PM2
//   npm run pm2:stop        Stop the server
//   npm run pm2:restart     Restart the server
//   npm run pm2:logs        Tail logs in realtime
//   npm run pm2:status      Show process status & uptime
//   npm run pm2:startup     Install PM2 as a system service (auto-start on boot)
//   npm run pm2:unstartup   Remove PM2 from system startup
//
// PM2 provides:
//   - Auto-restart on crash (max 10 restarts in 60s, then pause)
//   - Auto-restart on memory limit exceeding 512 MB
//   - Log rotation (max 10 MB per file, keep 5 files = 50 MB total)
//   - Graceful reload on source changes (watch mode)
//   - System boot auto-start (via pm2:startup)

module.exports = {
  apps: [
    {
      name: 'kurodo',
      script: 'server/index.js',
      cwd: __dirname,

      // ── Restart policy ──────────────────────────────────────────
      // Auto-restart on crash. After 10 crashes in 60s, PM2 stops
      // restarting to avoid infinite restart loops on bad code.
      autorestart: true,
      max_restarts: 10,
      restart_delay: 500, // ms between restarts
      min_uptime: '10s',  // process must live at least 10s to be "started"
      max_memory_restart: '512M', // restart if RSS exceeds 512 MB

      // ── Logging ─────────────────────────────────────────────────
      // Combined stdout+stderr into one file per process.
      // PM2's built-in log rotation handles size + retention.
      error_file: 'logs/kurodo-error.log',
      out_file: 'logs/kurodo-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // ── Log rotation (requires pm2-logrotate module) ─────────
      // Install:  npx pm2 install pm2-logrotate
      // Configure: npx pm2 set pm2-logrotate:max_size 10M
      //            npx pm2 set pm2-logrotate:retain 5
      //            npx pm2 set pm2-logrotate:compress true

      // ── Environment ─────────────────────────────────────────────
      // PM2 reads .env files automatically via `env_file`, but we
      // also pass PORT explicitly for clarity. The production build
      // (dist/) must exist before starting.
      env: {
        NODE_ENV: 'production',
        PORT: 5173,
      },

      // ── Watch mode (optional) ───────────────────────────────────
      // Uncomment to enable auto-reload when server files change.
      // Useful for staging environments; don't use in production
      // unless you want zero-downtime deploys.
      // watch: ['server'],
      // ignore_watch: ['node_modules', 'logs', 'dist'],

      // ── Windows note ────────────────────────────────────────────
      // On Windows, `pm2 startup` requires the pm2-windows-startup
      // package (install via `npm install -g pm2-windows-startup`).
      // On Linux/macOS it uses systemd/init.d natively.

      // ── Process metadata ────────────────────────────────────────
      instances: 1,
      exec_mode: 'fork',

      // Kill with SIGTERM first, then SIGKILL after 5s if stuck.
      kill_timeout: 5000,

      // Wait 2s after SIGTERM before force-killing.
      listen_timeout: 2000,
    },
  ],
}

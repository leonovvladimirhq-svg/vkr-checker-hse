module.exports = {
  apps: [{
    name: 'vkr-checker',
    script: 'npm',
    args: 'start',
    cwd: '/root/vkr-checker-hse',
    // Бокс RAM-ограничен (961 МБ). Heap поднят до 2 ГБ, чтобы процесс рос в swap,
    // а не падал с "FATAL ERROR: Reached heap limit". max_memory_restart — backstop
    // от утечки/рантэвея (выше V8-потолка). См. deploy/README.md.
    max_memory_restart: '2600M',
    env: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=2048',
    },
  }],
};

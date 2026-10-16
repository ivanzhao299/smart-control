(function(){
  if (!('serviceWorker' in navigator)) return;
  var pwaReloadKey = 'park-ops.pwa.updatedReload';
  // 刷新后5秒解除锁，下一个版本仍能自动刷新
  setTimeout(function(){ sessionStorage.removeItem(pwaReloadKey); }, 5000);

  // 运营大屏 7x24 无人值守：检测到新版后静默让 waiting SW 接管（SKIP_WAITING），
  // 由 controllerchange 自动 reload，绝不弹等人点的横幅。
  var swUrl = '/control/sw.js';
  var swScope = '/control/';

  // 让已 installed 的新 SW 跳过等待。仅在页面已被旧 SW 控制（controller 非空，
  // 即非首次安装）时触发——首次安装时新 SW 会自然激活，无需也不应干预。
  function promptSkipWaiting(sw){
    if (!sw || !navigator.serviceWorker.controller) return;
    try {
      sw.postMessage({ type: 'SKIP_WAITING' });
    } catch(e) { /* 离线/连接异常时静默，等下次周期更新 */ }
  }

  // 注册Service Worker（运营大屏是独立静态页，vite-plugin-pwa不会自动注入注册代码）
  navigator.serviceWorker.register(swUrl, { scope: swScope })
    .then(function(registration){
      console.log('[ParkOps] Service Worker注册成功:', registration.scope);
      // 注册时若已有 waiting SW（页面加载前新版本就已下载好），立即静默激活。
      promptSkipWaiting(registration.waiting);
      // 新 SW 下载流程：进入 installed 后，若页面已被旧 SW 控制，立即静默激活。
      registration.addEventListener('updatefound', function(){
        var sw = registration.installing;
        if (!sw) return;
        sw.addEventListener('statechange', function(){
          if (sw.state === 'installed') promptSkipWaiting(sw);
        });
      });
    })
    .catch(function(error){
      console.log('[ParkOps] Service Worker注册失败:', error);
    });

  // 监听Service Worker接管变化，新SW激活后自动刷新
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    if (sessionStorage.getItem(pwaReloadKey)) return;
    sessionStorage.setItem(pwaReloadKey, '1');
    console.log('[ParkOps] Service Worker已更新，300ms后自动刷新页面...');
    setTimeout(function(){ window.location.reload(); }, 300);
  });

  // 主动检查Service Worker更新
  function checkForPwaUpdate(){
    navigator.serviceWorker.ready.then(function(registration){
      registration.update();
    }).catch(function(){ /* 离线时静默跳过 */ });
  }

  // 页面加载完成后检查更新
  if (document.readyState === 'complete') {
    checkForPwaUpdate();
  } else {
    window.addEventListener('load', checkForPwaUpdate);
  }
  // 页面从后台回到前台时检查更新
  document.addEventListener('visibilitychange', function(){
    if (document.visibilityState === 'visible') checkForPwaUpdate();
  });
  // 每5分钟定时检查更新（大屏长时间运行场景）
  setInterval(checkForPwaUpdate, 5 * 60 * 1000);

  console.log('[ParkOps] Service Worker注册+自动更新检测已启动');
})();

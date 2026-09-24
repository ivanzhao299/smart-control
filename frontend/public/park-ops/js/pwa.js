(function(){
  if (!('serviceWorker' in navigator)) return;
  var pwaReloadKey = 'park-ops.pwa.updatedReload';
  // 刷新后5秒解除锁，下一个版本仍能自动刷新
  setTimeout(function(){ sessionStorage.removeItem(pwaReloadKey); }, 5000);
  
  // 注册Service Worker（运营大屏是独立静态页，vite-plugin-pwa不会自动注入注册代码）
  var swUrl = '/control/sw.js';
  var swScope = '/control/';
  navigator.serviceWorker.register(swUrl, { scope: swScope })
    .then(function(registration){
      console.log('[ParkOps] Service Worker注册成功:', registration.scope);
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

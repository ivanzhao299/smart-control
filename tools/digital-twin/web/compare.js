const stage = document.querySelector('#stage');
const buttons = document.querySelectorAll('[data-mode]');
for (const button of buttons) button.addEventListener('click', () => {
  stage.className = `stage ${button.dataset.mode}`;
  for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
  document.querySelector('#opacityControl').hidden = button.dataset.mode !== 'overlay';
});
document.querySelector('#opacity').addEventListener('input', event => {
  stage.style.setProperty('--opacity', event.target.value / 100);
  document.querySelector('#opacityValue').textContent = `${event.target.value}%`;
});
for (const img of document.querySelectorAll('img')) {
  img.addEventListener('error', () => { document.querySelector('#imageError').hidden = false; });
  if (img.complete && !img.naturalWidth) document.querySelector('#imageError').hidden = false;
}
try {
  const response = await fetch('/comparison/review.json');
  if (!response.ok) throw Error('Review record unavailable');
  const review = await response.json();
  document.querySelector('#fitStatus').textContent = `${review.landmarkCount} 处人工参照点 · 拟合均方根误差约 ${review.rmsPixels.toFixed(1)} 像素（仅反映选点一致性，不代表模型完整或测绘精度）。`;
  const removed = review.removedObjects ? `移除 ${review.removedObjects} 个画外对象，` : '';
  document.querySelector('#cleanupStatus').textContent = `比对副本已${removed}裁切 ${review.clippedObjects} 个跨画框对象的画外部分，包括巨大底盘和延伸道路。原始 MAX 与完整导入模型均保留。画面内的背景保留供核对。`;
} catch {
  document.querySelector('#fitStatus').textContent = '尚未读取到本次对照记录，请检查本地结果挂载；当前不能认定对齐完成。';
}

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createParkOpsEditorState = factory;
})(typeof globalThis === 'object' ? globalThis : this, function (options) {
  'use strict';
  let revision = null, needsReload = true, busy = false, disposed = false;
  let loadedIdentity = null;
  const identity = () => options.identity();
  const snapshot = () => JSON.stringify(options.draft());
  const changed = () => options.changed?.({ revision, needsReload, busy });
  const failClosed = () => { revision = null; needsReload = true; changed(); };
  const layout = config => config && config.version === 1 &&
    ['stretch', 'cover', 'contain'].includes(config.fitMode) &&
    Array.isArray(config.phases) && config.phases.length > 0 && config.phases.length <= 8 &&
    Array.isArray(config.buildings) && config.buildings.length <= 200;
  const valid = value => value && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    (value.revision === 0 ? value.config === null : layout(value.config));
  const current = actor => !disposed && actor === identity();
  return {
    get state() { return { revision, needsReload, busy }; },
    dispose() { disposed = true; failClosed(); },
    async load(quiet = false) {
      if (busy || disposed) return;
      const actor = identity(), draft = snapshot();
      busy = true; failClosed();
      try {
        const value = await options.read();
        if (!current(actor)) { failClosed(); return; }
        if (!valid(value)) throw new Error('服务端布局版本无效，请重新读取');
        if (snapshot() !== draft) throw new Error('读取期间布局已修改，草稿已保留，请重新读取后再保存');
        options.apply(value.config);
        revision = value.revision; needsReload = false; loadedIdentity = actor;
        if (!quiet) options.status(value.config ? '已加载服务端共享配置' : '尚未保存，当前使用内置初始配置', 'ok');
      } catch (error) {
        failClosed();
        if (current(actor) && !quiet) options.status(`配置读取失败，草稿已保留：${error.message}`, 'error');
      } finally { busy = false; changed(); }
    },
    async save() {
      if (busy || disposed) return;
      const actor = identity();
      if (loadedIdentity !== actor) failClosed();
      if (revision === null || needsReload) {
        options.status('请先重新读取最新布局；当前草稿不会自动丢弃。', 'error');
        return;
      }
      const draft = snapshot(), expectedRevision = revision;
      busy = true; changed(); options.status('正在保存…');
      try {
        const value = await options.write(JSON.parse(draft), expectedRevision);
        if (!current(actor)) { failClosed(); return; }
        if (!valid(value) || value.revision < Math.max(1, expectedRevision) ||
            value.revision > expectedRevision + 1) throw new Error('保存返回版本无效，请重新读取核实');
        revision = value.revision;
        const continuedEditing = snapshot() !== draft;
        if (!continuedEditing) options.apply(value.config);
        options.status(continuedEditing ? '本次提交已保存；保存期间的新修改仍为未保存草稿' :
          '保存成功；LED、投影和其它浏览器将在 15 秒内同步', 'ok');
      } catch (error) {
        // A transport error can happen after a committed write. Never retry blindly.
        failClosed();
        if (current(actor)) options.status(`保存未完成确认，草稿已保留：${error.message}`, 'error');
      } finally { busy = false; changed(); }
    },
  };
});

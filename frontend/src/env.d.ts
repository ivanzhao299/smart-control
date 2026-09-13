/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WS_PATH?: string;
  /** 绝对 WS URL (优先级高于 VITE_WS_PATH) — 用于 frontend 跟 backend 在不同 host/port */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

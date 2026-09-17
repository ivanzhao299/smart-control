import axios, { type AxiosRequestConfig } from 'axios';
import { getClientToken, getAdminToken } from './http';
import { identityGeneration, assertCurrentIdentity, onIdentityChange } from './identity-boundary';

/**
 * media 专用 axios(留着只为上传进度回调 —— http.ts 那套 fetch 没有 onUploadProgress)。
 *
 * 不走 http.ts，必须同步捕获身份、带鉴权头并独立处理切换取消。
 * Fetch adapter 禁止重定向；浏览器支持请求流时才有细粒度上传进度。
 */
// Capture identity synchronously with the URL, not in an asynchronous interceptor.
// Fetch adapter prevents redirects (XHR cannot), and supports progress where the browser can stream requests.
async function mediaRequest(method: 'GET' | 'POST' | 'DELETE', url: string, data?: unknown, config: AxiosRequestConfig = {}) {
  const generation = identityGeneration();
  const clientToken = getClientToken();
  const adminToken = getAdminToken();
  const controller = new AbortController();
  const unsubscribe = onIdentityChange(() => controller.abort());
  try {
    const result = await axios.request({
      ...config, method, url, data,
      adapter: 'fetch',
      fetchOptions: { redirect: 'error', cache: 'no-store' },
      withCredentials: false,
      signal: controller.signal,
      headers: {
        ...config.headers,
        // Axios 1.20 injects its own User-Agent in the fetch adapter. Safari
        // preserves it (unlike Chromium), adding a disallowed CORS preflight
        // header even for list reads. false prevents Axios from re-inserting it;
        // the browser must supply its own User-Agent. Keep redirect/auth isolation.
        'User-Agent': false,
        ...(clientToken ? { 'X-Client-Token': clientToken } : {}),
        ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
      },
      onUploadProgress: config.onUploadProgress ? (event) => {
        if (generation === identityGeneration()) config.onUploadProgress?.(event);
      } : undefined,
    });
    assertCurrentIdentity(generation);
    return result;
  } catch (error) {
    assertCurrentIdentity(generation);
    throw error;
  } finally {
    unsubscribe();
  }
}
export const mediaHttp = {
  get: (url: string, config?: AxiosRequestConfig) => mediaRequest('GET', url, undefined, config),
  post: (url: string, data?: unknown, config?: AxiosRequestConfig) => mediaRequest('POST', url, data, config),
  delete: (url: string) => mediaRequest('DELETE', url),
};

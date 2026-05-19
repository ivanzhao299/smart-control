import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import type { ApiOk } from '@/types/api';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export const http: AxiosInstance = axios.create({
  baseURL,
  timeout: 15000,
  withCredentials: false,
});

http.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err.response?.data?.message) {
      err.message = err.response.data.message;
    }
    return Promise.reject(err);
  },
);

async function unwrap<T>(p: Promise<{ data: ApiOk<T> | { success: false; message: string } }>): Promise<T> {
  const { data } = await p;
  if (!data || data.success === false) {
    throw new Error((data && 'message' in data && data.message) || '请求失败');
  }
  return (data as ApiOk<T>).data;
}

export const api = {
  get: <T>(url: string, cfg?: AxiosRequestConfig) => unwrap<T>(http.get(url, cfg)),
  post: <T>(url: string, body?: unknown, cfg?: AxiosRequestConfig) =>
    unwrap<T>(http.post(url, body, cfg)),
  put: <T>(url: string, body?: unknown, cfg?: AxiosRequestConfig) =>
    unwrap<T>(http.put(url, body, cfg)),
  del: <T>(url: string, cfg?: AxiosRequestConfig) => unwrap<T>(http.delete(url, cfg)),
};

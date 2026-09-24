import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RootConfig } from '../../common/config/configuration';

const API_BASE = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 20000;

/** GitHub 侧错误 (网络 / 非 2xx / 权限不足), service 据此转成语义化 HTTP 异常。 */
export class GitHubActionsException extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubActionsException';
  }
}

export interface GitHubRun {
  id: number;
  /** queued | in_progress | completed */
  status: string;
  /** success | failure | cancelled | timed_out | action_required | null */
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  headBranch: string;
  event: string;
}

export interface GitHubJob {
  id: number;
  name: string;
  /** queued | in_progress | completed */
  status: string;
  conclusion: string | null;
}

/**
 * 极简 GitHub Actions 客户端: 用常驻 PAT 触发 ios-build.yml 的 workflow_dispatch 并轮询 run。
 * 只用全局 fetch, 不引新依赖。Token 仅存服务器 env (TESTFLIGHT_RENEW_TOKEN), 不进 git。
 */
@Injectable()
export class GitHubActionsClient {
  private readonly logger = new Logger(GitHubActionsClient.name);

  constructor(private readonly config: ConfigService) {}

  private get cfg() {
    return this.config.getOrThrow<RootConfig['testflight']>('testflight').github;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<{ status: number; headers: Headers; json: T | null }> {
    const { token } = this.cfg;
    if (!token) {
      throw new GitHubActionsException(503, '后台尚未配置 GitHub Token（TESTFLIGHT_RENEW_TOKEN），无法触发续期构建');
    }
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      this.logger.warn(`调用 GitHub 失败 (网络): ${method} ${path} ${(err as Error).message}`);
      throw new GitHubActionsException(0, `无法连接 GitHub: ${(err as Error).message}`);
    }

    const text = await res.text();
    let json: any = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const msg = String(json?.message ?? text.slice(0, 300) ?? `HTTP ${res.status}`);
      this.logger.warn(`GitHub ${method} ${path.split('?')[0]} HTTP ${res.status}: ${msg}`);
      throw new GitHubActionsException(res.status, msg);
    }
    return { status: res.status, headers: res.headers, json: json as T | null };
  }

  private workflowPath(): string {
    const { repository, workflow } = this.cfg;
    return `/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}`;
  }

  /** 触发 workflow_dispatch; GitHub 成功时返回 204 No Content。 */
  async dispatchWorkflow(): Promise<void> {
    const { ref } = this.cfg;
    const r = await this.request('POST', `${this.workflowPath()}/dispatches`, { ref });
    if (r.status !== 204) {
      throw new GitHubActionsException(r.status, `触发工作流返回非预期状态码 ${r.status}`);
    }
  }

  /**
   * 只读自检: workflow 是否存在/可访问, 以及 classic PAT 的 scope 头。
   * fine-grained token 不回 x-oauth-scopes (为空), 不代表无权限。
   */
  async verifyAccess(): Promise<{ accessible: boolean; scopes: string | null; state: string | null }> {
    const r = await this.request<{ state?: string }>('GET', this.workflowPath());
    return {
      accessible: true,
      scopes: r.headers.get('x-oauth-scopes'),
      state: r.json?.state ?? null,
    };
  }

  /** 最近若干次 workflow_dispatch 触发的 run (按创建时间倒序)。 */
  async listDispatchRuns(perPage = 5): Promise<GitHubRun[]> {
    const r = await this.request<{ workflow_runs?: any[] }>(
      'GET',
      `${this.workflowPath()}/runs?event=workflow_dispatch&per_page=${perPage}`,
    );
    return (r.json?.workflow_runs ?? []).map((x) => this.mapRun(x));
  }

  async getRun(runId: number): Promise<GitHubRun> {
    const r = await this.request<any>('GET', `/repos/${this.cfg.repository}/actions/runs/${runId}`);
    return this.mapRun(r.json);
  }

  async listJobs(runId: number): Promise<GitHubJob[]> {
    const r = await this.request<{ jobs?: any[] }>(
      'GET',
      `/repos/${this.cfg.repository}/actions/runs/${runId}/jobs?per_page=30`,
    );
    return (r.json?.jobs ?? []).map((j) => ({
      id: j.id,
      name: String(j.name ?? ''),
      status: String(j.status ?? ''),
      conclusion: j.conclusion ?? null,
    }));
  }

  private mapRun(x: any): GitHubRun {
    return {
      id: Number(x.id),
      status: String(x.status ?? ''),
      conclusion: x.conclusion ?? null,
      htmlUrl: String(x.html_url ?? ''),
      createdAt: String(x.created_at ?? ''),
      headBranch: String(x.head_branch ?? ''),
      event: String(x.event ?? ''),
    };
  }
}

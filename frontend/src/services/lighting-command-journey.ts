export interface LightingCommandState {
  on: boolean;
  brightness: number;
  confirmedOn: boolean;
  confirmedBrightness: number;
  busy: boolean;
  error: string | null;
}

export interface LightingCommandResponse {
  ok: boolean;
  error?: string;
  mock?: boolean;
}

export interface LightingCommandOutcome<T extends LightingCommandResponse> {
  accepted: boolean;
  ok: boolean;
  response?: T;
  error?: string;
}

/**
 * 灯光控制的可测试提交边界。
 *
 * 同一分区只允许一个在途命令。界面可以先显示目标状态，但只有设备命令成功后才更新
 * confirmed 值；失败时同时恢复开关和亮度，避免画面显示一个现场没有接受的状态。
 */
export async function runLightingCommand<T extends LightingCommandResponse>(
  state: LightingCommandState,
  desired: { on: boolean; brightness: number },
  dispatch: () => Promise<T>,
): Promise<LightingCommandOutcome<T>> {
  if (state.busy) return { accepted: false, ok: false };

  const previous = {
    on: state.confirmedOn,
    brightness: state.confirmedBrightness,
  };
  state.busy = true;
  state.error = null;
  state.on = desired.on;
  state.brightness = desired.brightness;
  try {
    const response = await dispatch();
    if (!response.ok) throw new Error(response.error || '执行失败');
    state.confirmedOn = desired.on;
    state.confirmedBrightness = desired.brightness;
    return { accepted: true, ok: true, response };
  } catch (error) {
    const message = (error as Error).message || '执行失败';
    state.on = previous.on;
    state.brightness = previous.brightness;
    state.error = message;
    return { accepted: true, ok: false, error: message };
  } finally {
    state.busy = false;
  }
}

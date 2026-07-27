import { antigravityExecutor } from './antigravityExecutor.js';
import { claudeExecutor } from './claudeExecutor.js';
import { codexExecutor } from './codexExecutor.js';
import { geminiCliExecutor } from './geminiCliExecutor.js';
import type { RuntimeDispatchInput, RuntimeResponse } from './types.js';

export async function dispatchRuntimeRequest(
  input: RuntimeDispatchInput,
): Promise<RuntimeResponse> {
  const executor = input.request.runtime?.executor || 'default';
  if (executor === 'codex') {
    return codexExecutor.dispatch(input);
  }
  if (executor === 'claude') {
    return claudeExecutor.dispatch(input);
  }
  if (executor === 'gemini-cli') {
    return geminiCliExecutor.dispatch(input);
  }
  if (executor === 'antigravity') {
    return antigravityExecutor.dispatch(input);
  }
  return codexExecutor.dispatch(input);
}

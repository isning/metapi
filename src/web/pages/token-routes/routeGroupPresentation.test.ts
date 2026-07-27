import { describe, expect, it } from 'vitest';

import { ApiRequestError } from '../../api.js';
import { routeGroupCommandErrorMessage } from './routeGroupPresentation.js';

describe('routeGroupCommandErrorMessage', () => {
  it('translates stable command codes and interpolates structured parameters', () => {
    const error = new ApiRequestError(
      'HTTP 400',
      400,
      'public_model_conflict',
      { modelName: 'deepseek-v4-flash' },
    );

    expect(routeGroupCommandErrorMessage(error, 'pages.tokenRoutes.groupsfailed'))
      .toBe('模型名称 deepseek-v4-flash 已由另一个公开路由组使用。');
  });

  it('does not expose an unknown server error message', () => {
    const error = new ApiRequestError('server-owned text', 400, 'unexpected_code', {});

    expect(routeGroupCommandErrorMessage(error, 'pages.tokenRoutes.groupsfailed'))
      .toBe('更新群组失败');
  });
});

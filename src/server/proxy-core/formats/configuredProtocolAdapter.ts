import type { DownstreamProtocolAdapter, PassthroughHeadersConfig, BodyConstraintsConfig } from './types.js';

export function createConfiguredProtocolAdapter(
  adapter: DownstreamProtocolAdapter,
  passthroughHeaders?: PassthroughHeadersConfig,
  bodyConstraints?: BodyConstraintsConfig,
): DownstreamProtocolAdapter {
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original === 'function') {
        return function(this: any, ...args: any[]) {
          const methodName = String(prop);

          if (methodName === 'extractPassthroughHeaders') {
            const [headers] = args;
            return original.call(this, headers, passthroughHeaders);
          }

          if (methodName === 'transformRequest') {
            const [body, headers, context] = args;
            return original.call(this, body, headers, context, bodyConstraints);
          }

          if (methodName === 'validateRequest') {
            const [body, headers, downstreamPath] = args;
            return original.call(this, body, headers, downstreamPath, bodyConstraints);
          }

          if (methodName === 'createStreamSession') {
            const [options] = args;
            return original.call(this, {
              ...options,
              bodyConstraints,
            });
          }

          if (methodName === 'transformResponse') {
            const [options] = args;
            return original.call(this, {
              ...options,
              bodyConstraints,
            });
          }

          return original.apply(this, args);
        };
      }
      return original;
    }
  });
}

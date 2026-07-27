type RuntimeSelectorStateEntry = {
  runtimeArtifactId: string;
  stateStore: Record<string, unknown>;
};

type ObservedValue = { present: boolean; value: unknown };
type ProposedWrite = { kind: 'set'; value: unknown } | { kind: 'delete' };

export type RouteRuntimeSelectorStateProposal = {
  runtimeArtifactId: string;
  /** Transactional state view consumed by the selector/CEL evaluator. */
  proposed: Record<string, unknown>;
  readonly observed: Map<string, ObservedValue>;
  readonly writes: Map<string, ProposedWrite>;
};

let activeEntry: RuntimeSelectorStateEntry | null = null;

/** Runtime selector state is ephemeral and scoped to one immutable compiled artifact. */
export function getRouteRuntimeSelectorStateStore(runtimeArtifactId: string): Record<string, unknown> {
  if (!activeEntry || activeEntry.runtimeArtifactId !== runtimeArtifactId) {
    activeEntry = { runtimeArtifactId, stateStore: {} };
  }
  return activeEntry.stateStore;
}

function observe(
  source: Record<string, unknown>,
  observed: Map<string, ObservedValue>,
  key: string,
): ObservedValue {
  const existing = observed.get(key);
  if (existing) return existing;
  const value = { present: Object.hasOwn(source, key), value: source[key] };
  observed.set(key, value);
  return value;
}

/**
 * Creates a lazy transactional view over selector state. Reads observe only
 * accessed keys and writes remain private until CAS commit, so proposal cost
 * is proportional to one decision rather than all selectors in the artifact.
 */
export function createRouteRuntimeSelectorStateProposal(
  runtimeArtifactId: string,
): RouteRuntimeSelectorStateProposal {
  const source = getRouteRuntimeSelectorStateStore(runtimeArtifactId);
  const observed = new Map<string, ObservedValue>();
  const writes = new Map<string, ProposedWrite>();
  const proposed = new Proxy<Record<string, unknown>>({}, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined;
      const write = writes.get(property);
      if (write) return write.kind === 'set' ? write.value : undefined;
      return observe(source, observed, property).value;
    },
    set(_target, property, value) {
      if (typeof property !== 'string') return false;
      observe(source, observed, property);
      writes.set(property, { kind: 'set', value });
      return true;
    },
    deleteProperty(_target, property) {
      if (typeof property !== 'string') return false;
      observe(source, observed, property);
      writes.set(property, { kind: 'delete' });
      return true;
    },
    has(_target, property) {
      if (typeof property !== 'string') return false;
      const write = writes.get(property);
      if (write) return write.kind === 'set';
      return observe(source, observed, property).present;
    },
    ownKeys() {
      for (const key of Object.keys(source)) observe(source, observed, key);
      return Array.from(new Set([
        ...Object.keys(source),
        ...Array.from(writes.entries()).flatMap(([key, write]) => write.kind === 'set' ? [key] : []),
      ])).filter((key) => writes.get(key)?.kind !== 'delete');
    },
    getOwnPropertyDescriptor(_target, property) {
      if (typeof property !== 'string' || !(property in proposed)) return undefined;
      return { configurable: true, enumerable: true, writable: true, value: proposed[property] };
    },
  });
  return { runtimeArtifactId, proposed, observed, writes };
}

/** Commits only keys touched by this proposal when their observed values remain current. */
export function commitRouteRuntimeSelectorStateProposal(
  proposal: RouteRuntimeSelectorStateProposal,
): boolean {
  if (!activeEntry || activeEntry.runtimeArtifactId !== proposal.runtimeArtifactId) return false;
  const current = activeEntry.stateStore;
  for (const [key, observed] of proposal.observed) {
    if (Object.hasOwn(current, key) !== observed.present || !Object.is(current[key], observed.value)) {
      return false;
    }
  }
  for (const [key, write] of proposal.writes) {
    if (write.kind === 'delete') delete current[key];
    else current[key] = write.value;
  }
  return true;
}

export function invalidateRouteRuntimeSelectorState(): void {
  activeEntry = null;
}

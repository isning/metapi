function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function cloneJsonValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item)) as T;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]),
    ) as T;
  }
  return value;
}

function toPathSegments(path: string): string[] {
  const normalized = asTrimmedString(path).replace(/^\.+/, '');
  return normalized
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function parseIndexSegment(segment: string): number | null {
  if (!/^\d+$/.test(segment)) return null;
  const parsed = Number.parseInt(segment, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function hasJsonPath(target: unknown, path: string): boolean {
  const segments = toPathSegments(path);
  if (segments.length <= 0) return false;

  let current: unknown = target;
  for (const segment of segments) {
    const index = parseIndexSegment(segment);
    if (index !== null) {
      if (!Array.isArray(current) || index >= current.length) return false;
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return false;
    current = current[segment];
  }
  return true;
}

export function setJsonPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = toPathSegments(path);
  if (segments.length <= 0) return;

  let current: unknown = target;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    const segmentIndex = parseIndexSegment(segment);
    const isLast = index === segments.length - 1;

    if (segmentIndex !== null) {
      if (!Array.isArray(current)) return;
      while (current.length <= segmentIndex) current.push(undefined);
      if (isLast) {
        current[segmentIndex] = cloneJsonValue(value);
        return;
      }
      if (!isRecord(current[segmentIndex]) && !Array.isArray(current[segmentIndex])) {
        current[segmentIndex] = parseIndexSegment(nextSegment) !== null ? [] : {};
      }
      current = current[segmentIndex];
      continue;
    }

    if (!isRecord(current)) return;
    if (isLast) {
      current[segment] = cloneJsonValue(value);
      return;
    }
    if (!isRecord(current[segment]) && !Array.isArray(current[segment])) {
      current[segment] = parseIndexSegment(nextSegment) !== null ? [] : {};
    }
    current = current[segment];
  }
}

export function deleteJsonPath(target: Record<string, unknown>, path: string): void {
  const segments = toPathSegments(path);
  if (segments.length <= 0) return;

  let current: unknown = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const segmentIndex = parseIndexSegment(segment);
    if (segmentIndex !== null) {
      if (!Array.isArray(current) || segmentIndex >= current.length) return;
      current = current[segmentIndex];
      continue;
    }
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return;
    current = current[segment];
  }

  const lastSegment = segments[segments.length - 1];
  const lastIndex = parseIndexSegment(lastSegment);
  if (lastIndex !== null) {
    if (!Array.isArray(current) || lastIndex >= current.length) return;
    current.splice(lastIndex, 1);
    return;
  }
  if (!isRecord(current)) return;
  delete current[lastSegment];
}

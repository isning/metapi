import { describe, expect, it } from 'vitest';
import {
  getTesterForcedTargetId,
  normalizeForcedTargetId,
  TESTER_FORCED_TARGET_HEADER,
  TESTER_REQUEST_HEADER,
} from './targetSelection.js';

describe('normalizeForcedTargetId', () => {
  it('accepts positive integer ids and rejects fractional or unsafe values', () => {
    expect(normalizeForcedTargetId(77)).toBe(77);
    expect(normalizeForcedTargetId('78')).toBe(78);
    expect(normalizeForcedTargetId(77.9)).toBeNull();
    expect(normalizeForcedTargetId('78.5')).toBeNull();
    expect(normalizeForcedTargetId('9007199254740993')).toBeNull();
    expect(normalizeForcedTargetId(0)).toBeNull();
    expect(normalizeForcedTargetId(-1)).toBeNull();
  });
});

describe('getTesterForcedTargetId', () => {
  it('ignores forged forced-target headers without the trusted tester bridge marker', () => {
    expect(getTesterForcedTargetId({
      headers: {
        [TESTER_FORCED_TARGET_HEADER]: '77',
      },
      clientIp: '127.0.0.1',
    })).toBeNull();

    expect(getTesterForcedTargetId({
      headers: {
        [TESTER_REQUEST_HEADER]: '1',
        [TESTER_FORCED_TARGET_HEADER]: '77',
      },
      clientIp: '203.0.113.10',
    })).toBeNull();
  });

  it('accepts the forced target id only for loopback tester bridge traffic', () => {
    expect(getTesterForcedTargetId({
      headers: {
        [TESTER_REQUEST_HEADER]: '1',
        [TESTER_FORCED_TARGET_HEADER]: '77',
      },
      clientIp: '::1',
    })).toBe(77);

    expect(getTesterForcedTargetId({
      headers: {
        [TESTER_REQUEST_HEADER]: '1',
        [TESTER_FORCED_TARGET_HEADER]: '78',
      },
      clientIp: '::ffff:127.0.0.1',
    })).toBe(78);
  });
});

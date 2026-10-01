/**
 * @jest-environment node
 */
import { clampRange, MAX_CHUNK_BYTES, parseContentRange } from '@/app/api/_lib/range';

describe('clampRange', () => {
  it('asks for the first chunk when there is no Range header', () => {
    expect(clampRange(null)).toBe(`bytes=0-${MAX_CHUNK_BYTES - 1}`);
  });

  it('keeps a small closed range as-is (iOS probes with bytes=0-1)', () => {
    expect(clampRange('bytes=0-1')).toBe('bytes=0-1');
  });

  it('caps an open-ended range at one chunk', () => {
    expect(clampRange('bytes=100-')).toBe(`bytes=100-${100 + MAX_CHUNK_BYTES - 1}`);
  });

  it('caps a closed range bigger than one chunk', () => {
    expect(clampRange('bytes=0-999999999')).toBe(`bytes=0-${MAX_CHUNK_BYTES - 1}`);
  });

  it('rejects suffix, multi and backwards ranges', () => {
    expect(clampRange('bytes=-500')).toBeNull();
    expect(clampRange('bytes=0-1,5-9')).toBeNull();
    expect(clampRange('bytes=10-5')).toBeNull();
    expect(clampRange('items=0-5')).toBeNull();
  });

  it('rejects a start offset too large to represent exactly', () => {
    expect(clampRange('bytes=99999999999999999999-')).toBeNull();
  });
});

describe('parseContentRange', () => {
  it('reads start, end and total', () => {
    expect(parseContentRange('bytes 0-1/5000')).toEqual({ start: 0, end: 1, total: 5000 });
  });

  it('returns null for an unknown total, an unsatisfied range or garbage', () => {
    expect(parseContentRange('bytes 0-1/*')).toBeNull();
    expect(parseContentRange('bytes */5000')).toBeNull();
    expect(parseContentRange(null)).toBeNull();
    expect(parseContentRange('nonsense')).toBeNull();
  });
});

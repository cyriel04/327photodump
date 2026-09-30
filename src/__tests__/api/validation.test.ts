/**
 * @jest-environment node
 */
import * as limits from '@/lib/upload-limits';
import {
  MAX_FILE_NAME_LENGTH,
  MAX_GUEST_NAME_LENGTH,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
  parseGuestName,
} from '@/app/api/_lib/validation';

describe('API validation limits', () => {
  it('re-exports the shared limits from @/lib/upload-limits (single source of truth)', () => {
    expect(MAX_GUEST_NAME_LENGTH).toBe(limits.MAX_GUEST_NAME_LENGTH);
    expect(MAX_FILE_NAME_LENGTH).toBe(limits.MAX_FILE_NAME_LENGTH);
    expect(MAX_IMAGE_SIZE).toBe(limits.MAX_IMAGE_SIZE);
    expect(MAX_VIDEO_SIZE).toBe(limits.MAX_VIDEO_SIZE);
  });

  it('keeps the documented values', () => {
    expect(MAX_GUEST_NAME_LENGTH).toBe(50);
    expect(MAX_FILE_NAME_LENGTH).toBe(200);
    expect(MAX_IMAGE_SIZE).toBe(50 * 1024 * 1024);
    expect(MAX_VIDEO_SIZE).toBe(100 * 1024 * 1024);
  });
});

describe('parseGuestName', () => {
  it('trims and accepts a name at the limit', () => {
    const name = 'a'.repeat(limits.MAX_GUEST_NAME_LENGTH);
    expect(parseGuestName(`  ${name}  `)).toBe(name);
  });

  it('rejects names over the limit, empty names and non-strings', () => {
    expect(parseGuestName('a'.repeat(limits.MAX_GUEST_NAME_LENGTH + 1))).toBeNull();
    expect(parseGuestName('   ')).toBeNull();
    expect(parseGuestName(42)).toBeNull();
  });

  it("accepts a name containing a quote (escaping happens at query time)", () => {
    expect(parseGuestName("O'Brien")).toBe("O'Brien");
  });
});

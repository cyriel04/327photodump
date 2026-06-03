import { renderHook, act } from '@testing-library/react';
import { useGuestSession } from '@/lib/use-guest-session';

beforeEach(() => {
  localStorage.clear();
});

describe('useGuestSession', () => {
  it('returns null guestName and 0 shotCount when localStorage is empty', () => {
    const { result } = renderHook(() => useGuestSession());
    expect(result.current.guestName).toBeNull();
    expect(result.current.shotCount).toBe(0);
    expect(result.current.shotsRemaining).toBe(30);
    expect(result.current.isOutOfFilm).toBe(false);
  });

  it('restores guestName and shotCount from localStorage on mount', () => {
    localStorage.setItem('guestName', 'Cyriel');
    localStorage.setItem('shotCount_Cyriel', '12');

    const { result } = renderHook(() => useGuestSession());
    expect(result.current.guestName).toBe('Cyriel');
    expect(result.current.shotCount).toBe(12);
    expect(result.current.shotsRemaining).toBe(18);
  });

  it('setGuestName saves name to localStorage and updates state', () => {
    const { result } = renderHook(() => useGuestSession());

    act(() => { result.current.setGuestName('Maria'); });

    expect(result.current.guestName).toBe('Maria');
    expect(localStorage.getItem('guestName')).toBe('Maria');
  });

  it('incrementShot increases count and persists to localStorage', () => {
    const { result } = renderHook(() => useGuestSession());

    act(() => { result.current.setGuestName('Cyriel'); });
    act(() => { result.current.incrementShot(); });

    expect(result.current.shotCount).toBe(1);
    expect(localStorage.getItem('shotCount_Cyriel')).toBe('1');
  });

  it('isOutOfFilm is true when shotCount reaches 30', () => {
    localStorage.setItem('guestName', 'Cyriel');
    localStorage.setItem('shotCount_Cyriel', '30');

    const { result } = renderHook(() => useGuestSession());
    expect(result.current.isOutOfFilm).toBe(true);
    expect(result.current.shotsRemaining).toBe(0);
  });
});

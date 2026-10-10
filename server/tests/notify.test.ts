import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, EMPTY_STATE, evaluate, matchesPrefs, type NotifyPrefs } from '../../shared/notify';
import type { HazardEvent } from '../../shared/types';

const ev = (id: string, over: Partial<HazardEvent> = {}): HazardEvent => ({
  id, title: `Event ${id}`, category: 'earthquakes', latitude: 0, longitude: 0, geometryType: 'point', track: [], startTime: 1, updatedTime: null, closedTime: null,
  severity: null, place: 'Here', description: null, sources: [], match: null,
  quake: { magnitude: 7 } as HazardEvent['quake'], ...over,
});
const prefs: NotifyPrefs = { ...DEFAULT_PREFS, enabled: true };
const none = () => null;
const T = 1_000_000_000;

describe('notification preferences', () => {
  it('filters by category, magnitude and area', () => {
    expect(matchesPrefs(ev('a'), prefs, none)).toBe(true);
    expect(matchesPrefs(ev('a', { quake: { magnitude: 5 } as HazardEvent['quake'] }), prefs, none)).toBe(false);
    expect(matchesPrefs(ev('a', { category: 'dustHaze' }), prefs, none)).toBe(false);
    expect(matchesPrefs(ev('a'), { ...prefs, area: { kind: 'country', iso2: 'JP', name: 'Japan' } }, () => 'JP')).toBe(true);
    expect(matchesPrefs(ev('a'), { ...prefs, area: { kind: 'country', iso2: 'JP', name: 'Japan' } }, () => 'CL')).toBe(false);
    expect(matchesPrefs(ev('a'), { ...prefs, area: { kind: 'point', latitude: 0, longitude: 1, radiusKm: 50 } }, none)).toBe(false);
    expect(matchesPrefs(ev('a'), { ...prefs, area: { kind: 'point', latitude: 0, longitude: 1, radiusKm: 200 } }, none)).toBe(true);
  });
});

describe('evaluate', () => {
  it('sets a baseline on first run without notifying', () => {
    const r = evaluate([ev('a'), ev('b')], prefs, EMPTY_STATE, T, none);
    expect(r.notifications).toEqual([]);
    expect(r.state).toMatchObject({ primed: true, seen: ['a', 'b'] });
  });
  it('notifies each new event once', () => {
    const s1 = evaluate([ev('a')], prefs, EMPTY_STATE, T, none).state;
    const r2 = evaluate([ev('a'), ev('b')], prefs, s1, T + 1, none);
    expect(r2.notifications.map((n) => n.eventId)).toEqual(['b']);
    expect(evaluate([ev('a'), ev('b')], prefs, r2.state, T + 2, none).notifications).toEqual([]);
  });
  it('groups matches during the cooldown', () => {
    let s = evaluate([], prefs, EMPTY_STATE, T, none).state;
    s = evaluate([ev('a')], prefs, s, T, none).state;
    const r = evaluate([ev('b'), ev('c', { quake: { magnitude: 8 } as HazardEvent['quake'] })], prefs, s, T + 60_000, none);
    expect(r.notifications).toHaveLength(1);
    expect(r.notifications[0]).toMatchObject({ eventId: 'c', body: expect.stringMatching(/cooldown/) });
    expect(r.notifications[0]!.title).toMatch(/^2 new events/);
  });
  it('stays silent when disabled but keeps tracking ids', () => {
    const s = evaluate([], prefs, EMPTY_STATE, T, none).state;
    const r = evaluate([ev('a')], { ...prefs, enabled: false }, s, T, none);
    expect(r.notifications).toEqual([]);
    expect(r.state.seen).toContain('a');
  });
});

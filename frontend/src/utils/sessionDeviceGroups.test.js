import {
  groupSessionsByDevice,
  splitDeviceGroups,
  staleSidsForGroup,
} from './sessionDeviceGroups';

const chromeWin = { device: 'Chrome · Windows', deviceType: 'desktop' };
const safariIphone = { device: 'Safari · iPhone', deviceType: 'mobile' };

describe('groupSessionsByDevice', () => {
  test('merges repeated logins of the same browser into one device card', () => {
    const groups = groupSessionsByDevice([
      { sid: 's1', current: true, authDeviceId: 'dev-a', lastSeenAt: '2026-06-10T18:00:00Z', ...chromeWin },
      { sid: 's2', lastSeenAt: '2026-06-09T10:00:00Z', ...chromeWin },
      { sid: 's3', lastSeenAt: '2026-06-08T10:00:00Z', ...chromeWin },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].current).toBe(true);
    expect(groups[0].deviceBound).toBe(true);
    expect(groups[0].duplicateCount).toBe(2);
    expect(groups[0].sessions.map((s) => s.sid)).toEqual(['s1', 's2', 's3']);
  });

  test('merges same-label device entries into one card (clean UI)', () => {
    const groups = groupSessionsByDevice([
      { sid: 'a1', current: true, authDeviceId: 'dev-a', lastSeenAt: '2026-06-10T18:00:00Z', ...chromeWin },
      { sid: 'b1', authDeviceId: 'dev-b', lastSeenAt: '2026-06-10T17:00:00Z', ...chromeWin },
      // Unbound session with the same browser/OS label joins the same card.
      { sid: 'u1', lastSeenAt: '2026-06-07T17:00:00Z', ...chromeWin },
      { sid: 'm1', authDeviceId: 'dev-c', lastSeenAt: '2026-06-10T16:00:00Z', ...safariIphone },
    ]);

    expect(groups).toHaveLength(2);
    const win = groups.find((g) => g.label === 'Chrome · Windows');
    expect(win.sessions.map((s) => s.sid)).toEqual(['a1', 'b1', 'u1']);
    expect(win.current).toBe(true);
    expect(win.duplicateCount).toBe(2);
    const iphone = groups.find((g) => g.label === 'Safari · iPhone');
    expect(iphone.sessions.map((s) => s.sid)).toEqual(['m1']);
  });

  test('groups unbound-only sessions by UA label', () => {
    const groups = groupSessionsByDevice([
      { sid: 'x1', lastSeenAt: '2026-06-10T12:00:00Z', ...safariIphone },
      { sid: 'x2', lastSeenAt: '2026-06-09T12:00:00Z', ...safariIphone },
      { sid: 'y1', lastSeenAt: '2026-06-10T11:00:00Z', ...chromeWin },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].sessions).toHaveLength(2);
    expect(groups[0].label).toBe('Safari · iPhone');
  });

  test('current group sorts first, others by activity desc', () => {
    const groups = groupSessionsByDevice([
      { sid: 'old', authDeviceId: 'dev-old', lastSeenAt: '2026-06-01T10:00:00Z', ...safariIphone },
      { sid: 'fresh', authDeviceId: 'dev-fresh', lastSeenAt: '2026-06-10T10:00:00Z', ...chromeWin },
      { sid: 'cur', current: true, authDeviceId: 'dev-cur', lastSeenAt: '2026-06-05T10:00:00Z', device: 'Firefox · Windows', deviceType: 'desktop' },
    ]);

    expect(groups.map((g) => g.label)).toEqual([
      'Firefox · Windows',
      'Chrome · Windows',
      'Safari · iPhone',
    ]);
  });

  test('tolerates empty and malformed input', () => {
    expect(groupSessionsByDevice(null)).toEqual([]);
    expect(groupSessionsByDevice([{ noSid: true }, null])).toEqual([]);
  });

  test('drops exact duplicate logins (bound + unbound twin), keeps current', () => {
    const dup = { sid: 'd1', lastSeenAt: '2026-08-16T01:52:00Z', createdAt: '2026-08-16T00:25:00Z', ip: '1.2.3.4', ...chromeWin };
    const groups = groupSessionsByDevice([
      { sid: 's1', current: true, authDeviceId: 'dev-a', lastSeenAt: '2026-08-16T00:20:00Z', createdAt: '2026-08-16T00:25:00Z', ip: '1.2.3.4', ...chromeWin },
      { ...dup, authDeviceId: 'dev-a' },
      { ...dup, sid: 'd2' },
    ]);

    const totalSids = groups.flatMap((g) => g.sessions).map((s) => s.sid);
    expect(totalSids).toEqual(['s1', 'd1']);
  });
});

describe('splitDeviceGroups / staleSidsForGroup', () => {
  test('splits current device from others and lists stale sids only', () => {
    const groups = groupSessionsByDevice([
      { sid: 's1', current: true, authDeviceId: 'dev-a', lastSeenAt: '2026-06-10T18:00:00Z', ...chromeWin },
      { sid: 's2', lastSeenAt: '2026-06-09T10:00:00Z', ...chromeWin },
      { sid: 'm1', authDeviceId: 'dev-c', lastSeenAt: '2026-06-10T16:00:00Z', ...safariIphone },
    ]);

    const { currentGroup, otherGroups } = splitDeviceGroups(groups);
    expect(currentGroup.key).toBe('dev:dev-a');
    expect(otherGroups.map((g) => g.key)).toEqual(['dev:dev-c']);
    expect(staleSidsForGroup(currentGroup)).toEqual(['s2']);
    expect(staleSidsForGroup(otherGroups[0])).toEqual(['m1']);
    expect(staleSidsForGroup(null)).toEqual([]);
  });
});

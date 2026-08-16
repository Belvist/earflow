// Groups auth sessions by physical device for the Security settings screen.
//
// Each login creates a new sid, so the raw /api/auth/sessions list shows the
// same browser 3+ times. Backend binds the freshest sid of a device to its
// PoP authDeviceId; older sids of the same browser stay unbound. We merge:
//   1) sessions sharing an authDeviceId — exact same device;
//   2) unbound sessions whose UA label matches exactly one bound device —
//      treated as its older logins;
//   3) remaining unbound sessions — grouped with each other by UA label.

function normalizeLabel(session) {
  const device = String(session?.device || '').trim() || 'Неизвестное устройство';
  const type = String(session?.deviceType || '').trim() || 'desktop';
  return `${device}|${type}`;
}

function parseTime(value) {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function sessionActivityAt(session) {
  return Math.max(parseTime(session?.lastSeenAt), parseTime(session?.createdAt));
}

// Identical logins can appear twice (one sid bound to a PoP device, one
// unbound duplicate) — drop exact lookalikes, keeping the current session.
function sessionDedupeKey(session) {
  return [
    String(session?.device || ''),
    String(session?.deviceType || ''),
    String(session?.createdAt || ''),
    String(session?.lastSeenAt || ''),
    String(session?.ip || ''),
  ].join('|');
}

function dedupeSessions(list) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    if (s && s.current === true) {
      out.push(s);
      continue;
    }
    const key = sessionDedupeKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function groupSessionsByDevice(sessions) {
  const list = dedupeSessions(
    Array.isArray(sessions)
      ? sessions.filter((s) => s && typeof s.sid === 'string' && s.sid)
      : [],
  );
  const groups = new Map();

  const ensureGroup = (key) => {
    let group = groups.get(key);
    if (!group) {
      group = { key, sessions: [] };
      groups.set(key, group);
    }
    return group;
  };

  for (const session of list) {
    const deviceId = String(session.authDeviceId || '').trim();
    if (deviceId) {
      ensureGroup(`dev:${deviceId}`).sessions.push(session);
    }
  }

  for (const session of list) {
    if (String(session.authDeviceId || '').trim()) continue;
    const label = normalizeLabel(session);
    const boundMatches = [];
    for (const group of groups.values()) {
      if (!group.key.startsWith('dev:')) continue;
      if (group.sessions.some((s) => normalizeLabel(s) === label)) {
        boundMatches.push(group);
      }
    }
    if (boundMatches.length === 1) {
      boundMatches[0].sessions.push(session);
    } else {
      ensureGroup(`ua:${label}`).sessions.push(session);
    }
  }

  const merged = new Map();
  for (const group of groups.values()) {
    const key = `${normalizeLabel(group.sessions[0])}`;
    if (merged.has(key)) {
      merged.get(key).push(group);
    } else {
      merged.set(key, [group]);
    }
  }

  const result = [];
  for (const chunk of merged.values()) {
    const sessions = chunk.flatMap((group) => group.sessions);
    const ordered = sessions.sort((a, b) => {
      if ((a.current === true) !== (b.current === true)) {
        return a.current === true ? -1 : 1;
      }
      return sessionActivityAt(b) - sessionActivityAt(a);
    });
    const primary = ordered[0];
    result.push({
      key: chunk.length === 1 ? chunk[0].key : `label:${normalizeLabel(primary)}`,
      deviceBound: chunk.some((group) => group.key.startsWith('dev:')),
      label: String(primary?.device || '').trim() || 'Неизвестное устройство',
      deviceType: String(primary?.deviceType || '').trim() || 'desktop',
      current: ordered.some((s) => s.current === true),
      primary,
      sessions: ordered,
      duplicateCount: Math.max(0, ordered.length - 1),
      lastActivityAt: ordered.reduce((max, s) => Math.max(max, sessionActivityAt(s)), 0),
    });
  }

  result.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return b.lastActivityAt - a.lastActivityAt;
  });
  return result;
}

export function splitDeviceGroups(groups) {
  const safe = Array.isArray(groups) ? groups : [];
  const currentGroup = safe.find((g) => g && g.current) || null;
  const otherGroups = safe.filter((g) => g && g !== currentGroup);
  return { currentGroup, otherGroups };
}

// Sids of a group except the current session — safe to revoke in bulk.
export function staleSidsForGroup(group) {
  if (!group || !Array.isArray(group.sessions)) return [];
  return group.sessions.filter((s) => s.current !== true).map((s) => s.sid);
}

package party

// scriptApply is identical to party-state-service (Redis+cjson) with optional
// display metadata on set_track for player UI compatibility.
const scriptApply = `
local docKey = KEYS[1]

local nowMs = tonumber(ARGV[1])
local ttlSeconds = tonumber(ARGV[2])
local cmdJson = ARGV[3]

local cjson = cjson
local cmd = cjson.decode(cmdJson)

local raw = redis.call('GET', docKey)
if not raw then
  return cjson.encode({ ok = false, code = 'NOT_FOUND' })
end

local doc = cjson.decode(raw)
if doc.endedAtMs ~= cjson.null and doc.endedAtMs ~= nil then
  return cjson.encode({ ok = false, code = 'PARTY_ENDED' })
end

local function touchAll()
  redis.call('EXPIRE', docKey, ttlSeconds)
end

local function isHost(userId)
  return tostring(doc.hostId) == tostring(userId)
end

local function can(userId, action)
  if isHost(userId) then
    return true
  end
  local p = doc.permissions
  if action == 'playPause' then return p.guestsCanPlayPause == true end
  if action == 'seek' then return p.guestsCanSeek == true end
  if action == 'skip' then return p.guestsCanSkip == true end
  if action == 'addToQueue' then return p.guestsCanAddToQueue == true end
  if action == 'removeFromQueue' then return p.guestsCanRemoveFromQueue == true end
  return false
end

local function snapshot(event)
  doc.rev = (doc.rev or 0) + 1
  event.stateRevision = doc.rev
  redis.call('SET', docKey, cjson.encode(doc))
  touchAll()
  return cjson.encode({ ok = true, doc = doc, event = event })
end

if cmd.type == 'join' then
  local uid = tostring(cmd.userId)
  local uname = tostring(cmd.username)
  if doc.participants == cjson.null or doc.participants == nil then doc.participants = {} end
  local existing = doc.participants[uid]
  if existing == nil then
    doc.participants[uid] = { userId = uid, username = uname, isHost = isHost(uid), joinedAtMs = nowMs }
    return snapshot({ t = 'user_joined', partyId = doc.id, userId = uid, username = uname, isHost = isHost(uid), atMs = nowMs })
  else
    existing.username = uname
    doc.participants[uid] = existing
  end
  redis.call('SET', docKey, cjson.encode(doc))
  touchAll()
  return cjson.encode({ ok = true, doc = doc })
end

if cmd.type == 'leave' then
  local uid = tostring(cmd.userId)
  if tostring(doc.hostId) == uid then
    doc.endedAtMs = nowMs
    redis.call('SET', docKey, cjson.encode(doc))
    touchAll()
    redis.call('DEL', docKey)
    return cjson.encode({ ok = true, doc = doc, event = { t = 'party_ended', partyId = doc.id, reason = 'HOST_LEFT', atMs = nowMs } })
  end
  if doc.participants ~= cjson.null and doc.participants ~= nil then
    doc.participants[uid] = nil
  end
  return snapshot({ t = 'user_left', partyId = doc.id, userId = uid, atMs = nowMs })
end

if cmd.type == 'end' then
  local uid = tostring(cmd.userId)
  if not isHost(uid) then
    return cjson.encode({ ok = false, code = 'NOT_AUTHORIZED' })
  end
  doc.endedAtMs = nowMs
  redis.call('SET', docKey, cjson.encode(doc))
  touchAll()
  redis.call('DEL', docKey)
  return cjson.encode({ ok = true, doc = doc, event = { t = 'party_ended', partyId = doc.id, reason = 'ENDED', atMs = nowMs } })
end

if cmd.type == 'set_track' then
  local uid = tostring(cmd.userId)
  if not isHost(uid) then
    return cjson.encode({ ok = false, code = 'NOT_AUTHORIZED' })
  end
  doc.playback.trackId = tostring(cmd.trackId)
  if cmd.trackTitle ~= nil then doc.playback.trackTitle = cmd.trackTitle end
  if cmd.trackArtist ~= nil then doc.playback.trackArtist = cmd.trackArtist end
  if cmd.trackCover ~= nil then doc.playback.trackCover = cmd.trackCover end
  if cmd.trackDurationMs ~= nil then doc.playback.trackDuration = tonumber(cmd.trackDurationMs) or 0 end
  doc.playback.positionMs = 0
  doc.playback.positionUpdatedAtMs = nowMs
  doc.playback.isPlaying = false
  return snapshot({ t = 'playback', partyId = doc.id, playback = doc.playback, atMs = nowMs })
end

if cmd.type == 'play' then
  local uid = tostring(cmd.userId)
  if not can(uid, 'playPause') then
    return cjson.encode({ ok = false, code = 'NOT_AUTHORIZED' })
  end
  doc.playback.isPlaying = true
  doc.playback.positionUpdatedAtMs = nowMs
  return snapshot({ t = 'playback', partyId = doc.id, playback = doc.playback, atMs = nowMs })
end

if cmd.type == 'pause' then
  local uid = tostring(cmd.userId)
  if not can(uid, 'playPause') then
    return cjson.encode({ ok = false, code = 'NOT_AUTHORIZED' })
  end
  if doc.playback.isPlaying == true then
    local elapsed = nowMs - tonumber(doc.playback.positionUpdatedAtMs or nowMs)
    if elapsed < 0 then elapsed = 0 end
    doc.playback.positionMs = tonumber(doc.playback.positionMs or 0) + elapsed
  end
  doc.playback.isPlaying = false
  doc.playback.positionUpdatedAtMs = nowMs
  return snapshot({ t = 'playback', partyId = doc.id, playback = doc.playback, atMs = nowMs })
end

if cmd.type == 'seek' then
  local uid = tostring(cmd.userId)
  if not can(uid, 'seek') then
    return cjson.encode({ ok = false, code = 'NOT_AUTHORIZED' })
  end
  doc.playback.positionMs = tonumber(cmd.positionMs)
  doc.playback.positionUpdatedAtMs = nowMs
  return snapshot({ t = 'playback', partyId = doc.id, playback = doc.playback, atMs = nowMs })
end

-- Atomic host playback update. The frontend uses this for track switches and
-- position heartbeats so guests receive one revision instead of set_track +
-- seek + play/pause bursts.
if cmd.type == 'playback_update' then
  local uid = tostring(cmd.userId)
  if not isHost(uid) then
    return cjson.encode({ ok = false, code = 'NOT_AUTHORIZED' })
  end

  if cmd.trackId ~= nil then
    doc.playback.trackId = tostring(cmd.trackId)
  end
  if cmd.trackTitle ~= nil then doc.playback.trackTitle = cmd.trackTitle end
  if cmd.trackArtist ~= nil then doc.playback.trackArtist = cmd.trackArtist end
  if cmd.trackCover ~= nil then doc.playback.trackCover = cmd.trackCover end
  if cmd.trackDurationMs ~= nil then doc.playback.trackDuration = tonumber(cmd.trackDurationMs) or 0 end

  if cmd.positionMs ~= nil then
    local pos = tonumber(cmd.positionMs) or 0
    if pos < 0 then pos = 0 end
    doc.playback.positionMs = pos
  elseif cmd.isPlaying == false and doc.playback.isPlaying == true then
    local elapsed = nowMs - tonumber(doc.playback.positionUpdatedAtMs or nowMs)
    if elapsed < 0 then elapsed = 0 end
    doc.playback.positionMs = tonumber(doc.playback.positionMs or 0) + elapsed
  end

  if cmd.isPlaying ~= nil then
    doc.playback.isPlaying = cmd.isPlaying == true
  end
  doc.playback.positionUpdatedAtMs = nowMs
  return snapshot({ t = 'playback', partyId = doc.id, playback = doc.playback, atMs = nowMs })
end

if cmd.type == 'add_to_queue' then
  local uid = tostring(cmd.userId)
  if not can(uid, 'addToQueue') then
    return cjson.encode({ ok = false, code = 'NOT_AUTHORIZED' })
  end
  local tr = cmd.track
  if doc.queue == cjson.null or doc.queue == nil then doc.queue = {} end
  local tid = tostring(tr.id)
  for _, q in ipairs(doc.queue) do
    if tostring(q.id) == tid then
      return cjson.encode({ ok = false, code = 'ALREADY_QUEUED' })
    end
  end
  local qid = tostring(cmd.queueId or '')
  if qid == '' then
    qid = tostring(nowMs) .. '-' .. uid .. '-' .. tid .. '-' .. tostring(#doc.queue + 1)
  end
  table.insert(doc.queue, { queueId = qid, id = tid, title = tostring(tr.title), artist = tostring(tr.artist), cover = tr.cover, durationMs = tonumber(tr.durationMs or 0), addedBy = uid, addedByName = tostring(cmd.username), addedAtMs = nowMs })
  return snapshot({ t = 'queue', partyId = doc.id, queue = doc.queue, atMs = nowMs })
end

if cmd.type == 'skip' then
  local uid = tostring(cmd.userId)
  if not can(uid, 'skip') then
    return cjson.encode({ ok = false, code = 'NOT_AUTHORIZED' })
  end
  if doc.queue == cjson.null or doc.queue == nil or #doc.queue == 0 then
    return cjson.encode({ ok = false, code = 'QUEUE_EMPTY' })
  end
  local next = table.remove(doc.queue, 1)
  doc.playback.trackId = tostring(next.id)
  if next.title ~= nil then doc.playback.trackTitle = next.title end
  if next.artist ~= nil then doc.playback.trackArtist = next.artist end
  if next.cover ~= nil then doc.playback.trackCover = next.cover end
  if next.durationMs ~= nil then doc.playback.trackDuration = tonumber(next.durationMs) or 0 end
  doc.playback.positionMs = 0
  doc.playback.positionUpdatedAtMs = nowMs
  doc.playback.isPlaying = true
  return snapshot({ t = 'skip', partyId = doc.id, playback = doc.playback, queue = doc.queue, atMs = nowMs })
end

-- Full doc refresh for WS clients.
if cmd.type == 'ping' or cmd.type == 'snapshot' then
  touchAll()
  return cjson.encode({ ok = true, doc = doc })
end

-- Remove by 0-based index (same as v1 useParty).
if cmd.type == 'remove_from_queue' then
  local uid = tostring(cmd.userId)
  if not isHost(uid) and not can(uid, 'removeFromQueue') then
    return cjson.encode({ ok = false, code = 'NOT_AUTHORIZED' })
  end
  local qid = tostring(cmd.queueId or '')
  if qid ~= '' then
    if doc.queue == cjson.null or doc.queue == nil then
      return cjson.encode({ ok = false, code = 'QUEUE_EMPTY' })
    end
    for i, q in ipairs(doc.queue) do
      if tostring(q.queueId or '') == qid then
        table.remove(doc.queue, i)
        return snapshot({ t = 'queue', partyId = doc.id, queue = doc.queue, atMs = nowMs })
      end
    end
    return cjson.encode({ ok = false, code = 'QUEUE_ITEM_NOT_FOUND' })
  end
  local idx0 = tonumber(cmd.index)
  if idx0 == nil or doc.queue == cjson.null or doc.queue == nil or idx0 < 0 or idx0 >= #doc.queue then
    return cjson.encode({ ok = false, code = 'INDEX_OUT_OF_RANGE' })
  end
  table.remove(doc.queue, idx0 + 1)
  return snapshot({ t = 'queue', partyId = doc.id, queue = doc.queue, atMs = nowMs })
end

-- Host-only permission update (v1: update_permissions).
if cmd.type == 'set_permissions' then
  local uid = tostring(cmd.userId)
  if not isHost(uid) then
    return cjson.encode({ ok = false, code = 'NOT_AUTHORIZED' })
  end
  local p = cmd.permissions
  if p ~= cjson.null and p ~= nil then
    if p.guestsCanPlayPause ~= nil then
      doc.permissions.guestsCanPlayPause = p.guestsCanPlayPause
      doc.permissions.guestsCanChangePlayback = p.guestsCanPlayPause
    end
    if p.guestsCanChangePlayback ~= nil then
      doc.permissions.guestsCanPlayPause = p.guestsCanChangePlayback
      doc.permissions.guestsCanChangePlayback = p.guestsCanChangePlayback
    end
    if p.guestsCanSeek ~= nil then doc.permissions.guestsCanSeek = p.guestsCanSeek end
    if p.guestsCanAddToQueue ~= nil then doc.permissions.guestsCanAddToQueue = p.guestsCanAddToQueue end
    if p.guestsCanRemoveFromQueue ~= nil then doc.permissions.guestsCanRemoveFromQueue = p.guestsCanRemoveFromQueue end
    if p.guestsCanSkip ~= nil then doc.permissions.guestsCanSkip = p.guestsCanSkip end
  end
  return snapshot({ t = 'permissions_updated', partyId = doc.id, permissions = doc.permissions, atMs = nowMs })
end

if cmd.type == 'reaction' then
  local uid = tostring(cmd.userId)
  if doc.participants == cjson.null or doc.participants[uid] == nil then
    return cjson.encode({ ok = false, code = 'NOT_IN_PARTY' })
  end
  local psub = doc.participants[uid]
  local un = psub and psub.username
  if un == nil then un = tostring(cmd.username or 'User') end
  local rtype = tostring(cmd.reactionType or 'like')
  return snapshot({ t = 'reaction', partyId = doc.id, userId = uid, username = un, type = rtype, atMs = nowMs })
end

if cmd.type == 'chat' then
  local uid = tostring(cmd.userId)
  if doc.participants == cjson.null or doc.participants[uid] == nil then
    return cjson.encode({ ok = false, code = 'NOT_IN_PARTY' })
  end
  local psub = doc.participants[uid]
  local un = psub and psub.username
  if un == nil then un = tostring(cmd.username or 'User') end
  local msg = tostring(cmd.message or '')
  if #msg > 500 then msg = string.sub(msg, 1, 500) end
  return snapshot({ t = 'chat', partyId = doc.id, userId = uid, username = un, message = msg, atMs = nowMs })
end

return cjson.encode({ ok = false, code = 'UNSUPPORTED' })
`

import { useRef } from 'react';

/**
 * Подставляет последний известный трек когда queue manager кратковременно обнуляет
 * currentTrack (при переключении, стопе, рефреше очереди). Гарантирует что UI
 * НИКОГДА не мигает «нет трека» после того как хотя бы один трек был воспроизведён.
 *
 * Пустота очереди обрабатывается компонентами-потребителями (GlobalPlayerBar скрывается
 * через hasAnyTracks, MobilePlayerModal проверяет tracks.length).
 *
 * @param {object} params
 * @param {unknown} params.rawCurrentTrack — фактическое значение из queue manager
 * @param {import('react').MutableRefObject<number|undefined>} [params.switchingUntilRef] — не используется напрямую, сохранён для совместимости вызова
 * @param {import('react').MutableRefObject<boolean>} [params.userWantsPlaybackRef] — не используется напрямую, сохранён для совместимости вызова
 * @param {string|undefined} [params.fsmState] — не используется напрямую, сохранён для совместимости вызова
 * @param {boolean|undefined} [params.isBuffering] — не используется напрямую, сохранён для совместимости вызова
 * @returns {{ currentTrack: unknown, activeTrackId: string | null }}
 */
export function useDisplayTrackDuringTransition({
  rawCurrentTrack,
  switchingUntilRef: _switchingUntilRef,
  userWantsPlaybackRef: _userWantsPlaybackRef,
  fsmState: _fsmState,
  isBuffering: _isBuffering,
}) {
  const lastKnownTrackRef = useRef(rawCurrentTrack);
  if (rawCurrentTrack) {
    lastKnownTrackRef.current = rawCurrentTrack;
  }

  const currentTrack = rawCurrentTrack || lastKnownTrackRef.current || null;
  const activeTrackId = currentTrack?.id != null ? String(currentTrack.id) : null;

  return { currentTrack, activeTrackId };
}

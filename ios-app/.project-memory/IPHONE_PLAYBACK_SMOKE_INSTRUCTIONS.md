# iPhone Playback Smoke — инструкция (PEND-IOS-005)

**Цель:** собрать evidence для закрытия **`PEND-IOS-005`** (background audio, lock screen, cold-start auto-resume, track switch, post–P0 AVAudioSession fix).  
**Статус gate:** **OPEN** — симулятор и `verify:ios-native` unit-тесты **не доказывают** lock screen / audio route / фон.  
**Связано:** `docs/PENDING.md` → `PEND-IOS-005`; `docs/DECISIONS.md` 2026-06-25 «iOS P0 playback: AVAudioSession -50…»; `PLAYBACK_PHASE3.md`.

**Оценка по сути:**

```text
До P0-фикса (2026-06-25): broken playback lifecycle на device
После P0-фикса в коде:     prepared — needs device evidence
Закрыть PEND-IOS-005:      только после PASS всего чеклиста ниже на real iPhone
```

---

## 0. Предусловия

- Mac + Xcode 15+ (или текущий Xcode проекта)
- **Реальный iPhone** (iOS 17+), кабель или Wi‑Fi debugging — **не Simulator**
- Интернет на iPhone; VPN отключить, если ломает `api.earflow.ru`
- Залогиненный аккаунт (prod gateway)

```bash
cd /Users/earflow/Downloads/music-platform/ios-app
xcodegen generate   # если меняли project.yml
open Earflow.xcodeproj
```

| Параметр | Значение |
|----------|----------|
| Scheme | **Earflow** |
| Target | **Earflow** (не EarflowTests) |
| Device | **Ваш iPhone** |
| `EARFLOW_API_BASE_URL` | **не задан** (prod `https://api.earflow.ru`) |

**Product → Clean Build Folder** (⇧⌘K) → **Run** (⌘R).

**Capability (должно быть в проекте):** `UIBackgroundModes` → `audio` (`ios-app/project.yml` / Signing & Capabilities → Background Modes → Audio).

---

## 1. iPhone Playback Smoke — сценарий

Выполнять **по порядку**. Фиксировать evidence после каждого блока.

### A. Launch + первый play

1. Clean build + Run на real iPhone.
2. Login (если guest).
3. Запустить **один** трек с главной / каталога.
4. **Логи (первые ~30 строк после launch + момент play):**
   - **Нет** `audio session category failed`
   - **Нет** `OSStatus -50` / `SessionCore.mm:546 Failed to set properties`
   - Допустимо: `[app] bootstrap`, `[playback] play track`, `[playback] session ready`, `[playback] engine ready`, `intent=session_activate result=ok appState=active`
   - **Нет** `audio_session_category_failed` / `audio_session_activate_failed` (legacy); вместо них: `intent=session_configure result=fail` или `intent=session_activate result=fail`
   - **Нет** `userId=157` (или любого numeric internal id) — ожидается `user=@username` или `account`
   - **Нет** значений stream tickets / cookies / `st=`, `mp_hls` (только `[REDACTED]` или boolean `token=true`)

**Evidence:** скопировать лог первых 30 строк после launch + строки play → session ready → engine ready.

### B. Lock screen + background audio (60+ сек)

5. Пока трек играет — **заблокировать телефон** (кнопка питания).
6. **Звук продолжается минимум 60 секунд** (не останавливается через 2–5 с).
7. На lock screen видны **метаданные** (title/artist) и **контролы** play/pause (и next, если очередь >1).

**Evidence:** заметка «звук шёл N секунд с заблокированным экраном»; скрин lock screen controls.

### C. Lock screen controls (реальный звук, не только progress)

8. **Pause** на lock screen → звук **останавливается**.
9. **Play** на lock screen → звук **реально возвращается** (не только движение progress в UI).
10. **Next** на lock screen (если есть очередь) → следующий трек **играет**; допустима нормальная загрузка HLS, **не** 2–3 с «мёртвого» состояния сверх сетевой задержки.

**Evidence:** лог фрагмента play → lock → pause → play → next (без секретов).

### D. Foreground consistency + track switch

11. **Разблокировать** телефон → UI state (playing/paused, трек, progress) **совпадает** с реальным звуком.
12. Переключить **3–5 треков подряд** в foreground (mini bar / full player).
    - **Нет** полного auth bootstrap на **каждый** switch (`POST /api/auth/refresh` + `GET /api/profile` + `bootstrap authenticated` на каждый next — недопустимо).
    - Допустим редкий refresh при реальном 401, не на каждый трек.

**Evidence:** лог 3–5 переключений; скрин mini bar / player после возврата в app.

### E. Cold-start auto-resume (опционально в том же прогоне)

13. Play → seek в середину → **swipe-kill** из app switcher → переоткрыть.
14. Mini bar **не пуст**; тот же трек; воспроизведение **продолжается само** (auto-resume) или явно документировать отклонение.

---

## 2. Acceptance checklist (все пункты — для CLOSED)

Скопировать в отчёт / PR / `DECISIONS.md` при закрытии:

```text
[ ] no OSStatus -50 on device
[ ] background audio continues when phone locked (≥60s)
[ ] lock screen play/pause works with real sound
[ ] lock screen next works
[ ] progress never runs while audio is silent (UI matches AVPlayer)
[ ] no auth bootstrap on every track switch
[ ] no internal numeric userId in client logs
[ ] no stream tickets / cookies / st / mp_hls values in logs
[ ] verify:ios-native PASS (build + unit tests)
```

**Минимальный evidence bundle:**

| Артефакт | Что снять |
|----------|-----------|
| Launch log | Первые ~30 строк после launch + play |
| Lock flow log | play → lock → pause → play → next |
| Lock screen | Скрин controls + metadata |
| Foreground | Скрин player после unlock; state = sound |
| Switch log | 3–5 треков без auth storm |

---

## 3. Если FAIL — куда смотреть

| Симптом | Следующий шаг |
|---------|----------------|
| `OSStatus -50` / `audio session category failed` сразу после launch | Прислать **первые 30 строк** лога; проверить `NowPlayingController` (не `setCategory` в `init`; category `.playback` без `.allowAirPlay`) |
| `561015905` / `intent=session_activate result=fail code=561015905` | `!pux` — activate в `.inactive` до первого `.active`. Ожидается `result=deferred reason=cannot_start_playing` + `intent=session_retry result=ok source=didBecomeActive`. Lock screen play: `result=ok appState=background` |
| Звук стоп при lock, progress идёт | AVAudioSession не active — ищите `intent=session_activate result=deferred|fail`; `PEND-IOS-005` остаётся OPEN |
| Play на lock screen — progress без звука | Проверить `intent=session_activate result=ok appState=background` перед resume |
| Switch >2 с каждый раз | **Не** возвращать auth refresh в hot path; следующий фокус: HLS session latency, prefetch next, `AVPlayerItem` prewarm (`DECISIONS.md`) |
| `userId=157` в логах | Регрессия log redaction — `UserProfile.logSafeHandle` |
| Auth refresh на каждый next | Регрессия `revalidateSession` debounce / `preferRefresh: false` на foreground |

---

## 4. Закрытие gate (только после PASS на iPhone)

1. Удалить или пометить **CLOSED** запись `PEND-IOS-005` в `docs/PENDING.md`.
2. Prepend в `docs/DECISIONS.md`: «iPhone background playback smoke PASS» + дата + device model/iOS.
3. Обновить `ios-app/.project-memory/CURRENT_STATE.md`, `HANDOFF.md`, `CHANGELOG.md`.
4. Указать SHA коммита и номер тестов `verify:ios-native`.

**Не закрывать** gate по одному только «звук в foreground заработал» или по зелёным unit-тестам.

---

## 5. Автоматическая проверка перед device smoke

```bash
cd /Users/earflow/Downloads/music-platform
npm run verify:ios-native
```

Ожидание: build CLOSED + tests CLOSED (число тестов — в отчёте verify; на момент P0-фикса: **91**).

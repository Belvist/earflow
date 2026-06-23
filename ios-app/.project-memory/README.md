# iOS Project Memory — Index

**Pack:** `universal_project_agent_pack/.project-memory/` (шаблон)  
**Earflow iOS:** эта папка — **живая память** модуля `ios-app/`.

## Обязательный порядок для агента

1. **`AGENT_WORKFLOW.md`** ← начни здесь
2. `CURRENT_STATE.md` — что сделано сейчас
3. `BACKEND_FRONTEND_CONTRACT.md` — экран, который меняешь
4. `STATE_MACHINES.md` + `API_CONTRACTS.md`
5. Monorepo: `docs/IOS_APP.md`, `docs/PENDING.md` (`PEND-IOS-001`)

## Файлы

| File | Purpose |
|------|---------|
| `AGENT_WORKFLOW.md` | DoD, запреты, скиллы, обновление памяти |
| `PROJECT_CONTEXT.md` | Продукт, bundle, домены |
| `CURRENT_STATE.md` | Фазы, implemented / not implemented |
| `ARCHITECTURE.md` | Слои, границы модулей |
| `DOMAIN_MODEL.md` | Client DTOs |
| `STATE_MACHINES.md` | Auth, Playback, DeviceSync |
| `BACKEND_FRONTEND_CONTRACT.md` | Экран ↔ API |
| `API_CONTRACTS.md` | Endpoints |
| `OBSERVABILITY.md` | EarflowLog, redaction |
| `SECURITY_NOTES.md` | Keychain, PoP, threats |
| `TESTING.md` | Unit + smoke |
| `TASKS.md` | P0/P1/P2 backlog |
| `CHANGELOG.md` | История фаз |

## После каждой задачи

Обновить минимум: `CURRENT_STATE.md` + `CHANGELOG.md`; при новом API — `BACKEND_FRONTEND_CONTRACT.md`.

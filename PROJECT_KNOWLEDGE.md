# PROJECT_KNOWLEDGE.md — Patzer (знания о проекте)

> Ориентируйся на этот файл при любой работе в репозитории. Обновляй его при изменениях.

## 1. Что это

**Patzer** — self-hosted шахматный сервис («свой Chess.com»): анализ игр Stockfish,
Play vs Bot / PvP, тренажёры, мульти-юзерность с админкой. Один Docker-контейнер.

- **Монорепо**: `server/` (Node + TypeScript + Hono + better-sqlite3 + WebSocket), `web/` (React + Vite + Tailwind + zustand + react-query + i18next).
- Тесты: `vitest` (server/test, web/src/**\/*.test.*), e2e в `server/test/e2e/`.
- Язык UI: i18n, 5 локалей `web/src/locales/{en,de,ru,bg,es}.json`.
  **Важно:** `locales.test.ts` требует полного паритета ключей `de` и `ru` с `en`
  (у `ru` — ещё 4 формы множественного числа). `bg`/`es` — частичные, fallback на `en`.

## 2. Структура сервера (`server/src/`)

- `index.ts` — Hono-приложение: security-заголовки (CSP), CORS для localhost,
  CSRF-гард (все не-GET `/api/*` требуют заголовок `X-Requested-With: patzer`),
  маунты роутов по префиксам, статика `web/dist`, WS-хендлеры, фоновый Chess.com-синк.
- `config.ts` — env (PORT, HOST, DB_PATH, OIDC_*, SESSION_SECRET, STOCKFISH_PATH, COOKIE_SECURE…).
- `db.ts` — вся схема: `CREATE TABLE IF NOT EXISTS` + `ensureColumn()` (идемпотентные
  миграции). Таблицы: `users, profiles, sessions, settings, games, analyses, challenges,
  ratings, rating_history, puzzle_attempts, opening_misses, learn_progress,
  tactics_attempts, tactics_ratings, goals, achievements_unlocked, auth_tokens, invites,
  live_bot_games, oidc_identities`. Доступ к настройкам: `getSetting()/setSetting()`
  (таблица `settings` key/value).
- `auth/` — middleware (requireAuth/requireAdmin), bcrypt(12), токены, инвайты, сессии, OIDC.
- `chess/` — движок и правила (НЕ ИИ): stockfish, classifier (классификация ходов
  Brilliant…Blunder), accuracy, glicko, keyMoments, gamePuzzles (пазлы из твоих игр),
  tacticsSet.json, openings, explorer, pvpGames, takeback и т.д.
- `routes/` — REST-роуты, маунтся в `index.ts`: meta, setup, auth, settings, admin,
  games, analyze, lobby, challenges, players, stats, ratings,
  insights(+v2), train, tactics, openings, plan, achievements, learn.
- `ws/play.ts` — живые партии (1163 строк), `ws/lobby.ts` — лобби.
- `autoImport.ts` — фоновый синк Chess.com → анализ.

## 3. Фронт (`web/src/`)

- `App.tsx` — роутинг: `/setup` (first-run wizard), auth-страницы, дальше Layout:
  `/` Home, `/play`, `/review`, `/review/:id` (GameAnalyzer), `/insights`, `/train`,
  `/learn`, `/openings`, `/plan`, `/lab`, `/players`, `/settings`,
  admin-only `/admin/users`, `/admin/system`.
- `pages/` — 20 страниц; `components/` — ~40 компонентов; `state/auth.ts` — zustand-стор
  профиля; `api.ts` — fetch-обёртка (автоматически ставит `X-Requested-With`).
- `lib/` — утилиты (markdown-рендерер, TTS, звуки, classification, gamePuzzle…).
- Ключевая архитектурная черта: анализ и факты считаются **сервером**
  (Stockfish + chess.js), фронт только отрисовывает.

## 4. Настройки и регистрация (НЕ-ИИ, остаются)

- **Регистрация**: `POST /api/auth/register` — username/password/display_name/email/
  language/invite (rate-limit, инвайты, bcrypt). UI: `pages/Signup.tsx`.
  Инвайты несут пресеты `language`/`audience`.
- **First-run wizard**: `pages/Setup.tsx` → `POST /api/setup/init` (username, password,
  display_name, language).
- **Профиль-настройки**: `pages/Settings.tsx` → `PATCH /api/settings/profile`
  (zod-схема в `routes/settings.ts`): display_name, avatar, language, audience,
  chesscom/lichess username, темы доски/фигур/сайта, звуки, blunder_warning,
  kid_piece_emotions, TTS (голос/скорость).
- **Админ-система**: `pages/admin/System.tsx` → `GET/PATCH /api/admin/system`:
  Stockfish path, signup mode (open/invite/closed), email verification, notify-admin,
  public base URL, SMTP + тест-письмо, update-check.
- **Админ-пользователи**: `pages/admin/Users.tsx` (CRUD), `pages/admin/Invites.tsx`.
- Настройки LLM жили в `settings` (ключи `llm_provider, ollama_*, vllm_*, deepseek_*`)
  и в env `DEEPSEEK_API_KEY` — **удалены** (см. §5).

## 5. ИИ-фичи — ЧТО БЫЛО И ЧТО УДАЛЕНО (актуальное состояние)

ИИ-часть сервиса (AI-Coach на LLM + AI Game Report) **полностью удалена** по задаче
«убрать все ИИ-фишки». Карта удалённого:

### Удалено целиком (файлы)
- `server/src/coach/` — весь каталог: `llm.ts` (провайдеры ollama/vllm/deepseek,
  chatStream/chatJson/testConnection), `coaching.ts`, `explain.ts`, `review.ts`
  (AI Game Report), `facts.ts`, `facts-utils.ts`, `locales.ts` (промпты), `memory.ts`,
  `moves.ts`, `prompts.ts`, `connectionHint.ts`, `tactics.ts` (детерминированные
  факты «почему ход плохой» — были нужны только коучу).
- `server/src/routes/coach.ts` — `/api/coach/status|explain|hint` (SSE).
- `server/src/routes/review.ts` — `GET/POST /api/games/:id/review` (AI-проза, кэш в
  `analyses.prose_*`).
- `server/src/autoReview.ts` — фоновый воркер генерации AI-отчёта (`kickAutoReview`).
- `web/src/components/CoachPanel.tsx` (+`CoachPanel.test.ts`) — SSE-панель коуча.
- `web/src/components/GameReportPanel.tsx` — генератор AI Game Report (SSE).
- `web/src/lib/markdown.ts` → функция `stripReasoning()` (чистка `<thinking>`-блоков
  перед TTS) — удалена; `stripMarkdown` остался (нужен TTS и ChangelogModal).

### Изменённые файлы (server)
- `index.ts` — убраны импорты/маунты `coachRoutes`, `reviewRoutes`.
- `routes/setup.ts` — убраны `isPrivateOllamaUrl()`, `POST /test-ollama`, поля
  `ollama_url/ollama_model` из `/init`.
- `routes/admin.ts` — убраны LLM-поля из GET/PATCH `/system`, эндпоинты
  `POST /test/ollama`, `POST /test/ollama-models`, `coach_behavior` из CRUD юзеров.
- `routes/settings.ts` — убран `coach_behavior` из profileSchema.
- `routes/auth.ts`, `auth/oidc.ts`, `routes/setup.ts` — убран `coach_behavior`
  из INSERT в `profiles`.
- `ws/play.ts` — убраны `kickAutoReview()`, авто-коуч (`coach_chunk`/`coach_done`),
  импорты `chatStream/llmConfigured`.
- `autoImport.ts` — убран вызов `kickAutoReview()`.
- `db.ts` — убраны колонка `profiles.coach_behavior` (из CREATE TABLE) и
  `ensureColumn` для `analyses.prose_json/prose_version/prose_lang/prose_audience`
  (старые БД сохраняют колонки — это безопасно, код их не читает).
- `types.ts` — убраны `CoachBehavior` и `Profile.coach_behavior`.
- `email/mailer.ts` — приветственное письмо без упоминания AI-коуча.

### Изменённые файлы (web)
- `components/MoveExplanation.tsx` — **не удалён**: карточка «Why this move?»
  (win-chance, «engine wanted», кнопка «Play from here») — не-ИИ фича. Из неё
  убран блок `<CoachPanel>` и пропсы `coachConfigured/coachRequest`.
- `pages/Settings.tsx` — убрана секция «Coach» и `coach_behavior` из формы/submit.
- `pages/Setup.tsx` — убран шаг 2 «Connect Ollama» (мастер теперь без LLM-шага).
- `pages/admin/System.tsx` — убрана карточка «Ollama (AI Coach)» (провайдер/URL/
  DeepSeek-ключ/тесты моделей/Runtime-панель). Остались Stockfish/Signup/SMTP.
- `pages/admin/Users.tsx` — убран селект `coach_behavior`.
- `pages/Play.tsx` — убраны запрос `/api/coach/status`, `showAlwaysCoach`,
  `coachReq`, рендер `<CoachPanel>`; `lastClassifiedMove` оставлен (нужен для
  бейджа классификации на доске).
- `pages/GameAnalyzer.tsx` — убраны таб «AI report», `MoveExplanation`,
  `GameReportPanel`, статус коуча, загрузка `reviewProse` (`GET /api/games/:id/review`),
  AI-проза в `OpeningBanner`/`KeyMomentsList`.
- `pages/Train.tsx` — убран блок коуча «why the engine's move beats yours» +
  `/api/coach/status`; `playedMoveArrow` (красная стрелка) оставлен — это engine-фича.
- `state/auth.ts` — убраны `CoachBehavior` и `coach_behavior`.
- `lib/gamePuzzle.ts` — убран `coachRequest()` (остались `GamePuzzle`, `playedMoveArrow`).
- `components/KeyMomentsList.tsx`, `components/OpeningBanner.tsx` — убраны
  опциональные AI-проза-пропсы (`title/prose`).
- Локали — удалены ключи `coach.*`, `settings.coachDesc/coachBehavior`,
  `admin.ollama*/vllm*/deepseek*/llmDesc/coachCalls/noCoachCall`,
  `setup.ollama*/llmHint.*`, `review.gameReport*/generateReport/generating`,
  `train.mine.coachTitle`, `review.why.coachSays` и т.п. (паритет de/ru сохранён).

### Удалённые/обновлённые тесты
- Удалены: `server/test/{coach-coaching,coach-german,coach-russian,coach-tactics,
  coach-prompts-facade,llm-providers,connection-hint,review-perspective}.test.ts`,
  `web/src/components/CoachPanel.test.ts`.
- Обновлены: `train-review.test.ts` (без коуча), `oidc-first-run.test.ts` (без
  `/test-ollama`), `web/src/lib/gamePuzzle.test.ts` (без `coachRequest`),
  `web/src/pages/admin/System.test.tsx` (теперь проверяет Stockfish-path, без LLM-моков).

### Тексты в локаях — переформулированы (не только удалены)
Используемые строки, где «coach/тренер» был ИИ-персоной, переписаны во всех
5 локалях: `settings.subtitle`, `settings.audienceHelp`, `settings.ttsDesc`,
`settings.ttsPreviewText`, `settings.adminHint` (теперь «(Stockfish, signups)»),
`home.settingsDesc`. Остальные ИИ-ключи просто удалены.

### Документация и конфиги — вычищены
- `README.md`, `docs/index.html`, `docs/FAQ.md`, `docs/OIDC.md`,
  `docs/unraid/patzer.xml`, `docs/diagrams/architecture-{light,dark}.svg` —
  без «AI-coached», Ollama/vLLM/DeepSeek, карточки AI Coach и comparison-строк.
- `SECURITY.md`, `CONTRIBUTING.md` (правило «server computes, browser renders»
  вместо «coach teaches»), `ROADMAP.md`, `cloudinabottle.toml`,
  `web/index.html`, `web/public/manifest.webmanifest`, `package.json`
  (description), `docker-compose.yml` (комментарии `extra_hosts` про Ollama),
  `.env.example`.
- `.github/ISSUE_TEMPLATE/coach-hallucination.yml` — удалён; из `feature.yml`
  убрана опция «AI Coach».
- **Оставлено как история**: `CHANGELOG.md`, исторические строки релизов в
  `ROADMAP.md`, благодарности в `CONTRIBUTORS.md`.
- **Не тронуто**: `docs/screenshots/*.png` — на скриншотах старого UI ещё виден
  Coach-панель (картинки, править вручную не стали).

### Проверка (после всей зачистки)
- `npm run typecheck` — чисто; `npx vitest run` — **39 файлов / 391 тест, все зелёные**
  (после добавления турниров — 41 файл / 425 тестов, см. §5a).
- Скрипт-сверка: все `t('…')`-ключи в `web/src` есть в `en.json` (лишних удалённых
  ключей код не использует); в `de`/`ru` паритет с `en` соблюдён.

### Что НЕ является ИИ и осталось (не трогать!)
- `ThreatPanel` («What's the threat?») — чистый Stockfish `/api/analyze/position`.
- `GameReportCard` — engine-статистика партии (accuracy/elo/фазы), не AI.
- `KeyMomentsList`, `OpeningBanner` (без прозы), `EvalGraph`, `LinesPanel`,
  `ExplorerPanel`, `Classifier`, `TacticsPuzzles`, `gamePuzzles` (пазлы) — engine/chess.js.
- Learn-уроки с `LessonBubble` (бывш. `CoachBubble`) — статичный контент, LLM нет.
- TTS (`lib/tts.ts`), звуки, piece emotions, kid-mode — не ИИ.
- `markdown.ts` (рендерер) — используется ещё и ChangelogModal'ом.
- `audience` (kid/beginner/intermediate/advanced) — общий профиль-параметр
  (kid-mode, пресеты инвайтов), НЕ только для коуча — оставлен.

## 5a. Турниры (олимпийская система, добавлено v7.20)

Турнир — это выбывающая сетка на этом же сервере. Создаёт её админ, игроки
вступают по ссылке, стартует админ — и только тогда.

### Сервер
- `server/src/tournament/engine.ts` — весь движок: коды, вступление, посев,
  генерация раундов, очки, выбывание, восстановление.
- `server/src/routes/tournaments.ts` — player-API (`/api/tournaments`):
  `GET /code/:code` (публично — гость видит, о чём турнир), `POST /code/:code/join`,
  `GET /` (мои турниры), `GET /:id` (сетка + таблица), `GET /matches/:id/info`
  (настройки ботового матча), `POST /matches/:id/claim` (забрать свою партию).
- `server/src/routes/adminTournaments.ts` — админ-API (`/api/admin/tournaments`):
  создание, старт (согласие админа), отмена, решение матча вручную.
- Таблицы: `tournaments`, `tournament_players`, `tournament_matches`;
  в `games` добавлена колонка `tournament_match_id`, в `live_bot_games` — тоже.
  Источник `games.source` расширен значением `'tournament'` (миграция
  `widenGamesSourceCheck`).

### Правила
- **Формат:** олимпийская система (на выбывание). Раунды строятся динамически:
  в каждом раунде оставшиеся игроки соревнуются попарно.
- **Бот вместо bye:** если в раунде нечётное число игроков, «лишний» играет с
  Stockfish'ом на силе, которую выбрал админ (см. `tournament.bot_difficulty`).
  Бот **никого не выбивает** — человек всегда проходит дальше, но результат
  (победа/ничья/поражение) идёт в очки турнира.
- **Рейтинг:** турнирные партии `rated = 0` — Glicko-рейтинг не двигается.
  Счёт турнира отдельный (`tournament_players.points`: 1 / 0.5 / 0).
  Турнирные партии исключены из `/api/stats/me` и из рекорда в `/api/players`.
- **Ничья** между людьми = переигровка: новая партия для тех же двоих,
  никто не выбывает. (Турнир — на выбывание, «победил сильнейший» тут нечестно.)
- **Посев** — по рейтингу в пуле времени турнира, лучший ходит первым;
  в каждой паре лучший из двоих играет белыми.
- **Партии создаются лениво** (`claimMatch`): незаигранная пара не появляется
  в списке игр игрока. У каждого свой ряд `games` (как у PvP), сокет находит
  свой по `user_id`.
- **Восстановление:** `recoverTournaments()` при старте сервера заново
  применяет результаты, которые были сыграны, но не попали в сетку (сервер
  упал между «партия кончилась» и «турнир узнал»). Идемпотентно.
- **Ручное решение:** админ может решить матч, в который один игрок не
  пришёл (`POST /api/admin/tournaments/:id/matches/:matchId/resolve`).

### Фронт
- `web/src/pages/Tournaments.tsx` — список турниров + вход по коду; у открытого
  турнира, в котором игрок ещё не участвует, кнопка «Вступить».
- `web/src/pages/Tournament.tsx` — сетка раундами, таблица очков, «твоя партия»,
  кнопка «Вступить» (пока турнир не начат) и плашка «новые игроки не присоединяются»
  (после старта).
- `web/src/pages/TournamentJoin.tsx` — страница-приглашение `/tournaments/join/:code`
  (работает и для гостя — показывает, что это за турнир, и просит войти; если турнир
  уже начат — говорит, что места заняты).
- `web/src/pages/admin/Tournaments.tsx` — **отдельная страница** `/admin/tournaments`
  (пункт в админ-меню «Admin» в шапке, в мобильном меню и в палитре команд):
  создание, **ссылка-приглашение (копирование + «поделиться»)**, список
  подключившихся, кнопка «Старт» (недоступна, пока игроков меньше двух), отмена.
  Раньше это был раздел внизу страницы «Admin → Users» — его было легко не
  найти, поэтому вынесено на отдельную страницу.
- `/play?tournament=<matchId>` — ботовая партия турнира: настройки (сила, часы,
  цвет) берёт сервер, клиент их не выбирает.

### Правило «после старта новые игроки не подключаются»
- Сервер: `joinTournament` возвращает `tournament_started` / `tournament_finished` /
  `tournament_cancelled` — вход закрыт для всех статусов кроме `open`.
- `startTournament` требует минимум двух игроков (`not_enough_players`), иначе
  турнир остаётся открытым — второй игрок ещё может прийти.
- Клиент: страница-приглашение и страница турнира показывают, что дверь закрыта,
  и не предлагают кнопку входа.
- Есть и запасной путь: `POST /api/tournaments/:id/join` — вступить можно и со
  страницы турнира, найденной в списке (та же проверка статуса).

### Локали
Ключи `tournament.*` и `admin.tournaments*` — во всех 5 локалях; `review.source.tournament`
тоже добавлен. Правило паритета `de`/`ru` ↔ `en` соблюдено.

### Проверка
- `npm run typecheck` — чисто; `npx vitest run` — **42 файла / 442 теста**.
- `server/test/tournament.test.ts` — 32 теста движка (посев, бот вместо bye,
  ленивое создание партии, очки, ничья-переигровка, восстановление, ручное решение,
  фильтр общей статистики, закрытый набор после старта, минимум два игрока).
- `web/src/pages/Tournaments.test.tsx` — 12 тестов UI (список, вход по коду,
  сетка, таблица, кнопка «Играть», вступление с страницы турнира, закрытый
  турнир, страница-приглашение для гостя и для участника).
- `web/src/pages/admin/Tournaments.test.tsx` — 7 тестов админ-консоли (ссылка,
  кнопка создания наверху страницы, список подключившихся, старт, блокировка
  старта с одним игроком, создание и выдача ссылки, предупреждение о закрытии
  набора).
- `npm run test:tournament` — e2e всего цикла на живом сервере (создание →
  ссылка → вступление → старт → партия → сетка двинулась).
- `npm run test:tournament-restart` — e2e с **перезапуском сервера**: турнир,
  сыгранная партия и результат переживают kill сервера; админ может
  дорешать незакрытый матч.
- Проверено вживую в браузере: админ-консоль (ссылка + «поделиться» + список
  участников), страница-приглашение (гость / участник / закрытый турнир),
  список турниров с кнопкой «Вступить», страница турнира с кнопкой входа.

## 6. Окружение / запуск

- `.env.example` — только не-ИИ переменные (PORT, HOST, DB_PATH, STOCKFISH_PATH,
  SESSION_SECRET, SMTP_*, PUBLIC_BASE_URL, OIDC_*, UPDATE_CHECK). Упоминаний
  Ollama/коуча нет.
- `setup.sh` / `build.dev.sh` / `run.dev.sh` / `deploy.sh` / `docker-compose.yml` /
  `Dockerfile` — сборка и деплой; комментариев про Ollama в `docker-compose.yml`
  больше нет.
- Запуск dev: `run.dev.sh` (server + vite). Тесты: `npm test` (корневой `vitest.config.ts`).

## 7. Правила при работе

1. Любая правка локалей — синхронизировать `de` и `ru` с `en` (иначе упадёт
   `locales.test.ts`), plural-ключи `ru` в 4 формах.
2. Не-GET `/api/*` с фронта — только через `web/src/api.ts` (CSRF-заголовок).
3. Миграции БД — только идемпотентные (`ensureColumn`/`CREATE IF NOT EXISTS`),
   без правки уже созданных колонок.
4. Всё, что касается Stockfish/chess.js/классификации — это НЕ ИИ, не удалять.
5. После изменений: `npx tsc --noEmit` (server+web), `npm test`.

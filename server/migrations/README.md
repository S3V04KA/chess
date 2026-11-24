# Arena Database Migrations

Эти миграции можно безопасно применять на продакшен сервере без потери данных.

## Миграции

### 001_arena_players.sql
Создает таблицу `arena_players` для отслеживания участников арен с системой очков (2/1/0 за победу/ничью/поражение).

### 002_arena_matches.sql
Создает таблицу `arena_matches` для отслеживания активных матчей между игроками в аренах.

### 003_arena_pauses.sql
Создает таблицу `arena_pauses` для отслеживания пауз арен.

### 004_arenas_paused_column.sql
Добавляет колонку `paused` к таблице `arenas`.
- Применяется автоматически через `ensureColumn()` в `db.ts` при запуске сервера.

### 005_games_arena_match_id.sql
Добавляет колонку `arena_match_id` к таблице `games`.
- Применяется автоматически через `ensureColumn()` в `db.ts` при запуске сервера.

## Применение миграций на продакшене

### Способ 1: Автоматически (рекомендуется)
Просто перезапустите сервер после обновления кода. Миграции из `ensureColumn()` применятся автоматически при старте.

```bash
cd server
node dist/index.js
```

Для таблиц `arena_players`, `arena_matches`, `arena_pauses` нужно также обновить SCHEMA в `server/src/db.ts`.

### Способ 2: Вручную через SQLite
Если нужно применить миграции без перезапуска сервера:

```bash
cd server

# Применяем все SQL миграции последовательно
sqlite3 ../data/chess.db < migrations/001_arena_players.sql
sqlite3 ../data/chess.db < migrations/002_arena_matches.sql
sqlite3 ../data/chess.db < migrations/003_arena_pauses.sql

# Для колонок paused и arena_match_id нужно использовать ensureColumn() в коде
# Эти колонки добавятся автоматически при следующем запуске сервера
```

### Способ 3: Проверка применения миграций
Проверить, какие таблицы уже созданы:

```bash
sqlite3 ../data/chess.db "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%arena%';"
```

Проверить структуру таблицы:

```bash
sqlite3 ../data/chess.db ".schema arena_players"
```

## Примечания

- Все миграции используют `IF NOT EXISTS`, поэтому их можно запускать многократно без ошибок
- Миграции безопасны для продакшена - данные не теряются
- Для колонок, добавляемых через `ensureColumn()`, нужно обновить код и перезапустить сервер

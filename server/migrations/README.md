# Arena Database Migrations

⚠️ **WARNING**: These migrations will DROP existing arena tables and recreate them with correct schema. 
This will result in loss of arena participant data, but preserves other database data.

## Миграции

### 001_arena_players.sql
Создает таблицу `arena_players` с правильной схемой (`joined_at` вместо `created_at`).
**ВНИМАНИЕ**: Удаляет существующую таблицу перед созданием!

### 002_arena_matches.sql
Создает таблицу `arena_matches` для отслеживания активных матчей.
**ВНИМАНИЕ**: Удаляет существующую таблицу перед созданием!

### 003_arena_pauses.sql
Создает таблицу `arena_pauses` для отслеживания пауз арен.
**ВНИМАНИЕ**: Удаляет существующую таблицу перед созданием!

### 004_arenas_paused_column.sql
Добавляет колонку `paused` к таблице `arenas`.
- Применяется автоматически через `ensureColumn()` в `db.ts` при запуске сервера.

### 005_games_arena_match_id.sql
Добавляет колонку `arena_match_id` к таблице `games`.
- Применяется автоматически через `ensureColumn()` в `db.ts` при запуске сервера.

## Применение миграций на продакшене

### Автоматически (рекомендуется)
Миграции применяются автоматически при каждом запуске Docker контейнера через `docker-entrypoint.sh`.

```bash
# Пересоберите образ с новыми миграциями
docker-compose build --no-cache chess

# Перезапустите контейнер - миграции применятся автоматически
docker-compose up -d chess
```

### Проверка применения миграций
Проверить, какие таблицы уже созданы:

```bash
# Подключитесь к контейнеру
docker exec -it chess sh

# Проверьте схему таблицы через Node.js
node /app/check-schema.js
```

## Примечания

- Миграции удаляют существующие таблицы перед созданием новых
- Данные участников арен будут потеряны (но это необходимо для исправления схемы)
- Другие таблицы и данные не затрагиваются
- Для колонок `paused` и `arena_match_id` используется `ensureColumn()` - они добавятся автоматически при запуске сервера

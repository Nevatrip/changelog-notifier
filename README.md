# Changelog Notifier JavaScript Action

Это GH Action отправляет уведомление в Telegram при выпуске новой версии и экспортирует DORA метрики в Prometheus.

## Возможности

- **Telegram уведомления** - отправка changelog в Telegram при релизе
- **YouGile интеграция** - обогащение данных о задачах из YouGile
- **DORA метрики** - экспорт метрик DevOps производительности в Prometheus Pushgateway
  - Deployment Frequency (частота деплоев)
  - Lead Time for Changes (время от коммита до продакшена)
  - Change Failure Rate (процент неудачных деплоев)
  - Mean Time to Recovery (время восстановления после инцидентов)

## Входные параметры

### `prefixes`

Многострочная строка с префиксами Conventional Commits. По умолчанию `feat fix`.

### `token`

**Обязательно** Токен бота Telegram.

### `chat_id`

**Обязательно** ID чата Telegram.

### `yougile_api_key`

**Обязательно** API ключ для YouGile.

### `commits`

JSON-строка из payload github.event с массивом коммитов. Если не указано, считается, что коммиты берутся из текущего workflow.

### `pushgateway_url`

**Опционально** URL Prometheus Pushgateway для экспорта DORA метрик (например, `http://pushgateway:9091`). Если не указано, метрики не экспортируются.

### `environment`

**Опционально** Окружение деплоя (используется как label в метриках). По умолчанию `production`.

### `metrics_job_name`

**Опционально** Имя job для Prometheus метрик. По умолчанию `dora_metrics`.

## Пример использования

### Базовое использование (только Telegram)

```yaml
uses: egorpariah/changelog-notifier@v2.0
with:
  token: ${{ secrets.TELEGRAM_TOKEN }}
  chat_id: ${{ secrets.TELEGRAM_CHAT_ID }}
  yougile_api_key: ${{ secrets.YOUGILE_API_KEY }}
  prefixes: |-
    feat
    fix
    hotfix
```

### С экспортом DORA метрик

```yaml
name: Release and Deploy
on:
  push:
    tags:
      - 'v*'

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read  # Необходимо для GitHub API (Lead Time)

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      # ... ваши шаги деплоя ...

      - name: Notify Telegram and Push DORA Metrics
        uses: egorpariah/changelog-notifier@v2.0
        with:
          token: ${{ secrets.TELEGRAM_TOKEN }}
          chat_id: ${{ secrets.TELEGRAM_CHAT_ID }}
          yougile_api_key: ${{ secrets.YOUGILE_API_KEY }}
          project_name: "My Project"
          # DORA Metrics (опционально)
          pushgateway_url: ${{ secrets.PUSHGATEWAY_URL }}
          environment: "production"
          prefixes: |-
            feat
            fix
            hotfix
```

## DORA Метрики

### Обзор

Action автоматически собирает и экспортирует 4 ключевые DORA метрики + Cycle Time:

| Метрика | Описание | Prometheus Метрика |
|---------|----------|-------------------|
| **Deployment Frequency** | Частота деплоев | `deployment_total` |
| **Lead Time for Changes** | Время от первого коммита/PR до продакшена | `deployment_lead_time_seconds` |
| **Cycle Time** | Время от создания карточки до продакшена | `cycle_time_seconds` |
| **Change Failure Rate** | Процент неудачных деплоев | `deployment_failures_total` / `deployment_total` |
| **Mean Time to Recovery** | Время восстановления после инцидентов | `incident_recovery_time_seconds` |

**Примечание:** Cycle Time требует YouGile API и доступен только для коммитов с task ID (TECH-XXXX).

---

### Тестирование

Запустите локальный тест:

```bash
./test-metrics.sh
```

Подробности: [TEST-RESULTS.md](TEST-RESULTS.md)

## Интеграция с Yogile
Получить ID компании:
```
curl --request POST \
  --url https://ru.yougile.com/api-v2/auth/companies \
  --header 'Content-Type: application/json' \
  --data '{
  "login": "****",
  "password": "*****",
  "name": "Nevatrip"
}'
```
Ответ:
```
{"paging":{"count":1,"limit":50,"offset":0,"next":false},"content":[{"id":"4b3f1fb3-f5c0-42bf-ab94-129fed1fbadf","name":"Nevatrip","isAdmin":false}]}
```

Получить API ключ:
```
curl --request POST \
  --url https://ru.yougile.com/api-v2/auth/keys \
  --header 'Content-Type: application/json' \
  --data '{
  "login": "*****",
  "password": "*****",
  "companyId": "4b3f1fb3-f5c0-42bf-ab94-129fed1fbadf"
}'
```

Ответ:
```
{"key":"*****"}
```

## Локальный запуск
`
npm install
`

Создаём файл с коммитами commits.json:
```json
[
    {
        "message": "feat(TECH-1387): добавлен changelog",
        "author": {
            "username": "alice"
        }
    },
    {
        "message": "fix: Correct validation",
        "author": {
            "username": "bob"
        }
    }
]
```

```shell
export INPUT_YOUGILE_API_KEY="demo_key"
export INPUT_PREFIXES=$'feat\nfix\ndocs'
export INPUT_PROJECT_NAME="MyProj"
export GITHUB_REPOSITORY="Nevatrip/test"
```

Так при запуске вывод будет в консоль, но если нужно в телеграм, то ставим так же
```
export INPUT_TOKEN="<token>"
export INPUT_CHAT_ID="<chat_id>"
```

```shell
INPUT_COMMITS="$(cat commits.json)" node index.js
```

# Публикация
```
git tag -a -m "My first action release" v1.1
git push --follow-tags
```


### Как считаются DORA метрики

#### 1. Deployment Frequency (Частота деплоев)

**Что измеряет:** Как часто команда выпускает код в production.

**Как считается:**
- Каждый запуск action инкрементирует счетчик `deployment_total`
- Метрика: Counter (монотонно возрастающее значение)
- Labels: `project`, `repository`, `environment`

---

#### 2. Lead Time for Changes (Время выхода изменений)

**Что измеряет:** Время от первого коммита до деплоя в production.

**Как считается:**
1. Для каждого коммита в релизе:
   - Пытается найти связанный Pull Request через GitHub API
   - Если PR найден → берет `pr.created_at` как начальное время
   - Если PR не найден → берет `commit.timestamp` как fallback
2. Вычисляет: `deployment_time - commit_time = lead_time_seconds`
3. Записывает в histogram с buckets: 1min, 5min, 15min, 1h, 2h, 6h, 1d, 2d, 7d

**Источники данных:**
- GitHub API: `GET /repos/{owner}/{repo}/commits/{sha}/pulls`
- Fallback: commit timestamp из webhook payload

---

#### 3. Change Failure Rate (Процент неудачных изменений)

**Что измеряет:** Процент деплоев, которые привели к инциденту в production.

**Как определяется failure:**
Деплой считается неудачным, если в релизе присутствует **revert commit**:
- `revert:` или `revert(TASK-ID):`
- `Revert "..."` (стандартный git revert)
- `revert commit`
- `rollback`

**Как считается:**
1. Сканирует все коммиты в релизе
2. Если найден хотя бы один revert → инкрементирует `deployment_failures_total`
3. Всегда инкрементирует `deployment_total`

---

#### 4. Mean Time to Recovery (Время восстановления)

**Что измеряет:** Как быстро команда восстанавливает сервис после инцидента в production.

**Как считается:**

**Сценарий 1: Revert commit**
- Инцидент начался: `min(commit timestamps в релизе)` - берется самый ранний коммит
- Инцидент закончился: `deployment_time` - время запуска action
- MTTR = `deployment_time - earliest_commit_time`
- Label: `incident_type="revert"`

**Сценарий 2: Hotfix deployment**
- Определяется по имени ветки: `hotfix/`, `hotfix-`, `fix/`, `emergency/`
- Инцидент начался: `min(commit timestamps в ветке)`
- Инцидент закончился: `deployment_time`
- MTTR = `deployment_time - earliest_commit_time`
- Label: `incident_type="hotfix"`

---

#### 5. Cycle Time (Время цикла)

**Что измеряет:** Время от создания задачи в трекере до деплоя в production.

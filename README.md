# Changelog Notifier JavaScript Action

Это GH Action отправляет уведомление в Telegram при выпуске новой версии.

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

## Пример использования

```yaml
uses: egorpariah/changelog-notifier@v1.1
with:
  prefixes: |-
    feat
    fix
  TOKEN: tg-bot-token
  CHAT_ID: tg-chat-id
```

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
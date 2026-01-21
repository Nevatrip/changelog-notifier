#!/bin/bash

# DORA Metrics Test Script
# Тестирует отправку метрик в локальный Pushgateway

set -e

echo "🧪 DORA Metrics Test Script"
echo "=============================="
echo ""

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Проверка Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker не установлен. Установите Docker для запуска теста.${NC}"
    exit 1
fi

# Запуск Pushgateway если не запущен
echo -e "${BLUE}📦 Проверка Pushgateway...${NC}"
if ! docker ps | grep -q pushgateway; then
    echo -e "${YELLOW}⚠️  Pushgateway не запущен. Запускаю...${NC}"
    docker run -d --name pushgateway -p 9091:9091 prom/pushgateway
    sleep 2
    echo -e "${GREEN}✅ Pushgateway запущен на http://localhost:9091${NC}"
else
    echo -e "${GREEN}✅ Pushgateway уже запущен${NC}"
fi

echo ""
echo -e "${BLUE}🔧 Настройка переменных окружения...${NC}"

# Установка переменных окружения
export INPUT_TOKEN="dummy-token"
export INPUT_CHAT_ID="dummy-chat-id"
export INPUT_YOUGILE_API_KEY="dummy-api-key"
export INPUT_PROJECT_NAME="Nevatrip Test Project"
export INPUT_PREFIXES="feat
fix
hotfix
refactor
docs"
export INPUT_PUSHGATEWAY_URL="http://localhost:9091"
export INPUT_ENVIRONMENT="testing"
export INPUT_METRICS_JOB_NAME="dora_metrics_test"
export GITHUB_REPOSITORY="nevatrip/test-repo"
export GITHUB_REF="refs/heads/hotfix/critical-fix"
export GITHUB_TOKEN="${GITHUB_TOKEN:-dummy-token}"

# Загрузка тестовых коммитов
export INPUT_COMMITS=$(cat test-commits.json)

echo -e "${GREEN}✅ Переменные установлены${NC}"
echo "   Project: $INPUT_PROJECT_NAME"
echo "   Repository: $GITHUB_REPOSITORY"
echo "   Environment: $INPUT_ENVIRONMENT"
echo "   Ref: $GITHUB_REF"
echo ""

# Очистка старых метрик
echo -e "${BLUE}🧹 Очистка старых метрик...${NC}"
curl -X PUT http://localhost:9091/api/v1/admin/wipe || true
echo ""

echo -e "${BLUE}🚀 Запуск теста метрик...${NC}"
echo "=============================="
echo ""

# Запуск action (без отправки в Telegram, только метрики)
# Нужно замокать Telegram API
export INPUT_TOKEN=""
export INPUT_CHAT_ID=""

# Создаём простой тестовый скрипт
cat > test-runner.js << 'EOF'
const metricsModule = require('./metrics');
const github = require('@actions/github');

// Mock github context
github.context = {
  repo: {
    owner: 'nevatrip',
    repo: 'test-repo'
  },
  ref: process.env.GITHUB_REF
};

const commits = JSON.parse(process.env.INPUT_COMMITS);

console.log(`📊 Обработка ${commits.length} коммитов...`);
commits.forEach((c, i) => {
  console.log(`  ${i + 1}. ${c.message.substring(0, 60)}...`);
});
console.log('');

metricsModule.recordAndPushMetrics({
  commits,
  ref: process.env.GITHUB_REF,
  projectName: process.env.INPUT_PROJECT_NAME,
  repository: 'test-repo',
  pushgatewayUrl: process.env.INPUT_PUSHGATEWAY_URL,
  environment: process.env.INPUT_ENVIRONMENT,
  jobName: process.env.INPUT_METRICS_JOB_NAME,
  githubToken: process.env.GITHUB_TOKEN
}).then(() => {
  console.log('✅ Метрики успешно отправлены!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Ошибка:', error.message);
  process.exit(1);
});
EOF

node test-runner.js

echo ""
echo -e "${BLUE}📈 Получение метрик из Pushgateway...${NC}"
echo "=============================="
echo ""

# Получение метрик
METRICS=$(curl -s http://localhost:9091/metrics)

# Парсинг и отображение метрик
echo -e "${GREEN}🎯 DORA Metrics Results:${NC}"
echo ""

echo -e "${YELLOW}1. Deployment Frequency:${NC}"
echo "$METRICS" | grep "^deployment_total" | grep -v "^#" || echo "   No data"
echo ""

echo -e "${YELLOW}2. Lead Time for Changes:${NC}"
echo "$METRICS" | grep "^deployment_lead_time_seconds" | grep -v "^#" | head -5 || echo "   No data"
echo "   ..."
echo ""

echo -e "${YELLOW}3. Change Failure Rate:${NC}"
FAILURES=$(echo "$METRICS" | grep "^deployment_failures_total" | grep -v "^#" || echo "0")
echo "$FAILURES"
if [ "$FAILURES" = "0" ]; then
    echo "   Failure Rate: 0%"
else
    echo "   (Рассчитывается в Prometheus: failures_total / deployment_total)"
fi
echo ""

echo -e "${YELLOW}4. Mean Time to Recovery (MTTR):${NC}"
echo "$METRICS" | grep "^incident_recovery_time_seconds" | grep -v "^#" | head -5 || echo "   No data"
echo "   ..."
echo ""

echo -e "${GREEN}✅ Тест завершён!${NC}"
echo ""
echo -e "${BLUE}📊 Просмотр всех метрик в браузере:${NC}"
echo "   http://localhost:9091"
echo ""
echo -e "${BLUE}🔍 Полные метрики (curl):${NC}"
echo "   curl http://localhost:9091/metrics | grep -E '(deployment_|incident_)'"
echo ""

# Очистка
rm -f test-runner.js

# Опционально: остановка Pushgateway
read -p "Остановить Pushgateway? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    docker stop pushgateway
    docker rm pushgateway
    echo -e "${GREEN}✅ Pushgateway остановлен${NC}"
fi

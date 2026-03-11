/**
 * ClickHouse Client Module
 * Handles table provisioning and metric writes to ClickHouse
 */

const core = require('@actions/core');

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

/**
 * @param {number} ms
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ensure ClickHouse table exists, creating it if necessary
 * @param {Object} config
 * @param {string} config.clickhouseUrl
 * @param {string} [config.clickhouseUser]
 * @param {string} [config.clickhousePassword]
 * @param {string} [config.clickhouseDatabase]
 * @param {string} [config.clickhouseTable]
 */
async function ensureTableExists(config) {
    const {
        clickhouseUrl,
        clickhouseUser = 'default',
        clickhousePassword,
        clickhouseDatabase = 'default',
        clickhouseTable = 'dora_metrics'
    } = config;

    const ddl = [
        `CREATE TABLE IF NOT EXISTS ${clickhouseDatabase}.${clickhouseTable}`,
        '(',
        '  timestamp DateTime64(3),',
        '  measurement String,',
        '  project String,',
        '  repository String,',
        '  environment String,',
        '  has_task String,',
        '  incident_type Nullable(String),',
        '  count Nullable(Int32),',
        '  seconds Nullable(Float64)',
        ') ENGINE = MergeTree()',
        'ORDER BY (timestamp, measurement, project)'
    ].join(' ');

    const headers = { 'X-ClickHouse-User': clickhouseUser };
    if (clickhousePassword) headers['X-ClickHouse-Key'] = clickhousePassword;

    const response = await fetch(`${clickhouseUrl}/?query=${encodeURIComponent(ddl)}`, {
        method: 'POST',
        headers
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create ClickHouse table: HTTP ${response.status}: ${errorText}`);
    }

    core.info(`Table ${clickhouseDatabase}.${clickhouseTable} is ready`);
}

/**
 * Insert metrics into ClickHouse using JSONEachRow format
 * @param {Object[]} metrics - Array of metric row objects
 * @param {Object} config
 * @param {string} config.clickhouseUrl
 * @param {string} [config.clickhouseUser]
 * @param {string} [config.clickhousePassword]
 * @param {string} [config.clickhouseDatabase]
 * @param {string} [config.clickhouseTable]
 */
async function pushMetricsToClickHouse(metrics, config) {
    const {
        clickhouseUrl,
        clickhouseUser = 'default',
        clickhousePassword,
        clickhouseDatabase = 'default',
        clickhouseTable = 'dora_metrics'
    } = config;

    await ensureTableExists(config);

    const query = `INSERT INTO ${clickhouseDatabase}.${clickhouseTable} FORMAT JSONEachRow`;
    const url = `${clickhouseUrl}/?query=${encodeURIComponent(query)}&date_time_input_format=best_effort`;
    const body = metrics.map(row => JSON.stringify(row)).join('\n');

    const headers = {
        'Content-Type': 'application/json',
        'X-ClickHouse-User': clickhouseUser
    };
    if (clickhousePassword) headers['X-ClickHouse-Key'] = clickhousePassword;

    const response = await fetch(url, { method: 'POST', headers, body });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    core.info(`Pushed ${metrics.length} metrics to ${url}`);
}

/**
 * Push metrics to ClickHouse with retry logic
 * @param {Object[]} metrics
 * @param {Object} config
 * @param {number} maxRetries
 */
async function pushWithRetry(metrics, config, maxRetries) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await pushMetricsToClickHouse(metrics, config);
            core.info('Successfully pushed DORA metrics to ClickHouse');
            return;
        } catch (error) {
            if (attempt === maxRetries) {
                throw new Error(`Failed to push metrics after ${maxRetries} attempts: ${error.message}`);
            }
            const delay = RETRY_DELAY_MS * attempt;
            core.warning(`Push attempt ${attempt} failed, retrying in ${delay}ms: ${error.message}`);
            await sleep(delay);
        }
    }
}

module.exports = {
    ensureTableExists,
    pushMetricsToClickHouse,
    pushWithRetry,
    RETRY_ATTEMPTS,
    RETRY_DELAY_MS
};

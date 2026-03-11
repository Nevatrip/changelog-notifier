const {
    ensureTableExists,
    pushMetricsToClickHouse,
    pushWithRetry,
    RETRY_ATTEMPTS,
    RETRY_DELAY_MS
} = require('../src/clickhouse');

jest.mock('@actions/core', () => ({
    info: jest.fn(),
    warning: jest.fn()
}));

describe('ensureTableExists', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('sends CREATE TABLE IF NOT EXISTS DDL', async () => {
        global.fetch.mockResolvedValue({ ok: true });
        const config = { clickhouseUrl: 'http://localhost:8123', clickhouseDatabase: 'default', clickhouseTable: 'dora_metrics' };
        await ensureTableExists(config);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, opts] = global.fetch.mock.calls[0];
        expect(url).toContain('http://localhost:8123');
        expect(url).toContain('CREATE%20TABLE%20IF%20NOT%20EXISTS');
        expect(url).toContain('dora_metrics');
        expect(opts.method).toBe('POST');
    });

    test('sends X-ClickHouse-User header', async () => {
        global.fetch.mockResolvedValue({ ok: true });
        const config = { clickhouseUrl: 'http://localhost:8123', clickhouseUser: 'admin', clickhousePassword: 'secret' };
        await ensureTableExists(config);

        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.headers['X-ClickHouse-User']).toBe('admin');
        expect(opts.headers['X-ClickHouse-Key']).toBe('secret');
    });

    test('omits X-ClickHouse-Key when no password provided', async () => {
        global.fetch.mockResolvedValue({ ok: true });
        const config = { clickhouseUrl: 'http://localhost:8123' };
        await ensureTableExists(config);

        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.headers['X-ClickHouse-User']).toBe('default');
        expect(opts.headers['X-ClickHouse-Key']).toBeUndefined();
    });

    test('throws on HTTP error', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'DB error' });
        const config = { clickhouseUrl: 'http://localhost:8123' };
        await expect(ensureTableExists(config)).rejects.toThrow('HTTP 500');
    });
});

describe('pushMetricsToClickHouse', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('calls ensureTableExists then inserts metrics', async () => {
        global.fetch.mockResolvedValue({ ok: true });
        const metrics = [{ timestamp: '2024-01-01T00:00:00.000Z', measurement: 'deployment', count: 1 }];
        const config = { clickhouseUrl: 'http://localhost:8123' };

        await pushMetricsToClickHouse(metrics, config);

        expect(global.fetch).toHaveBeenCalledTimes(2); // DDL + INSERT
    });

    test('sends metrics as newline-separated JSONEachRow body', async () => {
        global.fetch.mockResolvedValue({ ok: true });
        const metrics = [
            { timestamp: '2024-01-01T00:00:00.000Z', measurement: 'deployment', count: 1 },
            { timestamp: '2024-01-01T00:00:00.000Z', measurement: 'lead_time', seconds: 3600 }
        ];
        const config = { clickhouseUrl: 'http://localhost:8123' };

        await pushMetricsToClickHouse(metrics, config);

        const [, opts] = global.fetch.mock.calls[1];
        const expectedBody = metrics.map(r => JSON.stringify(r)).join('\n');
        expect(opts.body).toBe(expectedBody);
    });

    test('sends INSERT query with correct database and table', async () => {
        global.fetch.mockResolvedValue({ ok: true });
        const config = { clickhouseUrl: 'http://localhost:8123', clickhouseDatabase: 'metrics_db', clickhouseTable: 'my_metrics' };

        await pushMetricsToClickHouse([{ measurement: 'deployment' }], config);

        const [url] = global.fetch.mock.calls[1];
        expect(url).toContain('metrics_db.my_metrics');
        expect(url).toContain('FORMAT%20JSONEachRow');
    });

    test('sends authentication headers', async () => {
        global.fetch.mockResolvedValue({ ok: true });
        const config = { clickhouseUrl: 'http://localhost:8123', clickhouseUser: 'user1', clickhousePassword: 'pass1' };

        await pushMetricsToClickHouse([{ measurement: 'deployment' }], config);

        const [, opts] = global.fetch.mock.calls[1];
        expect(opts.headers['X-ClickHouse-User']).toBe('user1');
        expect(opts.headers['X-ClickHouse-Key']).toBe('pass1');
    });

    test('omits X-ClickHouse-Key when no password provided', async () => {
        global.fetch.mockResolvedValue({ ok: true });
        const config = { clickhouseUrl: 'http://localhost:8123' };

        await pushMetricsToClickHouse([{ measurement: 'deployment' }], config);

        const [, opts] = global.fetch.mock.calls[1];
        expect(opts.headers['X-ClickHouse-Key']).toBeUndefined();
    });

    test('throws on HTTP error from INSERT', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Service Unavailable' });
        const config = { clickhouseUrl: 'http://localhost:8123' };

        await expect(pushMetricsToClickHouse([{ measurement: 'deployment' }], config))
            .rejects.toThrow('HTTP 503');
    });

    test('uses default database and table when not specified', async () => {
        global.fetch.mockResolvedValue({ ok: true });
        const config = { clickhouseUrl: 'http://localhost:8123' };

        await pushMetricsToClickHouse([{ measurement: 'deployment' }], config);

        const [url] = global.fetch.mock.calls[1];
        expect(url).toContain('default.dora_metrics');
    });

    test('sends Content-Type application/json header', async () => {
        global.fetch.mockResolvedValue({ ok: true });
        const config = { clickhouseUrl: 'http://localhost:8123' };

        await pushMetricsToClickHouse([{ measurement: 'deployment' }], config);

        const [, opts] = global.fetch.mock.calls[1];
        expect(opts.headers['Content-Type']).toBe('application/json');
    });
});

describe('pushWithRetry', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test('pushes successfully on first attempt', async () => {
        global.fetch.mockResolvedValue({ ok: true });
        const metrics = [{ measurement: 'deployment', count: 1 }];
        const config = { clickhouseUrl: 'http://localhost:8123' };

        await pushWithRetry(metrics, config, 3);

        expect(global.fetch).toHaveBeenCalledTimes(2); // DDL + INSERT
    });

    test('retries after transient failure and succeeds on second attempt', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: true });
        const config = { clickhouseUrl: 'http://localhost:8123' };

        const promise = pushWithRetry([{ measurement: 'deployment' }], config, 3);
        await jest.runAllTimersAsync();
        await promise;

        expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    test('throws after exceeding max retries', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' });
        const config = { clickhouseUrl: 'http://localhost:8123' };

        const promise = pushWithRetry([{ measurement: 'deployment' }], config, 3);
        const assertion = expect(promise).rejects.toThrow('Failed to push metrics after 3 attempts');
        await jest.runAllTimersAsync();
        await assertion;
    });

    test('logs warning with delay before each retry', async () => {
        const core = require('@actions/core');
        global.fetch
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' });
        const config = { clickhouseUrl: 'http://localhost:8123' };

        const promise = pushWithRetry([{ measurement: 'deployment' }], config, 2);
        const assertion = expect(promise).rejects.toThrow('after 2 attempts');
        await jest.runAllTimersAsync();
        await assertion;

        expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('retrying in 1000ms'));
    });
});

describe('clickhouse constants', () => {
    test('RETRY_ATTEMPTS is 3', () => {
        expect(RETRY_ATTEMPTS).toBe(3);
    });

    test('RETRY_DELAY_MS is 1000', () => {
        expect(RETRY_DELAY_MS).toBe(1000);
    });
});

const {
  detectFailures,
  calculateMTTR,
  calculateCycleTimes,
  createLineProtocol,
  escapeTag,
  formatFieldValue,
  MAX_LEAD_TIME_DAYS,
  MAX_CYCLE_TIME_DAYS,
  RETRY_ATTEMPTS,
  RETRY_DELAY_MS
} = require('../src/metrics');

// Mock @actions/core
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn()
}));

// Mock @actions/github
jest.mock('@actions/github', () => ({
  getOctokit: jest.fn(),
  context: {
    repo: { owner: 'test-owner', repo: 'test-repo' }
  }
}));

describe('createLineProtocol', () => {
  test('creates valid line protocol string', () => {
    const result = createLineProtocol(
      'deployment',
      { project: 'test', environment: 'prod' },
      { count: 1 },
      1234567890000000000
    );
    expect(result).toBe('deployment,project=test,environment=prod count=1i 1234567890000000000');
  });

  test('handles multiple fields', () => {
    const result = createLineProtocol(
      'lead_time',
      { project: 'test' },
      { seconds: 3600.5, count: 5 },
      1234567890000000000
    );
    expect(result).toBe('lead_time,project=test seconds=3600.5,count=5i 1234567890000000000');
  });

  test('escapes special characters in tags', () => {
    const result = createLineProtocol(
      'test',
      { project: 'my project', tag: 'a=b,c' },
      { value: 1 },
      1234567890000000000
    );
    expect(result).toContain('project=my\\ project');
    expect(result).toContain('tag=a\\=b\\,c');
  });
});

describe('escapeTag', () => {
  test('escapes commas', () => {
    expect(escapeTag('a,b')).toBe('a\\,b');
  });

  test('escapes equals signs', () => {
    expect(escapeTag('a=b')).toBe('a\\=b');
  });

  test('escapes spaces', () => {
    expect(escapeTag('a b')).toBe('a\\ b');
  });

  test('escapes multiple special characters', () => {
    expect(escapeTag('a,b=c d')).toBe('a\\,b\\=c\\ d');
  });

  test('returns unchanged string without special chars', () => {
    expect(escapeTag('simple')).toBe('simple');
  });
});

describe('formatFieldValue', () => {
  test('formats integers with i suffix', () => {
    expect(formatFieldValue(42)).toBe('42i');
    expect(formatFieldValue(0)).toBe('0i');
    expect(formatFieldValue(-5)).toBe('-5i');
  });

  test('formats floats without suffix', () => {
    expect(formatFieldValue(3.14)).toBe('3.14');
    expect(formatFieldValue(0.5)).toBe('0.5');
  });

  test('formats booleans', () => {
    expect(formatFieldValue(true)).toBe('true');
    expect(formatFieldValue(false)).toBe('false');
  });

  test('formats strings with quotes', () => {
    expect(formatFieldValue('hello')).toBe('"hello"');
  });

  test('escapes quotes in strings', () => {
    expect(formatFieldValue('say "hi"')).toBe('"say \\"hi\\""');
  });
});

describe('detectFailures', () => {
  test('returns false for normal commits on main branch', () => {
    const commits = [
      { message: 'feat(TECH-123): add new feature' },
      { message: 'fix(TECH-456): fix bug' }
    ];
    expect(detectFailures(commits, 'refs/heads/main')).toBe(false);
  });

  test('returns true when revert commit is present', () => {
    const commits = [
      { message: 'feat(TECH-123): add feature' },
      { message: 'Revert "feat(TECH-123): add feature"' }
    ];
    expect(detectFailures(commits, 'refs/heads/main')).toBe(true);
  });

  test('returns true when rollback commit is present', () => {
    const commits = [
      { message: 'rollback: undo changes' }
    ];
    expect(detectFailures(commits, 'refs/heads/main')).toBe(true);
  });

  test('returns true for hotfix branch deployment', () => {
    const commits = [
      { message: 'fix(TECH-789): critical fix' }
    ];
    expect(detectFailures(commits, 'refs/heads/hotfix/critical-bug')).toBe(true);
  });

  test('returns true for fix/ branch deployment', () => {
    const commits = [
      { message: 'fix: urgent production fix' }
    ];
    expect(detectFailures(commits, 'refs/heads/fix/prod-issue')).toBe(true);
  });

  test('returns true for emergency/ branch deployment', () => {
    const commits = [
      { message: 'chore: emergency deployment' }
    ];
    expect(detectFailures(commits, 'refs/heads/emergency/db-recovery')).toBe(true);
  });

  test('returns false for feature branch', () => {
    const commits = [
      { message: 'feat: new feature' }
    ];
    expect(detectFailures(commits, 'refs/heads/feature/new-feature')).toBe(false);
  });

  test('returns true when both revert commit and hotfix branch', () => {
    const commits = [
      { message: 'Revert "feat: bad feature"' }
    ];
    expect(detectFailures(commits, 'refs/heads/hotfix/revert-bad-feature')).toBe(true);
  });
});

describe('calculateMTTR', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns null for normal commits', async () => {
    const commits = [
      { message: 'feat: add feature', timestamp: new Date(Date.now() - 3600000).toISOString() }
    ];
    const result = await calculateMTTR(commits, 'refs/heads/main');
    expect(result).toBe(null);
  });

  test('calculates MTTR for revert commits', async () => {
    const now = Date.now();
    jest.setSystemTime(now);

    const commits = [
      { message: 'Revert "feat: bad feature"', timestamp: new Date(now - 1800000).toISOString() } // 30 minutes ago
    ];
    const result = await calculateMTTR(commits, 'refs/heads/main');

    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1800); // Should be around 1800 seconds (30 minutes)
  });

  test('calculates MTTR for hotfix deployment', async () => {
    const now = Date.now();
    jest.setSystemTime(now);

    const commits = [
      { message: 'fix: critical bug', timestamp: new Date(now - 600000).toISOString() } // 10 minutes ago
    ];
    const result = await calculateMTTR(commits, 'refs/heads/hotfix/critical');

    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(600); // Should be around 600 seconds (10 minutes)
  });

  test('uses earliest commit timestamp for MTTR', async () => {
    const now = Date.now();
    jest.setSystemTime(now);

    const commits = [
      { message: 'fix: first fix', timestamp: new Date(now - 3600000).toISOString() }, // 1 hour ago (earliest)
      { message: 'fix: second fix', timestamp: new Date(now - 1800000).toISOString() }, // 30 min ago
      { message: 'Revert "feat: bad"', timestamp: new Date(now - 600000).toISOString() } // 10 min ago
    ];
    const result = await calculateMTTR(commits, 'refs/heads/main');

    expect(result).toBeGreaterThan(3500); // Should be around 3600 seconds (1 hour)
  });

  test('returns null for zero or negative recovery time', async () => {
    const now = Date.now();
    jest.setSystemTime(now);

    const commits = [
      { message: 'Revert "feat: bad"', timestamp: new Date(now + 1000).toISOString() } // Future timestamp
    ];
    const result = await calculateMTTR(commits, 'refs/heads/main');

    expect(result).toBe(null);
  });
});

describe('calculateCycleTimes', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns null when yogileInstance is null', async () => {
    const commits = [{ message: 'feat(TECH-123): feature' }];
    const result = await calculateCycleTimes(commits, null);
    expect(result).toBe(null);
  });

  test('skips commits without task ID', async () => {
    const now = Date.now();
    jest.setSystemTime(now);

    const mockYogile = {
      getTask: jest.fn()
    };

    const commits = [
      { message: 'feat: feature without task ID' }
    ];

    const result = await calculateCycleTimes(commits, mockYogile);
    expect(result).toBe(null);
    expect(mockYogile.getTask).not.toHaveBeenCalled();
  });

  test('calculates cycle time from task creation to deployment', async () => {
    const now = Date.now();
    jest.setSystemTime(now);

    const taskCreatedTime = new Date(now - 7 * 24 * 60 * 60 * 1000); // 7 days ago

    const mockYogile = {
      getTask: jest.fn().mockResolvedValue({
        timestamp: taskCreatedTime.toISOString()
      })
    };

    const commits = [
      { message: 'feat(TECH-123): add feature', sha: 'abc1234' }
    ];

    const result = await calculateCycleTimes(commits, mockYogile);

    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(7 * 24 * 60 * 60); // ~7 days in seconds
    expect(mockYogile.getTask).toHaveBeenCalledWith('TECH-123');
  });

  test('handles task not found', async () => {
    const mockYogile = {
      getTask: jest.fn().mockResolvedValue(null)
    };

    const commits = [
      { message: 'feat(TECH-123): feature', sha: 'abc1234' }
    ];

    const result = await calculateCycleTimes(commits, mockYogile);
    expect(result).toBe(null);
  });

  test('handles invalid task timestamp', async () => {
    const mockYogile = {
      getTask: jest.fn().mockResolvedValue({
        timestamp: 'invalid-date'
      })
    };

    const commits = [
      { message: 'feat(TECH-123): feature', sha: 'abc1234' }
    ];

    const result = await calculateCycleTimes(commits, mockYogile);
    expect(result).toBe(null);
  });

  test('caps cycle time at MAX_CYCLE_TIME_DAYS', async () => {
    const now = Date.now();
    jest.setSystemTime(now);

    // Task created 200 days ago (exceeds MAX_CYCLE_TIME_DAYS of 180)
    const taskCreatedTime = new Date(now - 200 * 24 * 60 * 60 * 1000);

    const mockYogile = {
      getTask: jest.fn().mockResolvedValue({
        timestamp: taskCreatedTime.toISOString()
      })
    };

    const commits = [
      { message: 'feat(TECH-123): feature', sha: 'abc1234' }
    ];

    const result = await calculateCycleTimes(commits, mockYogile);
    const maxSeconds = MAX_CYCLE_TIME_DAYS * 24 * 60 * 60;

    expect(result).toBe(maxSeconds);
  });

  test('skips negative cycle times', async () => {
    const now = Date.now();
    jest.setSystemTime(now);

    // Task created in the future
    const taskCreatedTime = new Date(now + 1000);

    const mockYogile = {
      getTask: jest.fn().mockResolvedValue({
        timestamp: taskCreatedTime.toISOString()
      })
    };

    const commits = [
      { message: 'feat(TECH-123): feature', sha: 'abc1234' }
    ];

    const result = await calculateCycleTimes(commits, mockYogile);
    expect(result).toBe(null);
  });

  test('calculates mean cycle time for multiple commits', async () => {
    const now = Date.now();
    jest.setSystemTime(now);

    const mockYogile = {
      getTask: jest.fn()
        .mockResolvedValueOnce({ timestamp: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString() }) // 1 day
        .mockResolvedValueOnce({ timestamp: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString() }) // 3 days
    };

    const commits = [
      { message: 'feat(TECH-1): feature 1', sha: 'abc' },
      { message: 'feat(TECH-2): feature 2', sha: 'def' }
    ];

    const result = await calculateCycleTimes(commits, mockYogile);

    // Mean of ~1 day and ~3 days = ~2 days
    const twoDaysInSeconds = 2 * 24 * 60 * 60;
    expect(result).toBeGreaterThan(twoDaysInSeconds - 1000);
    expect(result).toBeLessThan(twoDaysInSeconds + 1000);
  });
});

describe('metrics constants', () => {
  test('MAX_LEAD_TIME_DAYS is 30', () => {
    expect(MAX_LEAD_TIME_DAYS).toBe(30);
  });

  test('MAX_CYCLE_TIME_DAYS is 180', () => {
    expect(MAX_CYCLE_TIME_DAYS).toBe(180);
  });

  test('RETRY_ATTEMPTS is 3', () => {
    expect(RETRY_ATTEMPTS).toBe(3);
  });

  test('RETRY_DELAY_MS is 1000', () => {
    expect(RETRY_DELAY_MS).toBe(1000);
  });
});

describe('hasTaskId (via commits check)', () => {
  test('deployment_has_task should be true when any commit has task ID', () => {
    const commits = [
      { message: 'feat(TECH-123): add feature' },
      { message: 'chore: update deps' }
    ];
    const hasTask = commits.some(c => /[A-Z]+-\d+/.test(c.message));
    expect(hasTask).toBe(true);
  });

  test('deployment_has_task should be false when no commits have task ID', () => {
    const commits = [
      { message: 'feat: add feature' },
      { message: 'chore: update deps' }
    ];
    const hasTask = commits.some(c => /[A-Z]+-\d+/.test(c.message));
    expect(hasTask).toBe(false);
  });

  test('detects various task ID formats', () => {
    const testCases = [
      { message: 'feat(TECH-123): task', expected: true },
      { message: 'fix(ABC-1): small task', expected: true },
      { message: 'chore(PROJECT-99999): big task', expected: true },
      { message: 'feat: no task here', expected: false },
      { message: 'tech-123 lowercase', expected: false }
    ];

    testCases.forEach(({ message, expected }) => {
      const hasTask = /[A-Z]+-\d+/.test(message);
      expect(hasTask).toBe(expected);
    });
  });
});

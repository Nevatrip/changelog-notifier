const { detectFailures, calculateMTTR } = require('./metrics');

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
      { message: 'tech-123 lowercase', expected: false }, // lowercase not matched
    ];

    testCases.forEach(({ message, expected }) => {
      const hasTask = /[A-Z]+-\d+/.test(message);
      expect(hasTask).toBe(expected);
    });
  });
});

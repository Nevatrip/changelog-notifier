const { isRevertCommit, isHotfixDeployment, extractIncidentType } = require('../src/detectors');

describe('isRevertCommit', () => {
  test('returns false for null/empty message', () => {
    expect(isRevertCommit(null)).toBe(false);
    expect(isRevertCommit('')).toBe(false);
    expect(isRevertCommit(undefined)).toBe(false);
  });

  test('detects standard git revert format', () => {
    expect(isRevertCommit('Revert "feat: add new feature"')).toBe(true);
    expect(isRevertCommit('Revert "fix(TECH-123): fix bug"')).toBe(true);
  });

  test('detects revert with parentheses (conventional commits)', () => {
    expect(isRevertCommit('revert(TECH-123): undo feature')).toBe(true);
    expect(isRevertCommit('Revert(scope): message')).toBe(true);
  });

  test('detects revert with colon', () => {
    expect(isRevertCommit('revert: undo changes')).toBe(true);
    expect(isRevertCommit('Revert: previous commit')).toBe(true);
  });

  test('detects revert with space', () => {
    expect(isRevertCommit('revert previous changes')).toBe(true);
  });

  test('detects "revert commit" phrase', () => {
    expect(isRevertCommit('This is a revert commit for TECH-123')).toBe(true);
  });

  test('detects rollback', () => {
    expect(isRevertCommit('rollback to previous version')).toBe(true);
    expect(isRevertCommit('Rollback feature flag')).toBe(true);
    expect(isRevertCommit('Emergency rollback')).toBe(true);
  });

  test('does not detect normal commits', () => {
    expect(isRevertCommit('feat: add new feature')).toBe(false);
    expect(isRevertCommit('fix(TECH-123): fix bug')).toBe(false);
    expect(isRevertCommit('reverted to use old API')).toBe(false); // "reverted" not "revert"
  });
});

describe('isHotfixDeployment', () => {
  test('returns false for null/empty ref', () => {
    expect(isHotfixDeployment(null)).toBe(false);
    expect(isHotfixDeployment('')).toBe(false);
    expect(isHotfixDeployment(undefined)).toBe(false);
  });

  test('detects hotfix/ branches', () => {
    expect(isHotfixDeployment('refs/heads/hotfix/critical-bug')).toBe(true);
    expect(isHotfixDeployment('hotfix/TECH-123')).toBe(true);
  });

  test('detects hotfix- branches', () => {
    expect(isHotfixDeployment('refs/heads/hotfix-critical')).toBe(true);
    expect(isHotfixDeployment('hotfix-v1.2.3')).toBe(true);
  });

  test('detects fix/ branches', () => {
    expect(isHotfixDeployment('refs/heads/fix/bug-123')).toBe(true);
    expect(isHotfixDeployment('fix/TECH-123')).toBe(true);
  });

  test('detects fix- branches', () => {
    expect(isHotfixDeployment('refs/heads/fix-urgent')).toBe(true);
    expect(isHotfixDeployment('fix-prod-issue')).toBe(true);
  });

  test('detects emergency/ branches', () => {
    expect(isHotfixDeployment('refs/heads/emergency/production-down')).toBe(true);
    expect(isHotfixDeployment('emergency/db-recovery')).toBe(true);
  });

  test('does not detect normal branches', () => {
    expect(isHotfixDeployment('refs/heads/main')).toBe(false);
    expect(isHotfixDeployment('refs/heads/develop')).toBe(false);
    expect(isHotfixDeployment('refs/heads/feature/new-feature')).toBe(false);
    expect(isHotfixDeployment('refs/heads/release/v1.0.0')).toBe(false);
  });
});

describe('extractIncidentType', () => {
  test('returns null when no incident detected', () => {
    expect(extractIncidentType('feat: add feature', 'refs/heads/main')).toBe(null);
    expect(extractIncidentType('fix: bug fix', 'refs/heads/develop')).toBe(null);
  });

  test('returns "revert" for revert commits', () => {
    expect(extractIncidentType('Revert "feat: add feature"', 'refs/heads/main')).toBe('revert');
    expect(extractIncidentType('rollback feature', 'refs/heads/main')).toBe('revert');
  });

  test('returns "hotfix" for hotfix deployments', () => {
    expect(extractIncidentType('fix: critical bug', 'refs/heads/hotfix/critical')).toBe('hotfix');
    expect(extractIncidentType('', 'refs/heads/fix/urgent')).toBe('hotfix');
  });

  test('prioritizes revert over hotfix', () => {
    expect(extractIncidentType('Revert "fix: bug"', 'refs/heads/hotfix/fix')).toBe('revert');
  });
});

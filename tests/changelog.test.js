const {
  generateChangelog,
  getCardInfo,
  formatCommitEntry,
  generateTaskLink,
  addProjectHeader,
  YOUGILE_BASE_URL
} = require('../src/changelog');

// Mock console.error to avoid test output noise
const originalError = console.error;
beforeAll(() => {
  console.error = jest.fn();
});
afterAll(() => {
  console.error = originalError;
});

describe('generateTaskLink', () => {
  test('generates correct YouGile link', () => {
    const link = generateTaskLink('TECH-123');
    expect(link).toContain('TECH-123');
    expect(link).toContain(YOUGILE_BASE_URL);
    expect(link).toContain('ссылка на задачу');
  });
});

describe('formatCommitEntry', () => {
  test('formats commit entry correctly', () => {
    const entry = formatCommitEntry({
      message: 'feat: add feature',
      prefix: 'feat',
      emoji: '✨',
      author: 'johndoe',
      taskLink: ' [link](https://example.com)',
      description: ''
    });

    expect(entry).toContain('✨');
    expect(entry).toContain('johndoe');
    expect(entry).toContain('[link]');
  });

  test('includes problem description when provided', () => {
    const entry = formatCommitEntry({
      message: 'feat: add feature',
      prefix: 'feat',
      emoji: '✨',
      author: 'johndoe',
      taskLink: ' [link](https://example.com)',
      description: 'Users cannot login'
    });

    expect(entry).toContain('Какую проблему решаем');
    expect(entry).toContain('Users cannot login');
  });
});

describe('addProjectHeader', () => {
  test('adds project header to changelog', () => {
    const result = addProjectHeader('Changelog content', 'MyProject');
    expect(result).toBe('*MyProject*\n\nChangelog content');
  });

  test('returns empty changelog unchanged', () => {
    expect(addProjectHeader('', 'MyProject')).toBe('');
    expect(addProjectHeader('   ', 'MyProject')).toBe('   ');
  });
});

describe('generateChangelog', () => {
  test('returns empty string for empty commits', async () => {
    expect(await generateChangelog([], ['feat'])).toBe('');
    expect(await generateChangelog(null, ['feat'])).toBe('');
    expect(await generateChangelog(undefined, ['feat'])).toBe('');
  });

  test('returns empty string for empty prefixes', async () => {
    const commits = [{ message: 'feat(TECH-123): add feature', author: { username: 'user' } }];
    expect(await generateChangelog(commits, [])).toBe('');
    expect(await generateChangelog(commits, null)).toBe('');
  });

  test('skips commits without task ID', async () => {
    const commits = [
      { message: 'feat: add feature without task', author: { username: 'user' } }
    ];
    const result = await generateChangelog(commits, ['feat']);
    expect(result).toBe('');
  });

  test('generates changelog for commits with task ID', async () => {
    const commits = [
      { message: 'feat(TECH-123): add cool feature', author: { username: 'johndoe' } }
    ];
    const result = await generateChangelog(commits, ['feat']);

    expect(result).toContain('Фичи'); // Section header from locale
    expect(result).toContain('TECH-123');
    expect(result).toContain('johndoe');
  });

  test('groups commits by prefix', async () => {
    const commits = [
      { message: 'feat(TECH-1): feature 1', author: { username: 'user1' } },
      { message: 'fix(TECH-2): fix bug', author: { username: 'user2' } },
      { message: 'feat(TECH-3): feature 2', author: { username: 'user3' } }
    ];
    const result = await generateChangelog(commits, ['feat', 'fix']);

    expect(result).toContain('Фичи');
    expect(result).toContain('Исправления багов');
    // Features should appear before fixes based on prefix order
    expect(result.indexOf('Фичи')).toBeLessThan(result.indexOf('Исправления багов'));
  });

  test('handles commits without author username', async () => {
    const commits = [
      { message: 'feat(TECH-123): feature', author: {} }
    ];
    const result = await generateChangelog(commits, ['feat']);
    expect(result).toContain('unknown');
  });
});

describe('getCardInfo', () => {
  test('returns null when yogileInstance is null', async () => {
    const result = await getCardInfo('TECH-123', null);
    expect(result).toBe(null);
  });

  test('returns null when taskId is null', async () => {
    const mockYogile = { getTask: jest.fn() };
    const result = await getCardInfo(null, mockYogile);
    expect(result).toBe(null);
  });

  test('returns card info from YouGile', async () => {
    const mockYogile = {
      getTask: jest.fn().mockResolvedValue({
        id: 'task-id',
        title: 'Task Title'
      }),
      getTaskChat: jest.fn().mockResolvedValue([])
    };

    const result = await getCardInfo('TECH-123', mockYogile);

    expect(result).toEqual({
      title: 'Task Title',
      link: `${YOUGILE_BASE_URL}/#TECH-123`,
      description: ''
    });
  });

  test('returns null when task has no title', async () => {
    const mockYogile = {
      getTask: jest.fn().mockResolvedValue({ id: 'task-id' })
    };

    const result = await getCardInfo('TECH-123', mockYogile);
    expect(result).toBe(null);
  });

  test('extracts problem description from chat', async () => {
    const mockYogile = {
      getTask: jest.fn().mockResolvedValue({
        id: 'task-id',
        title: 'Task Title'
      }),
      getTaskChat: jest.fn().mockResolvedValue([
        { text: 'Header\nКакую проблему решаем\nUsers cannot login' }
      ])
    };

    const result = await getCardInfo('TECH-123', mockYogile);

    expect(result.description).toBe('Users cannot login');
  });

  test('handles API errors gracefully', async () => {
    const mockYogile = {
      getTask: jest.fn().mockRejectedValue(new Error('API Error'))
    };

    const result = await getCardInfo('TECH-123', mockYogile);
    expect(result).toBe(null);
  });
});

const {
  escapeMarkdown,
  getFirstLine,
  extractTaskId,
  hasTaskId,
  removeTaskIdSuffix,
  parseProblemDescription,
  hasPrefix,
  replacePrefix
} = require('../src/parsing');

describe('escapeMarkdown', () => {
  test('escapes special characters', () => {
    expect(escapeMarkdown('Hello *world*')).toBe('Hello \\*world\\*');
    expect(escapeMarkdown('Test [link]')).toBe('Test \\[link\\]');
    expect(escapeMarkdown('Code `inline`')).toBe('Code `inline`'); // backticks not escaped
  });

  test('handles empty/null input', () => {
    expect(escapeMarkdown('')).toBe('');
    expect(escapeMarkdown(null)).toBe('');
    expect(escapeMarkdown(undefined)).toBe('');
  });

  test('escapes multiple special chars', () => {
    expect(escapeMarkdown('feat(TECH-123): message')).toBe('feat\\(TECH\\-123\\): message');
  });
});

describe('getFirstLine', () => {
  test('returns first line of multi-line message', () => {
    expect(getFirstLine('First line\nSecond line')).toBe('First line');
    expect(getFirstLine('Only line')).toBe('Only line');
  });

  test('handles empty/null input', () => {
    expect(getFirstLine('')).toBe('');
    expect(getFirstLine(null)).toBe('');
    expect(getFirstLine(undefined)).toBe('');
  });

  test('handles message with multiple newlines', () => {
    expect(getFirstLine('First\nSecond\nThird')).toBe('First');
  });
});

describe('extractTaskId', () => {
  test('extracts task ID from suffix format', () => {
    expect(extractTaskId('feat(TECH-123): add feature')).toBe('TECH-123');
    expect(extractTaskId('fix(ABC-1): fix bug')).toBe('ABC-1');
    expect(extractTaskId('chore(PROJECT-99999): update')).toBe('PROJECT-99999');
  });

  test('returns null for messages without task ID suffix', () => {
    expect(extractTaskId('feat: add feature')).toBe(null);
    expect(extractTaskId('TECH-123 in message')).toBe(null); // Not in suffix format
    expect(extractTaskId('')).toBe(null);
    expect(extractTaskId(null)).toBe(null);
  });
});

describe('hasTaskId', () => {
  test('returns true when message contains task ID', () => {
    expect(hasTaskId('feat(TECH-123): add feature')).toBe(true);
    expect(hasTaskId('Message with TECH-123 inside')).toBe(true);
    expect(hasTaskId('ABC-1')).toBe(true);
  });

  test('returns false when no task ID present', () => {
    expect(hasTaskId('feat: add feature')).toBe(false);
    expect(hasTaskId('tech-123 lowercase')).toBe(false);
    expect(hasTaskId('')).toBe(false);
    expect(hasTaskId(null)).toBe(false);
  });
});

describe('removeTaskIdSuffix', () => {
  test('removes task ID suffix from message', () => {
    expect(removeTaskIdSuffix('feat(TECH-123): add feature')).toBe('feat: add feature');
    expect(removeTaskIdSuffix('fix(ABC-1): bug')).toBe('fix: bug');
  });

  test('returns message unchanged if no suffix', () => {
    expect(removeTaskIdSuffix('feat: add feature')).toBe('feat: add feature');
  });

  test('handles empty/null input', () => {
    expect(removeTaskIdSuffix('')).toBe('');
    expect(removeTaskIdSuffix(null)).toBe('');
  });
});

describe('parseProblemDescription', () => {
  const problemTitle = 'Какую проблему решаем';

  test('extracts problem description', () => {
    const message = 'Some text\nКакую проблему решаем\nПользователи не могут войти\nMore text';
    expect(parseProblemDescription(message, problemTitle)).toBe('Пользователи не могут войти');
  });

  test('returns empty string when no problem section', () => {
    expect(parseProblemDescription('Just some text', problemTitle)).toBe('');
  });

  test('handles empty/null input', () => {
    expect(parseProblemDescription('', problemTitle)).toBe('');
    expect(parseProblemDescription(null, problemTitle)).toBe('');
    expect(parseProblemDescription('text', '')).toBe('');
    expect(parseProblemDescription('text', null)).toBe('');
  });

  test('handles problem at end of message', () => {
    const message = 'Header\nКакую проблему решаем\nLast line';
    expect(parseProblemDescription(message, problemTitle)).toBe('Last line');
  });
});

describe('hasPrefix', () => {
  test('returns true when prefix found', () => {
    expect(hasPrefix('feat: add feature', 'feat')).toBe(true);
    expect(hasPrefix('fix: bug fix', 'fix')).toBe(true);
  });

  test('returns false when prefix not found', () => {
    expect(hasPrefix('feat: add feature', 'fix')).toBe(false);
    expect(hasPrefix('feature: add feature', 'feat')).toBe(false);
  });

  test('handles empty/null input', () => {
    expect(hasPrefix('', 'feat')).toBe(false);
    expect(hasPrefix(null, 'feat')).toBe(false);
    expect(hasPrefix('feat:', null)).toBe(false);
  });
});

describe('replacePrefix', () => {
  test('replaces prefix with emoji', () => {
    expect(replacePrefix('feat: add feature', 'feat', '✨')).toBe('✨ add feature');
    expect(replacePrefix('fix: bug fix', 'fix', '🛠️')).toBe('🛠️ bug fix');
  });

  test('returns message unchanged if prefix not found', () => {
    expect(replacePrefix('feat: add feature', 'fix', '🛠️')).toBe('feat: add feature');
  });

  test('handles empty/null input', () => {
    expect(replacePrefix('', 'feat', '✨')).toBe('');
    expect(replacePrefix(null, 'feat', '✨')).toBe('');
    expect(replacePrefix('feat: test', null, '✨')).toBe('feat: test');
  });
});

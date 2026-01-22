const Yogile = require('../src/yogile');

// Mock global fetch
global.fetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Yogile', () => {
  const apiKey = 'test-api-key';
  let yogile;

  beforeEach(() => {
    yogile = new Yogile(apiKey);
  });

  describe('constructor', () => {
    test('sets baseUrl and apiKey', () => {
      expect(yogile.baseUrl).toBe('https://ru.yougile.com/api-v2');
      expect(yogile.apiKey).toBe(apiKey);
    });
  });

  describe('getTask', () => {
    test('fetches task successfully', async () => {
      const mockTask = {
        id: 'task-123',
        title: 'Test Task',
        timestamp: '2024-01-15T10:00:00Z'
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockTask)
      });

      const result = await yogile.getTask('TECH-123');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://ru.yougile.com/api-v2/tasks/TECH-123',
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          }
        }
      );
      expect(result).toEqual(mockTask);
    });

    test('throws error on API failure', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        statusText: 'Not Found'
      });

      await expect(yogile.getTask('INVALID-ID'))
        .rejects.toThrow('Error fetching task: Not Found');
    });
  });

  describe('getTaskChat', () => {
    test('fetches task chat successfully', async () => {
      const mockMessages = [
        { id: 1, text: 'First message' },
        { id: 2, text: 'Second message' }
      ];

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ content: mockMessages })
      });

      const result = await yogile.getTaskChat('task-123', 0, 10);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://ru.yougile.com/api-v2/chats/task-123/messages?offset=0&limit=10',
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          }
        }
      );
      expect(result).toEqual(mockMessages);
    });

    test('throws error on API failure', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error'
      });

      await expect(yogile.getTaskChat('task-123', 0, 10))
        .rejects.toThrow('Error fetching task chat: Internal Server Error');
    });

    test('handles pagination parameters', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ content: [] })
      });

      await yogile.getTaskChat('task-123', 20, 5);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://ru.yougile.com/api-v2/chats/task-123/messages?offset=20&limit=5',
        expect.any(Object)
      );
    });
  });
});

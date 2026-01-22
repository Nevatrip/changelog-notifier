const { sendMessage, BASE_URL } = require('../src/telegram');

// Mock global fetch
global.fetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sendMessage', () => {
  test('sends message successfully', async () => {
    const mockResponse = {
      ok: true,
      json: jest.fn().mockResolvedValue({ ok: true, result: { message_id: 123 } })
    };
    global.fetch.mockResolvedValue(mockResponse);

    const result = await sendMessage({
      token: 'test-token',
      chatId: '12345',
      text: 'Hello World'
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`${BASE_URL}/bottest-token/sendMessage`)
    );
    expect(result).toEqual({ ok: true, result: { message_id: 123 } });
  });

  test('throws error when token is missing', async () => {
    await expect(sendMessage({
      chatId: '12345',
      text: 'Hello'
    })).rejects.toThrow('Telegram token is required');
  });

  test('throws error when chatId is missing', async () => {
    await expect(sendMessage({
      token: 'test-token',
      text: 'Hello'
    })).rejects.toThrow('Chat ID is required');
  });

  test('throws error when text is missing', async () => {
    await expect(sendMessage({
      token: 'test-token',
      chatId: '12345'
    })).rejects.toThrow('Message text is required');
  });

  test('handles Telegram API error', async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      json: jest.fn().mockResolvedValue({ description: 'Bad Request: message is too long' })
    };
    global.fetch.mockResolvedValue(mockResponse);

    await expect(sendMessage({
      token: 'test-token',
      chatId: '12345',
      text: 'Hello'
    })).rejects.toThrow('Telegram API error: 400, description: Bad Request: message is too long');
  });

  test('uses default parseMode MarkdownV2', async () => {
    const mockResponse = {
      ok: true,
      json: jest.fn().mockResolvedValue({ ok: true })
    };
    global.fetch.mockResolvedValue(mockResponse);

    await sendMessage({
      token: 'test-token',
      chatId: '12345',
      text: 'Hello'
    });

    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain('parse_mode=MarkdownV2');
  });

  test('allows custom parseMode', async () => {
    const mockResponse = {
      ok: true,
      json: jest.fn().mockResolvedValue({ ok: true })
    };
    global.fetch.mockResolvedValue(mockResponse);

    await sendMessage({
      token: 'test-token',
      chatId: '12345',
      text: 'Hello',
      parseMode: 'HTML'
    });

    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain('parse_mode=HTML');
  });
});

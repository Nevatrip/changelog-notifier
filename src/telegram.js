/**
 * Telegram messaging module
 */

const BASE_URL = 'https://api.telegram.org';

/**
 * Send a message to Telegram chat
 * @param {Object} options - Send options
 * @param {string} options.token - Telegram bot token
 * @param {string} options.chatId - Chat ID to send to
 * @param {string} options.text - Message text
 * @param {string} [options.parseMode='MarkdownV2'] - Parse mode
 * @returns {Promise<Object>} - Telegram API response
 */
async function sendMessage({ token, chatId, text, parseMode = 'MarkdownV2' }) {
  if (!token) {
    throw new Error('Telegram token is required');
  }
  if (!chatId) {
    throw new Error('Chat ID is required');
  }
  if (!text) {
    throw new Error('Message text is required');
  }

  const url = `${BASE_URL}/bot${token}/sendMessage`;
  const params = new URLSearchParams({
    chat_id: chatId,
    text: text,
    parse_mode: parseMode,
  });

  const response = await fetch(`${url}?${params.toString()}`);

  if (!response.ok) {
    const data = await response.json();
    throw new Error(
      `Telegram API error: ${response.status}, description: ${data.description || 'Unknown error'}`
    );
  }

  return response.json();
}

module.exports = {
  sendMessage,
  BASE_URL
};

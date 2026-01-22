/**
 * Parsing utilities for commit messages and task information
 */

const ESCAPE_REGEX = /([|{\[\]*_~}+)(#>!=\-.])/gm;
const TASK_ID_PATTERN = /([A-Z]+-\d+)/;
const TASK_ID_SUFFIX_PATTERN = /\(([A-Z]+-\d+)\):/;

/**
 * Escape special characters for Telegram MarkdownV2
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(ESCAPE_REGEX, '\\$1');
}

/**
 * Extract first line from commit message
 * @param {string} message - Full commit message
 * @returns {string} - First line only
 */
function getFirstLine(message) {
  if (!message) return '';
  const indexOfNewLine = message.indexOf('\n');
  return indexOfNewLine !== -1 ? message.slice(0, indexOfNewLine) : message;
}

/**
 * Extract task ID from commit message
 * Supports format: "prefix(TASK-123): message"
 * @param {string} message - Commit message
 * @returns {string|null} - Task ID or null
 */
function extractTaskId(message) {
  if (!message) return null;
  const match = message.match(TASK_ID_SUFFIX_PATTERN);
  return match ? match[1] : null;
}

/**
 * Check if message contains any task ID pattern
 * @param {string} message - Commit message
 * @returns {boolean} - True if task ID found
 */
function hasTaskId(message) {
  if (!message) return false;
  return TASK_ID_PATTERN.test(message);
}

/**
 * Remove task ID suffix from message
 * Converts "prefix(TASK-123): message" to "prefix: message"
 * @param {string} message - Message with task ID suffix
 * @returns {string} - Message without task ID suffix
 */
function removeTaskIdSuffix(message) {
  if (!message) return '';
  return message.replace(TASK_ID_SUFFIX_PATTERN, ':');
}

/**
 * Parse problem description from task message
 * @param {string} message - Full task message
 * @param {string} problemTitle - Title that marks the problem section
 * @returns {string} - Problem description or empty string
 */
function parseProblemDescription(message, problemTitle) {
  if (!message || !problemTitle) return '';

  const fullTitle = problemTitle + '\n';
  const problemStart = message.indexOf(fullTitle);
  if (problemStart === -1) return '';

  const contentStart = problemStart + fullTitle.length;
  let problemEnd = message.indexOf('\n', contentStart);
  if (problemEnd === -1) {
    problemEnd = message.length;
  }

  return message.slice(contentStart, problemEnd).trim();
}

/**
 * Check if message has a specific prefix
 * @param {string} message - Message to check
 * @param {string} prefix - Prefix to look for (e.g., "feat", "fix")
 * @returns {boolean} - True if prefix found
 */
function hasPrefix(message, prefix) {
  if (!message || !prefix) return false;
  return message.includes(`${prefix}:`);
}

/**
 * Replace prefix with emoji
 * @param {string} message - Message with prefix
 * @param {string} prefix - Prefix to replace
 * @param {string} emoji - Emoji to use
 * @returns {string} - Message with emoji instead of prefix
 */
function replacePrefix(message, prefix, emoji) {
  if (!message || !prefix) return message || '';
  return message.replace(`${prefix}:`, emoji);
}

module.exports = {
  ESCAPE_REGEX,
  TASK_ID_PATTERN,
  escapeMarkdown,
  getFirstLine,
  extractTaskId,
  hasTaskId,
  removeTaskIdSuffix,
  parseProblemDescription,
  hasPrefix,
  replacePrefix
};

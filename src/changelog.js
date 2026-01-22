/**
 * Changelog generation module
 */

const locale = require('../locale.json');
const {
  escapeMarkdown,
  getFirstLine,
  extractTaskId,
  removeTaskIdSuffix,
  parseProblemDescription,
  hasPrefix,
  replacePrefix
} = require('./parsing');

const YOUGILE_BASE_URL = 'https://ru.yougile.com/team/129fed1fbadf';

/**
 * Generate YouGile task link
 * @param {string} taskId - Task ID (e.g., "TECH-123")
 * @returns {string} - Markdown link
 */
function generateTaskLink(taskId) {
  return ` [${locale.taskLink}](${YOUGILE_BASE_URL}/#${taskId})`;
}

/**
 * Get card info from YouGile
 * @param {string} taskId - Task ID
 * @param {Object} yogileInstance - YouGile API instance
 * @param {Object} core - Core instance
 * @returns {Promise<Object|null>} - Card info or null
 */
async function getCardInfo(taskId, yogileInstance, core) {
  if (!yogileInstance || !taskId) return null;

  try {
    const task = await yogileInstance.getTask(taskId);

    if (!task || !task.title) {
      return null;
    }

    const messages = await yogileInstance.getTaskChat(task.id, 0, 1);
    const description = messages.length > 0
      ? parseProblemDescription(messages[0].text, locale.problemTitle)
      : '';

    return {
      title: task.title,
      link: `${YOUGILE_BASE_URL}/#${taskId}`,
      description: description,
    };
  } catch (error) {
    if (core) {
      core.error('Error fetching task:', error);
    } else {
      console.error('Error fetching task:', error);
    }
    return null;
  }
}

/**
 * Format a single commit entry for changelog
 * @param {Object} options - Formatting options
 * @param {string} options.message - Commit message (first line, cleaned)
 * @param {string} options.prefix - Commit prefix (feat, fix, etc.)
 * @param {string} options.emoji - Emoji for prefix
 * @param {string} options.author - Commit author username
 * @param {string} options.taskLink - YouGile task link
 * @param {string} [options.description] - Problem description
 * @returns {string} - Formatted changelog entry
 */
function formatCommitEntry({ message, prefix, emoji, author, taskLink, description }) {
  let entry = replacePrefix(message, prefix, emoji);
  entry += ` \\(${author}\\)${taskLink}\n`;

  if (description) {
    const problemTitle = locale.problemTitle;
    entry += `>*${problemTitle}*\n`;
    entry += `>${escapeMarkdown(description).replace('\n', '\n>')}\n`;
  }

  return entry;
}

/**
 * Generate changelog text from commits
 * @param {Array} commits - Array of commit objects
 * @param {Array} prefixes - Array of prefixes to include
 * @param {Object} [yogileInstance] - YouGile API instance
 * @param {Object} core - Core instance
 * @returns {Promise<string>} - Changelog text
 */
async function generateChangelog(commits, prefixes, yogileInstance = null, core = null) {
  if (!commits || !Array.isArray(commits) || commits.length === 0) {
    return '';
  }
  if (!prefixes || !Array.isArray(prefixes) || prefixes.length === 0) {
    return '';
  }

  let changelogText = '';

  for (const prefix of prefixes) {
    for (const commit of commits) {
      let firstLine = getFirstLine(commit.message);
      const taskId = extractTaskId(firstLine);

      // Skip commits without task ID
      if (!taskId) {
        continue;
      }

      const youGileLink = generateTaskLink(taskId);
      firstLine = removeTaskIdSuffix(firstLine);
      firstLine = escapeMarkdown(firstLine);

      if (!hasPrefix(firstLine, prefix)) {
        continue;
      }

      // Add section header if not already present
      if (!changelogText.includes(locale.prefixes[prefix])) {
        changelogText += `*${locale.prefixes[prefix]}*\n`;
      }

      let finalMessage = firstLine;
      let description = '';

      // Try to get card info from YouGile
      if (yogileInstance) {
        const cardInfo = await getCardInfo(taskId, yogileInstance, core);
        if (cardInfo) {
          finalMessage = locale.emojis[prefix] + ' ' + escapeMarkdown(cardInfo.title);
          description = cardInfo.description;
        }
      }

      const author = commit.author?.username || 'unknown';
      changelogText += formatCommitEntry({
        message: finalMessage,
        prefix,
        emoji: locale.emojis[prefix],
        author,
        taskLink: youGileLink,
        description
      });
    }

    // Add extra newline after section
    if (changelogText.includes(locale.prefixes[prefix])) {
      changelogText += '\n';
    }
  }

  return changelogText;
}

/**
 * Add project header to changelog
 * @param {string} changelog - Changelog text
 * @param {string} projectName - Project name
 * @returns {string} - Changelog with header
 */
function addProjectHeader(changelog, projectName) {
  if (!changelog || !changelog.trim()) {
    return changelog;
  }
  return `*${projectName}*\n\n${changelog}`;
}

module.exports = {
  generateChangelog,
  getCardInfo,
  formatCommitEntry,
  generateTaskLink,
  addProjectHeader,
  YOUGILE_BASE_URL
};

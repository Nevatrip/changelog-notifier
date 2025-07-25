const core = require('@actions/core');
const github = require('@actions/github');
const locale = require('./locale.json');

try {
  const escapeRegex = /([|{\[\]*_~}+)(#>!=\-.])/gm;
  const prefixes = core.getMultilineInput('prefixes');
  const projectName = core
    .getInput('project_name')
    .replace(escapeRegex, '\\$1');
  const commits =
    core.getInput('commits') === ''
      ? github.context.payload.commits
      : JSON.parse(core.getInput('commits'));
  const { repo } = github.context.repo;

  let changelogText = '';

  for (const prefix of prefixes) {
    for (const commit of commits) {
      let firstLine = commit.message;
      const indexOfNewLine = firstLine.indexOf('\n');
      if (indexOfNewLine !== -1) {
        firstLine = firstLine.slice(0, indexOfNewLine);
      }

      // Извлекаем ID задачи из суффикса в скобках
      const taskId = firstLine.match(/\(([A-Z]+-\d+)\):/)?.[1];
      let youGileLink = '';

      if (taskId) {
        youGileLink = ` [${locale.taskLink}](https://ru.yougile.com/team/129fed1fbadf/#${taskId})`;
        // Убираем суффикс с task ID из сообщения
        firstLine = firstLine.replace(/\([A-Z]+-\d+\):/, ':');
      }

      firstLine = firstLine.replace(escapeRegex, '\\$1');
      const isFirstLineHasPrefix = firstLine.includes(`${prefix}:`);

      if (isFirstLineHasPrefix) {
        if (!changelogText.includes(locale.prefixes[prefix])) {
          changelogText += `*${locale.prefixes[prefix]}*\n`;
        }
        firstLine = firstLine.replace(`${prefix}:`, locale.emojis[prefix]);
        changelogText += `${firstLine} \\(${commit.author.username}\\)${youGileLink}\n`;
      }
    }

    if (changelogText.includes(locale.prefixes[prefix])) {
      changelogText += '\n';
    }
  }

  if (changelogText.trim() === '') {
    core.info('No changes found');
    return;
  }

  changelogText = `*${projectName || repo}*\n\n` + changelogText;

  const token = core.getInput('token');
  const chatId = core.getInput('chat_id');

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const urlSearchParams = new URLSearchParams({
    chat_id: chatId,
    text: changelogText,
    parse_mode: 'MarkdownV2',
  });

  fetch(url + '?' + urlSearchParams.toString()).then(async response => {
    if (!response.ok) {
      const { description } = await response.json();
      throw new Error(
        `HTTP error! status: ${response.status}, description: ${description}`
      );
    }
  });
} catch (error) {
  core.setFailed(error.message);
}

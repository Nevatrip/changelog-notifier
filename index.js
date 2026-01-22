const core = require('@actions/core');
const github = require('@actions/github');
const locale = require('./locale.json');
const Yogile = require('./yogile');
const metricsModule = require('./metrics');

const escapeRegex = /([|{\[\]*_~}+)(#>!=\-.])/gm;

if (require.main === module) {
  main();
}

async function main() {
  const yogileInstance = new Yogile(core.getInput('yougile_api_key'));

  try {
    const prefixes = core.getMultilineInput('prefixes');
    const projectName = core
      .getInput('project_name')
      .replace(escapeRegex, '\\$1');
    const commits =
      core.getInput('commits') === ''
        ? github.context.payload.commits
        : JSON.parse(core.getInput('commits'));
    const { repo } = github.context.repo;

    const pushgatewayUrl = core.getInput('pushgateway_url');
    if (pushgatewayUrl) {
      try {
        await metricsModule.recordAndPushMetrics({
          commits,
          ref: github.context.ref,
          projectName: projectName || repo,
          repository: repo,
          pushgatewayUrl,
          environment: core.getInput('environment') || 'production',
          jobName: core.getInput('metrics_job_name') || 'dora_metrics',
          githubToken: process.env.GITHUB_TOKEN || core.getInput('token'),
          yogileInstance: yogileInstance
        });

        core.info('DORA metrics pushed to Pushgateway');
      } catch (error) {
        // Non-fatal: log warning but continue
        core.warning(`Failed to push metrics: ${error.message}`);
      }
    }

    let changelogText = await getChangelogText(commits, prefixes, yogileInstance);
    if (changelogText.trim() === '') {
      core.info('No changes found');
      return;
    }

    changelogText = `*${projectName || repo}*\n\n` + changelogText;

    const token = core.getInput('token');
    const chatId = core.getInput('chat_id');

    if (!token || !chatId) {
      console.log('Generated changelog:');
      console.log(changelogText);
      return;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const urlSearchParams = new URLSearchParams({
      chat_id: chatId,
      text: changelogText,
      parse_mode: 'MarkdownV2',
    });

    const response = await fetch(url + '?' + urlSearchParams.toString());
    if (!response.ok) {
      const { description } = await response.json();
      throw new Error(
        `HTTP error! status: ${response.status}, description: ${description}`
      );
    }
  } catch (error) {
    if (core && typeof core.setFailed === 'function') {
      core.setFailed(error.message);
    }
    console.error(error);
  }
}

async function getChangelogText(commits, prefixes, yogileInstance) {
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
      } else {
        continue; // Если нет ID задачи, пропускаем этот коммит
      }

      firstLine = firstLine.replace(escapeRegex, '\\$1');
      const isFirstLineHasPrefix = firstLine.includes(`${prefix}:`);

      if (isFirstLineHasPrefix) {
        if (!changelogText.includes(locale.prefixes[prefix])) {
          changelogText += `*${locale.prefixes[prefix]}*\n`;
        }

        firstLine = firstLine.replace(`${prefix}:`, locale.emojis[prefix]);
        let description = "";
        if (taskId && yogileInstance) {
          const cardInfo = await getCardInfo(taskId, yogileInstance);
          if (cardInfo) {
            firstLine = locale.emojis[prefix] + " " + cardInfo.title.replace(escapeRegex, '\\$1');
            description = cardInfo.description;
          }
        }

        changelogText += `${firstLine} \\(${commit.author.username}\\)${youGileLink}\n`;

        if (description) {
          const problemTitleText = locale.problemTitle;
          changelogText += ">*" + problemTitleText + "*\n";
          changelogText += ">" + description.replace('\n', '\n>').replace(escapeRegex, '\\$1') + "\n";
        }
      }
    }

    if (changelogText.includes(locale.prefixes[prefix])) {
      changelogText += '\n';
    }
  }

  return changelogText;
}

async function getCardInfo(taskID, yogileInstance) {
  try {
    const task = await yogileInstance.getTask(taskID);

    if (!task.title) {
      return null;
    }

    const messages = await yogileInstance.getTaskChat(task.id, 0, 1);

    const description = messages.length > 0 ? parseTaskMessage(messages[0].text) : '';

    return {
      title: task.title,
      link: `https://ru.yougile.com/team/129fed1fbadf/#${taskID}`,
      description: description,
    };
  } catch (error) {
    console.error('Error fetching task:', error);
    return null;
  }
}

function parseTaskMessage(message) {
  const problemTitle = locale.problemTitle + "\n";
  const problemStart = message.indexOf(problemTitle);
  if (problemStart === -1) { return ''; }

  let problemEnd = message.indexOf("\n", problemStart);
  if (problemEnd === -1) {
    problemEnd = message.length;
  }

  return message.slice(problemStart + problemTitle.length, problemEnd).trim();
}


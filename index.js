const core = require('@actions/core');
const github = require('@actions/github');
const Yogile = require('./src/yogile');
const metricsModule = require('./src/metrics');
const { generateChangelog, addProjectHeader } = require('./src/changelog');
const { sendMessage } = require('./src/telegram');
const { escapeMarkdown } = require('./src/parsing');

if (require.main === module) {
  main();
}

async function main() {
  const yogileInstance = new Yogile(core.getInput('yougile_api_key'));

  try {
    const prefixes = core.getMultilineInput('prefixes');
    const projectName = escapeMarkdown(core.getInput('project_name'));
    const commits =
      core.getInput('commits') === ''
        ? github.context.payload.commits
        : JSON.parse(core.getInput('commits'));
    const { repo } = github.context.repo;

    // Push DORA metrics if configured
    const influxdbUrl = core.getInput('influxdb_url');
    if (influxdbUrl) {
      try {
        await metricsModule.recordAndPushMetrics({
          commits,
          ref: github.context.ref,
          projectName: projectName || repo,
          repository: repo,
          influxdbUrl,
          influxdbBucket: core.getInput('influxdb_bucket') || 'default',
          environment: core.getInput('environment') || 'production',
          githubToken: core.getInput('github_token') || process.env.GITHUB_TOKEN,
          yogileInstance: yogileInstance
        });

        core.info('DORA metrics pushed to InfluxDB');
      } catch (error) {
        // Non-fatal: log warning but continue
        core.warning(`Failed to push metrics: ${error.message}`);
      }
    }

    // Generate changelog
    let changelogText = await generateChangelog(commits, prefixes, yogileInstance, core);
    if (changelogText.trim() === '') {
      core.info('No changes found');
      return;
    }

    changelogText = addProjectHeader(changelogText, projectName || repo);

    // Send to Telegram if configured
    const token = core.getInput('token');
    const chatId = core.getInput('chat_id');

    if (!(token && chatId)) {
      console.log('Generated changelog:');
      console.log(changelogText);
      return;
    }

    await sendMessage({
      token,
      chatId,
      text: changelogText
    });

    core.info('Changelog sent to Telegram');
  } catch (error) {
    if (core && typeof core.setFailed === 'function') {
      core.setFailed(error.message);
    }
    core.error(error);
  }
}

module.exports = { main };

/**
 * DORA Metrics Module
 * Calculates and exports DORA metrics to Prometheus Pushgateway
 */

const core = require('@actions/core');
const github = require('@actions/github');
const { Gauge, Registry } = require('prom-client');
const { isRevertCommit, isHotfixDeployment, extractIncidentType } = require('./detectors');

// Constants
const MAX_LEAD_TIME_DAYS = 30; // Filter outliers
const MAX_CYCLE_TIME_DAYS = 180; // 6 months - filter extreme outliers
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Check if commit message contains a task ID
 * @param {string} message - Commit message
 * @returns {boolean} - True if task ID found
 */
function hasTaskId(message) {
  const taskIdPattern = /[A-Z]+-\d+/;
  return taskIdPattern.test(message);
}

/**
 * Main entry point for recording and pushing DORA metrics
 * @param {Object} config - Configuration object
 * @param {Array} config.commits - Array of commit objects
 * @param {string} config.ref - Git ref (e.g., refs/heads/main)
 * @param {string} config.projectName - Project name
 * @param {string} config.repository - Repository name
 * @param {string} config.pushgatewayUrl - Pushgateway URL
 * @param {string} config.environment - Deployment environment (default: production)
 * @param {string} config.jobName - Prometheus job name (default: dora_metrics)
 * @param {string} config.githubToken - GitHub token for API access
 * @param {Object} config.yogileInstance - YouGile API instance (optional, for Cycle Time)
 */
async function recordAndPushMetrics(config) {
  const {
    commits,
    ref,
    projectName,
    repository,
    environment = 'production',
    githubToken,
    yogileInstance
  } = config;

  if (!commits || commits.length === 0) {
    core.info('No commits to process for metrics');
    return;
  }

  // Create a new registry for this metrics push
  const registry = new Registry();

  // Define metrics (Using Gauges for Pushgateway compatibility)
  // Instead of Counters (which reset on every run), we use Timestamps.
  // Prometheus query: changes(deployment_created_seconds[1d]) -> Count of deployments
  const deploymentTimestamp = new Gauge({
    name: 'deployment_created_seconds',
    help: 'Timestamp of the deployment. Use changes() to count deployments.',
    labelNames: ['project', 'repository', 'environment', 'has_task'],
    registers: [registry]
  });

  const leadTimeGauge = new Gauge({
    name: 'deployment_lead_time_seconds',
    help: 'Mean lead time from commit to deployment in seconds',
    labelNames: ['project', 'repository', 'environment', 'has_task'],
    registers: [registry]
  });

  const failureTimestamp = new Gauge({
    name: 'deployment_failure_created_seconds',
    help: 'Timestamp of the failed deployment. Use changes() to count failures.',
    labelNames: ['project', 'repository', 'environment', 'has_task'],
    registers: [registry]
  });

  const mttrGauge = new Gauge({
    name: 'incident_recovery_time_seconds',
    help: 'Time to recover from incidents in seconds',
    labelNames: ['project', 'repository', 'environment', 'incident_type', 'has_task'],
    registers: [registry]
  });

  const cycleTimeGauge = new Gauge({
    name: 'cycle_time_seconds',
    help: 'Mean cycle time from task creation to deployment in seconds',
    labelNames: ['project', 'repository', 'environment', 'has_task'],
    registers: [registry]
  });

  // Determine if deployment has commits with tasks
  const deploymentHasTask = commits.some(commit => hasTaskId(commit.message));
  const baseLabels = { project: projectName, repository, environment };
  const labels = { ...baseLabels, has_task: deploymentHasTask.toString() };

  // 1. Record deployment timestamp
  deploymentTimestamp.set(labels, Math.floor(Date.now() / 1000));
  core.info(`Recorded deployment timestamp for ${projectName} in ${environment}`);

  // 2. Calculate and record Lead Time
  try {
    const avgLeadTime = await calculateLeadTimes(commits, githubToken);
    if (avgLeadTime !== null) {
      leadTimeGauge.set(labels, avgLeadTime);
    }
  } catch (error) {
    core.warning(`Failed to calculate lead times: ${error.message}`);
  }

  // 3. Calculate and record Cycle Time (if YouGile available)
  if (yogileInstance) {
    try {
      const avgCycleTime = await calculateCycleTimes(commits, yogileInstance);
      if (avgCycleTime !== null) {
        cycleTimeGauge.set(labels, avgCycleTime);
      }
    } catch (error) {
      core.warning(`Failed to calculate cycle times: ${error.message}`);
    }
  }

  // 4. Detect failures
  const hasFailure = detectFailures(commits, ref);
  if (hasFailure) {
    failureTimestamp.set(labels, Math.floor(Date.now() / 1000));
    core.info('Detected deployment failure (revert or hotfix detected)');
  }

  // 5. Calculate MTTR
  try {
    const recoveryTime = await calculateMTTR(commits, ref);
    if (recoveryTime !== null) {
      // Determine incident type for label
      const hasRevertCommit = commits.some(commit => extractIncidentType(commit.message, ref) === 'revert');
      const incidentType = hasRevertCommit ? 'revert' : (extractIncidentType('', ref) === 'hotfix' ? 'hotfix' : 'unknown');

      mttrGauge.set({ ...labels, incident_type: incidentType }, recoveryTime);
    }
  } catch (error) {
    core.warning(`Failed to calculate MTTR: ${error.message}`);
  }

  // 6. Push metrics to Pushgateway
  await pushWithRetry(registry, config, RETRY_ATTEMPTS);
}

/**
 * Calculate lead times for commits using GitHub API
 * @param {Array} commits - Array of commit objects
 * @param {string} githubToken - GitHub token
 * @returns {Promise<number|null>} - Mean lead time in seconds or null
 */
async function calculateLeadTimes(commits, githubToken) {
  if (!githubToken) {
    core.warning('GitHub token not provided, skipping lead time calculation');
    return null;
  }

  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;
  const deploymentTime = new Date();
  const validLeadTimes = [];

  for (const commit of commits) {
    try {
      let commitTime;
      const commitSha = (commit.sha || commit.id)?.substring(0, 7);

      // Try to get PR information for this commit
      try {
        const { data: pulls } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
          owner,
          repo,
          commit_sha: commit.sha || commit.id
        });

        if (pulls && pulls.length > 0) {
          const pr = pulls[0];

          // Get first commit in PR
          try {
            const { data: prCommits } = await octokit.rest.pulls.listCommits({
              owner,
              repo,
              pull_number: pr.number,
              per_page: 100
            });

            if (prCommits && prCommits.length > 0) {
              // First commit in the PR
              const firstCommit = prCommits[0];
              commitTime = new Date(firstCommit.commit.author.date || firstCommit.commit.committer.date);
              core.info(`Commit ${commitSha} linked to PR #${pr.number}, first commit at ${commitTime.toISOString()}`);
            } else {
              // Fallback to current commit timestamp
              commitTime = new Date(commit.timestamp);
              core.info(`PR #${pr.number} has no commits, using commit timestamp`);
            }
          } catch (prError) {
            core.warning(`Failed to get PR commits for #${pr.number}: ${prError.message}, using commit timestamp`);
            commitTime = new Date(commit.timestamp);
          }
        } else {
          // Fallback: use commit timestamp
          commitTime = new Date(commit.timestamp);
          core.info(`Commit ${commitSha} has no associated PR, using commit timestamp`);
        }
      } catch (apiError) {
        // GitHub API rate limit or other error - use commit timestamp as fallback
        core.warning(`GitHub API error for commit ${commitSha}: ${apiError.message}`);
        commitTime = new Date(commit.timestamp);
      }

      // Calculate lead time in seconds
      const leadTimeSeconds = (deploymentTime - commitTime) / 1000;

      // Filter outliers and invalid values
      const maxLeadTimeSeconds = MAX_LEAD_TIME_DAYS * 24 * 60 * 60;
      if (leadTimeSeconds < 0) {
        core.warning(`Negative lead time detected for commit ${commitSha}, skipping`);
        continue;
      }

      if (leadTimeSeconds > maxLeadTimeSeconds) {
        core.warning(`Lead time exceeds ${MAX_LEAD_TIME_DAYS} days for commit ${commitSha}, using max value`);
        validLeadTimes.push(maxLeadTimeSeconds);
      } else {
        validLeadTimes.push(leadTimeSeconds);
        core.info(`Lead time for commit ${commitSha}: ${Math.round(leadTimeSeconds / 60)} minutes`);
      }
    } catch (error) {
      const commitSha = (commit.sha || commit.id)?.substring(0, 7);
      core.warning(`Failed to calculate lead time for commit ${commitSha}: ${error.message}`);
    }
  }

  if (validLeadTimes.length === 0) {
    return null;
  }

  // Calculate mean
  const sum = validLeadTimes.reduce((a, b) => a + b, 0);
  const mean = sum / validLeadTimes.length;
  core.info(`Average lead time for this deployment: ${Math.round(mean / 60)} minutes (${validLeadTimes.length} commits)`);

  return mean;
}

/**
 * Calculate cycle times for commits using YouGile API
 * @param {Array} commits - Array of commit objects
 * @param {Object} yogileInstance - YouGile API instance
 * @returns {Promise<number|null>} - Mean cycle time in seconds or null
 */
async function calculateCycleTimes(commits, yogileInstance) {
  if (!yogileInstance) {
    core.warning('YouGile instance not provided, skipping cycle time calculation');
    return null;
  }

  const deploymentTime = new Date();
  const validCycleTimes = [];

  for (const commit of commits) {
    try {
      // Extract task ID from commit message (format: TECH-XXXX)
      const taskIdMatch = commit.message.match(/([A-Z]+-\d+)/);
      if (!taskIdMatch) {
        continue; // Skip commits without task ID
      }

      const taskId = taskIdMatch[1];

      // Get task from YouGile API
      const task = await yogileInstance.getTask(taskId);
      if (!task) {
        core.warning(`Task ${taskId} not found in YouGile`);
        continue;
      }

      // Get task creation timestamp
      const taskCreatedTime = new Date(task.timestamp || task.created || task.createdAt);

      if (isNaN(taskCreatedTime.getTime())) {
        core.warning(`Invalid timestamp for task ${taskId}, skipping cycle time`);
        continue;
      }

      // Calculate cycle time in seconds
      const cycleTimeSeconds = (deploymentTime - taskCreatedTime) / 1000;

      // Filter outliers and invalid values
      const maxCycleTimeSeconds = MAX_CYCLE_TIME_DAYS * 24 * 60 * 60;
      if (cycleTimeSeconds < 0) {
        core.warning(`Negative cycle time detected for task ${taskId}, skipping`);
        continue;
      }

      if (cycleTimeSeconds > maxCycleTimeSeconds) {
        core.warning(`Cycle time exceeds ${MAX_CYCLE_TIME_DAYS} days for task ${taskId}, using max value`);
        validCycleTimes.push(maxCycleTimeSeconds);
      } else {
        validCycleTimes.push(cycleTimeSeconds);
        const cycleDays = Math.round(cycleTimeSeconds / 86400);
        core.info(`Cycle time for task ${taskId}: ${cycleDays} days`);
      }
    } catch (error) {
      const commitSha = (commit.sha || commit.id)?.substring(0, 7);
      core.warning(`Failed to calculate cycle time for commit ${commitSha}: ${error.message}`);
    }
  }

  if (validCycleTimes.length === 0) {
    return null;
  }

  // Calculate mean
  const sum = validCycleTimes.reduce((a, b) => a + b, 0);
  const mean = sum / validCycleTimes.length;
  core.info(`Average cycle time for this deployment: ${Math.round(mean / 86400)} days (${validCycleTimes.length} tasks)`);

  return mean;
}

/**
 * Calculate Mean Time to Recovery (MTTR) for this specific deployment failure
 * @param {Array} commits - Array of commit objects
 * @param {string} ref - Git ref
 * @returns {Promise<number|null>} - Recovery time in seconds or null
 */
async function calculateMTTR(commits, ref) {
  const deploymentTime = new Date();

  // Find earliest commit in the release
  const commitTimes = commits.map(c => new Date(c.timestamp));
  const incidentStart = new Date(Math.min(...commitTimes));
  const recoveryTimeSeconds = (deploymentTime - incidentStart) / 1000;

  if (recoveryTimeSeconds <= 0) {
    return null;
  }

  // Check for revert commits first
  const hasRevertCommit = commits.some(commit => extractIncidentType(commit.message, ref) === 'revert');
  if (hasRevertCommit) {
    core.info(`MTTR for revert incident: ${Math.round(recoveryTimeSeconds / 60)} minutes`);
    return recoveryTimeSeconds;
  }

  // Check for hotfix deployment from ref
  const incidentType = extractIncidentType('', ref);
  if (incidentType === 'hotfix') {
    core.info(`MTTR for hotfix deployment: ${Math.round(recoveryTimeSeconds / 60)} minutes`);
    return recoveryTimeSeconds;
  }

  return null;
}

/**
 * Detect if the deployment has failures (revert commits or hotfix deployments)
 * @param {Array} commits - Array of commit objects
 * @param {string} ref - Git ref (e.g., refs/heads/hotfix/fix-bug)
 * @returns {boolean} - True if deployment has failures
 */
function detectFailures(commits, ref) {
  const hasRevert = commits.some(commit => isRevertCommit(commit.message));
  const isHotfix = isHotfixDeployment(ref);
  return hasRevert || isHotfix;
}

/**
 * Push metrics to Pushgateway with retry logic
 * @param {Registry} registry - Prometheus registry
 * @param {Object} config - Configuration object
 * @param {number} maxRetries - Maximum number of retry attempts
 */
async function pushWithRetry(registry, config, maxRetries) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await pushMetricsToPushgateway(registry, config);
      core.info('Successfully pushed DORA metrics to Pushgateway');
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        throw new Error(`Failed to push metrics after ${maxRetries} attempts: ${error.message}`);
      }
      const delay = RETRY_DELAY_MS * attempt;
      core.warning(`Push attempt ${attempt} failed, retrying in ${delay}ms: ${error.message}`);
      await sleep(delay);
    }
  }
}

/**
 * Push metrics to Prometheus Pushgateway
 * @param {Registry} registry - Prometheus registry
 * @param {Object} config - Configuration object
 */
async function pushMetricsToPushgateway(registry, config) {
  const { pushgatewayUrl, jobName, repository, projectName, environment = 'production' } = config;

  // Generate unique deployment ID to preserve history in Pushgateway
  const deploymentId = Math.floor(Date.now() / 1000).toString();

  // Construct Pushgateway URL with grouping keys
  // Adding deployment_id ensures each deployment creates a separate metric group
  // This allows count() queries to work correctly for deployment frequency
  const url = `${pushgatewayUrl}/metrics/job/${encodeURIComponent(jobName)}/project/${encodeURIComponent(projectName)}/repository/${encodeURIComponent(repository)}/environment/${encodeURIComponent(environment)}/deployment_id/${deploymentId}`;

  const metrics = await registry.metrics();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain; version=0.0.4'
    },
    body: metrics
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  core.info(`Pushed metrics to ${url}`);
}

/**
 * Sleep utility function
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  recordAndPushMetrics,
  calculateLeadTimes,
  calculateCycleTimes,
  calculateMTTR,
  detectFailures
};

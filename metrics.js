/**
 * DORA Metrics Module
 * Calculates and exports DORA metrics to Prometheus Pushgateway
 */

const core = require('@actions/core');
const github = require('@actions/github');
const { Counter, Histogram, Registry } = require('prom-client');
const { isRevertCommit, isHotfixDeployment, extractIncidentType } = require('./detectors');

// Constants
const LEAD_TIME_BUCKETS = [60, 300, 900, 3600, 7200, 21600, 86400, 172800, 604800]; // 1min - 7days
const CYCLE_TIME_BUCKETS = [3600, 21600, 86400, 172800, 604800, 1209600, 2592000, 5184000, 7776000]; // 1h, 6h, 1d, 2d, 7d, 14d, 30d, 60d, 90d
const MTTR_BUCKETS = [300, 900, 1800, 3600, 7200, 14400, 28800, 86400]; // 5min - 1day
const MAX_LEAD_TIME_DAYS = 30; // Filter outliers
const MAX_CYCLE_TIME_DAYS = 180; // 6 months - filter extreme outliers
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

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

  // Define metrics
  const deploymentCounter = new Counter({
    name: 'deployment_total',
    help: 'Total number of deployments',
    labelNames: ['project', 'repository', 'environment'],
    registers: [registry]
  });

  const leadTimeHistogram = new Histogram({
    name: 'deployment_lead_time_seconds',
    help: 'Lead time from first commit to deployment in seconds',
    labelNames: ['project', 'repository', 'environment'],
    buckets: LEAD_TIME_BUCKETS,
    registers: [registry]
  });

  const failureCounter = new Counter({
    name: 'deployment_failures_total',
    help: 'Total number of failed deployments',
    labelNames: ['project', 'repository', 'environment'],
    registers: [registry]
  });

  const mttrHistogram = new Histogram({
    name: 'incident_recovery_time_seconds',
    help: 'Time to recover from incidents in seconds',
    labelNames: ['project', 'repository', 'environment', 'incident_type'],
    buckets: MTTR_BUCKETS,
    registers: [registry]
  });

  const cycleTimeHistogram = new Histogram({
    name: 'cycle_time_seconds',
    help: 'Cycle time from task creation to deployment in seconds',
    labelNames: ['project', 'repository', 'environment'],
    buckets: CYCLE_TIME_BUCKETS,
    registers: [registry]
  });

  const labels = { project: projectName, repository, environment };

  // 1. Record deployment
  deploymentCounter.inc(labels);
  core.info(`Recorded deployment for ${projectName} in ${environment}`);

  // 2. Calculate and record Lead Time
  try {
    await calculateLeadTimes(commits, githubToken, leadTimeHistogram, labels);
  } catch (error) {
    core.warning(`Failed to calculate lead times: ${error.message}`);
  }

  // 3. Calculate and record Cycle Time (if YouGile available)
  if (yogileInstance) {
    try {
      await calculateCycleTimes(commits, yogileInstance, cycleTimeHistogram, labels);
    } catch (error) {
      core.warning(`Failed to calculate cycle times: ${error.message}`);
    }
  }

  // 4. Detect failures and calculate MTTR
  const hasFailure = detectFailures(commits);
  if (hasFailure) {
    failureCounter.inc(labels);
    core.info('Detected deployment failure (revert commit found)');
  }

  // 5. Calculate MTTR
  try {
    await calculateMTTR(commits, ref, mttrHistogram, labels);
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
 * @param {Histogram} leadTimeHistogram - Lead time histogram metric
 * @param {Object} labels - Metric labels
 */
async function calculateLeadTimes(commits, githubToken, leadTimeHistogram, labels) {
  if (!githubToken) {
    core.warning('GitHub token not provided, skipping lead time calculation');
    return;
  }

  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = github.context.repo;
  const deploymentTime = new Date();

  for (const commit of commits) {
    try {
      let commitTime;

      // Try to get PR information for this commit
      try {
        const { data: pulls } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
          owner,
          repo,
          commit_sha: commit.sha || commit.id
        });

        if (pulls && pulls.length > 0) {
          const pr = pulls[0];
          commitTime = new Date(pr.created_at);
          const commitSha = (commit.sha || commit.id)?.substring(0, 7);
          core.info(`Commit ${commitSha} linked to PR #${pr.number}, created at ${pr.created_at}`);
        } else {
          // Fallback: use commit timestamp
          commitTime = new Date(commit.timestamp);
          const commitSha = (commit.sha || commit.id)?.substring(0, 7);
          core.info(`Commit ${commitSha} has no associated PR, using commit timestamp`);
        }
      } catch (apiError) {
        // GitHub API rate limit or other error - use commit timestamp as fallback
        const commitSha = (commit.sha || commit.id)?.substring(0, 7);
        core.warning(`GitHub API error for commit ${commitSha}: ${apiError.message}`);
        commitTime = new Date(commit.timestamp);
      }

      // Calculate lead time in seconds
      const leadTimeSeconds = (deploymentTime - commitTime) / 1000;

      // Filter outliers and invalid values
      const maxLeadTimeSeconds = MAX_LEAD_TIME_DAYS * 24 * 60 * 60;
      const commitSha = (commit.sha || commit.id)?.substring(0, 7);
      if (leadTimeSeconds < 0) {
        core.warning(`Negative lead time detected for commit ${commitSha}, skipping`);
        continue;
      }

      if (leadTimeSeconds > maxLeadTimeSeconds) {
        core.warning(`Lead time exceeds ${MAX_LEAD_TIME_DAYS} days for commit ${commitSha}, capping value`);
        leadTimeHistogram.observe(labels, maxLeadTimeSeconds);
      } else {
        leadTimeHistogram.observe(labels, leadTimeSeconds);
        core.info(`Lead time for commit ${commitSha}: ${Math.round(leadTimeSeconds / 60)} minutes`);
      }
    } catch (error) {
      const commitSha = (commit.sha || commit.id)?.substring(0, 7);
      core.warning(`Failed to calculate lead time for commit ${commitSha}: ${error.message}`);
    }
  }
}

/**
 * Calculate cycle times for commits using YouGile API
 * @param {Array} commits - Array of commit objects
 * @param {Object} yogileInstance - YouGile API instance
 * @param {Histogram} cycleTimeHistogram - Cycle time histogram metric
 * @param {Object} labels - Metric labels
 */
async function calculateCycleTimes(commits, yogileInstance, cycleTimeHistogram, labels) {
  if (!yogileInstance) {
    core.warning('YouGile instance not provided, skipping cycle time calculation');
    return;
  }

  const deploymentTime = new Date();

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
      // YouGile API may have fields: timestamp, created, createdAt, etc.
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
        core.warning(`Cycle time exceeds ${MAX_CYCLE_TIME_DAYS} days for task ${taskId}, capping value`);
        cycleTimeHistogram.observe(labels, maxCycleTimeSeconds);
      } else {
        cycleTimeHistogram.observe(labels, cycleTimeSeconds);
        const cycleDays = Math.round(cycleTimeSeconds / 86400);
        core.info(`Cycle time for task ${taskId}: ${cycleDays} days`);
      }
    } catch (error) {
      const commitSha = (commit.sha || commit.id)?.substring(0, 7);
      core.warning(`Failed to calculate cycle time for commit ${commitSha}: ${error.message}`);
    }
  }
}

/**
 * Calculate Mean Time to Recovery (MTTR)
 * @param {Array} commits - Array of commit objects
 * @param {string} ref - Git ref
 * @param {Histogram} mttrHistogram - MTTR histogram metric
 * @param {Object} labels - Metric labels
 */
async function calculateMTTR(commits, ref, mttrHistogram, labels) {
  const deploymentTime = new Date();

  // Find earliest commit in the release
  const commitTimes = commits.map(c => new Date(c.timestamp));
  const incidentStart = new Date(Math.min(...commitTimes));
  const recoveryTimeSeconds = (deploymentTime - incidentStart) / 1000;

  if (recoveryTimeSeconds <= 0) {
    return;
  }

  // Check for revert commits first
  const hasRevertCommit = commits.some(commit => extractIncidentType(commit.message, ref) === 'revert');
  if (hasRevertCommit) {
    mttrHistogram.observe({ ...labels, incident_type: 'revert' }, recoveryTimeSeconds);
    core.info(`MTTR for revert incident: ${Math.round(recoveryTimeSeconds / 60)} minutes`);
    return;
  }

  // Check for hotfix deployment from ref
  const incidentType = extractIncidentType('', ref);
  if (incidentType === 'hotfix') {
    mttrHistogram.observe({ ...labels, incident_type: 'hotfix' }, recoveryTimeSeconds);
    core.info(`MTTR for hotfix deployment: ${Math.round(recoveryTimeSeconds / 60)} minutes`);
  }
}

/**
 * Detect if the deployment has failures (revert commits)
 * @param {Array} commits - Array of commit objects
 * @returns {boolean} - True if deployment has failures
 */
function detectFailures(commits) {
  return commits.some(commit => isRevertCommit(commit.message));
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
  const { pushgatewayUrl, jobName, repository, projectName } = config;

  // Construct Pushgateway URL
  // Format: http://pushgateway/metrics/job/{job}
  // Note: All other labels (project, repository, environment) are embedded in the metrics themselves
  const url = `${pushgatewayUrl}/metrics/job/${encodeURIComponent(jobName)}`;

  const metrics = await registry.metrics();

  const response = await fetch(url, {
    method: 'PUT',
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

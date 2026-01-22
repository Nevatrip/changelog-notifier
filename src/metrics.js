/**
 * DORA Metrics Module
 * Calculates and exports DORA metrics to InfluxDB
 */

const core = require('@actions/core');
const github = require('@actions/github');
const { isRevertCommit, isHotfixDeployment, extractIncidentType } = require('./detectors');
const { hasTaskId, TASK_ID_PATTERN } = require('./parsing');

// Constants
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
 * @param {string} config.influxdbUrl - InfluxDB URL (e.g., http://localhost:8181)
 * @param {string} config.influxdbBucket - InfluxDB bucket name (default: default)
 * @param {string} config.environment - Deployment environment (default: production)
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

  const timestamp = Date.now() * 1000000; // nanoseconds for InfluxDB
  const hasTask = commits.some(commit => hasTaskId(commit.message));

  // Common tags for all metrics
  const tags = {
    project: projectName,
    repository,
    environment,
    has_task: hasTask ? 'yes' : 'no'
  };

  const metrics = [];

  // 1. Record deployment (for Deployment Frequency)
  metrics.push(createLineProtocol('deployment', tags, { count: 1 }, timestamp));
  core.info(`Recorded deployment for ${projectName} in ${environment}`);

  // 2. Calculate and record Lead Time
  try {
    const avgLeadTime = await calculateLeadTimes(commits, githubToken);
    if (avgLeadTime !== null) {
      metrics.push(createLineProtocol('lead_time', tags, { seconds: avgLeadTime }, timestamp));
    }
  } catch (error) {
    core.warning(`Failed to calculate lead times: ${error.message}`);
  }

  // 3. Calculate and record Cycle Time (if YouGile available)
  if (yogileInstance) {
    try {
      const avgCycleTime = await calculateCycleTimes(commits, yogileInstance);
      if (avgCycleTime !== null) {
        metrics.push(createLineProtocol('cycle_time', tags, { seconds: avgCycleTime }, timestamp));
      }
    } catch (error) {
      core.warning(`Failed to calculate cycle times: ${error.message}`);
    }
  }

  // 4. Detect failures (for Change Failure Rate)
  const hasFailure = detectFailures(commits, ref);
  if (hasFailure) {
    metrics.push(createLineProtocol('deployment_failure', tags, { count: 1 }, timestamp));
    core.info('Detected deployment failure (revert or hotfix detected)');
  }

  // 5. Calculate MTTR
  try {
    const recoveryTime = await calculateMTTR(commits, ref);
    if (recoveryTime !== null) {
      const hasRevertCommit = commits.some(commit => extractIncidentType(commit.message, ref) === 'revert');
      const incidentType = hasRevertCommit ? 'revert' : (extractIncidentType('', ref) === 'hotfix' ? 'hotfix' : 'unknown');

      const mttrTags = { ...tags, incident_type: incidentType };
      metrics.push(createLineProtocol('mttr', mttrTags, { seconds: recoveryTime }, timestamp));
    }
  } catch (error) {
    core.warning(`Failed to calculate MTTR: ${error.message}`);
  }

  // 6. Push metrics to InfluxDB
  if (metrics.length > 0) {
    await pushWithRetry(metrics, config, RETRY_ATTEMPTS);
  }
}

/**
 * Create InfluxDB line protocol string
 * @param {string} measurement - Measurement name
 * @param {Object} tags - Tags object
 * @param {Object} fields - Fields object
 * @param {number} timestamp - Timestamp in nanoseconds
 * @returns {string} - Line protocol string
 */
function createLineProtocol(measurement, tags, fields, timestamp) {
  const tagStr = Object.entries(tags)
    .map(([k, v]) => `${escapeTag(k)}=${escapeTag(String(v))}`)
    .join(',');

  const fieldStr = Object.entries(fields)
    .map(([k, v]) => `${escapeTag(k)}=${formatFieldValue(v)}`)
    .join(',');

  return `${measurement},${tagStr} ${fieldStr} ${timestamp}`;
}

/**
 * Escape special characters for InfluxDB line protocol tags
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
function escapeTag(str) {
  return str.replace(/[,= ]/g, '\\$&');
}

/**
 * Format field value for InfluxDB line protocol
 * @param {*} value - Value to format
 * @returns {string} - Formatted value
 */
function formatFieldValue(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? `${value}i` : value.toString();
  }
  if (typeof value === 'boolean') {
    return value.toString();
  }
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

/**
 * Get PR information for a commit
 * @param {string} commitSha - Commit SHA
 * @param {Object} octokit - GitHub API client
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<Object|null>} - PR object or null
 */
async function getPRInfo(commitSha, octokit, owner, repo) {
  try {
    const { data: pulls } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
      owner,
      repo,
      commit_sha: commitSha
    });
    return pulls && pulls.length > 0 ? pulls[0] : null;
  } catch (error) {
    core.warning(`GitHub API error getting PR for commit ${commitSha}: ${error.message}`);
    return null;
  }
}

/**
 * Get first commit time from a PR
 * @param {Object} pr - PR object
 * @param {Object} octokit - GitHub API client
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<Date|null>} - First commit time or null
 */
async function getFirstCommitTime(pr, octokit, owner, repo) {
  try {
    const { data: prCommits } = await octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number: pr.number,
      per_page: 100
    });

    if (prCommits && prCommits.length > 0) {
      const firstCommit = prCommits[0];
      return new Date(firstCommit.commit.author.date || firstCommit.commit.committer.date);
    }
    return null;
  } catch (error) {
    core.warning(`Failed to get PR commits for #${pr.number}: ${error.message}`);
    return null;
  }
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
      const commitSha = (commit.sha || commit.id)?.substring(0, 7);
      const fullCommitSha = commit.sha || commit.id;

      // Get PR information for this commit
      const pr = await getPRInfo(fullCommitSha, octokit, owner, repo);

      let commitTime;
      if (pr) {
        // Get first commit time from PR
        commitTime = await getFirstCommitTime(pr, octokit, owner, repo);
        if (commitTime) {
          core.info(`Commit ${commitSha} linked to PR #${pr.number}, first commit at ${commitTime.toISOString()}`);
        } else {
          // Fallback to current commit timestamp
          commitTime = new Date(commit.timestamp);
          core.info(`PR #${pr.number} has no commits, using commit timestamp`);
        }
      } else {
        // No PR found, use commit timestamp
        commitTime = new Date(commit.timestamp);
        core.info(`Commit ${commitSha} has no associated PR, using commit timestamp`);
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
      const taskIdMatch = commit.message.match(TASK_ID_PATTERN);
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
 * Push metrics to InfluxDB with retry logic
 * @param {Array} metrics - Array of line protocol strings
 * @param {Object} config - Configuration object
 * @param {number} maxRetries - Maximum number of retry attempts
 */
async function pushWithRetry(metrics, config, maxRetries) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await pushMetricsToInfluxDB(metrics, config);
      core.info('Successfully pushed DORA metrics to InfluxDB');
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
 * Push metrics to InfluxDB
 * @param {Array} metrics - Array of line protocol strings
 * @param {Object} config - Configuration object
 */
async function pushMetricsToInfluxDB(metrics, config) {
  const { influxdbUrl, influxdbBucket = 'default' } = config;

  const url = `${influxdbUrl}/write?db=${encodeURIComponent(influxdbBucket)}&precision=ns`;
  const body = metrics.join('\n');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8'
    },
    body
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  core.info(`Pushed ${metrics.length} metrics to ${url}`);
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
  detectFailures,
  createLineProtocol,
  escapeTag,
  formatFieldValue,
  // Export constants for testing
  MAX_LEAD_TIME_DAYS,
  MAX_CYCLE_TIME_DAYS,
  RETRY_ATTEMPTS,
  RETRY_DELAY_MS
};

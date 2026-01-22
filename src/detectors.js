/**
 * Pattern detectors for DORA metrics
 * Detects revert commits and hotfix deployments
 */

/**
 * Detects if a commit message indicates a revert
 * @param {string} message - Commit message
 * @returns {boolean} - True if the commit is a revert
 */
function isRevertCommit(message) {
  if (!message) {
    return false;
  }

  const revertPatterns = [
    /^revert[\(\:\s]/i,                 // revert(TASK-ID), revert:, or revert (case-insensitive)
    /^Revert\s+"/,                      // Standard git revert format: Revert "..."
    /\brevert\s+commit\b/i,             // Contains "revert commit"
    /\brollback\b/i                     // Contains "rollback"
  ];

  return revertPatterns.some(pattern => pattern.test(message));
}

/**
 * Detects if a deployment is from a hotfix branch
 * @param {string} ref - Git ref (e.g., refs/heads/hotfix/critical)
 * @returns {boolean} - True if the deployment is from a hotfix branch
 */
function isHotfixDeployment(ref) {
  if (!ref) {
    return false;
  }

  const hotfixPatterns = [
    /hotfix\//,                         // hotfix/
    /hotfix-/,                          // hotfix-
    /fix-/,                             // fix-
    /fix\//,                             // fix/
    /emergency\//                       // emergency/
  ];

  return hotfixPatterns.some(pattern => pattern.test(ref));
}

/**
 * Extracts the incident type from commit message or ref
 * @param {string} message - Commit message
 * @param {string} ref - Git ref
 * @returns {string|null} - Incident type ('revert' or 'hotfix') or null
 */
function extractIncidentType(message, ref) {
  if (isRevertCommit(message)) {
    return 'revert';
  }

  if (isHotfixDeployment(ref)) {
    return 'hotfix';
  }

  return null;
}

module.exports = {
  isRevertCommit,
  isHotfixDeployment,
  extractIncidentType
};

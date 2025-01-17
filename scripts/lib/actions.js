// Helpers for writing GitHub Actions workflow commands to stdout.
// The checks only ever report through annotations and the exit code: no comments, no reviews.
import { pathToFileURL } from 'node:url';

/**
 * Escape a message for a workflow command (`::error::<message>`).
 * @param {string} s
 */
export function escapeData(s) {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/**
 * Escape a property value (`file=`, `title=`) for a workflow command.
 * @param {string} s
 */
export function escapeProperty(s) {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/**
 * Format an error annotation.
 * @param {string} message
 * @param {Record<string, string | number | undefined>} [props]
 */
export function errorCommand(message, props = {}) {
  const parts = Object.entries(props)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${escapeProperty(String(v))}`);
  return `::error${parts.length ? ' ' + parts.join(',') : ''}::${escapeData(message)}`;
}

/**
 * True when the module at `url` is the script node was started with.
 * @param {string} url import.meta.url of the caller
 */
export function isMain(url) {
  return Boolean(process.argv[1]) && url === pathToFileURL(process.argv[1]).href;
}

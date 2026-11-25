// Runs a tool's matches on all cores. A tool calls pool(__filename, jobs) in the main thread, where a job
// is { from, to, ... }, and work(fn) in the worker; results come back in job order, whatever the core count.
const { Worker, isMainThread, parentPort } = require('worker_threads');
const os = require('os');

/** Split n matches into chunks and run them; resolves to the array of chunk results. */
function pool(file, n, extra = {}, chunk = 50) {
  const jobs = [];
  for (let i = 0; i < n; i += chunk) jobs.push(Object.assign({ from: i, to: Math.min(n, i + chunk) }, extra));
  const out = new Array(jobs.length);
  let next = 0, left = jobs.length;
  return new Promise((resolve, reject) => {
    const size = Math.min(jobs.length, +process.env.JOBS || os.cpus().length);
    for (let i = 0; i < size; i++) {
      const w = new Worker(file);
      const feed = () => { if (next < jobs.length) { const k = next++; w.postMessage({ k, job: jobs[k] }); } else w.terminate(); };
      w.on('message', ({ k, r }) => { out[k] = r; if (!--left) resolve(out); feed(); });
      w.on('error', reject);
      feed();
    }
  });
}
function work(fn) { parentPort.on('message', ({ k, job }) => parentPort.postMessage({ k, r: fn(job) })); }

/** Mean and 95% interval half-width of an array of numbers. */
function ci(xs) {
  const n = xs.length, mean = xs.reduce((a, b) => a + b, 0) / n;
  const v = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n - 1);
  return { mean, half: 1.96 * Math.sqrt(v / n) };
}
module.exports = { pool, work, ci, isMainThread };

#!/usr/bin/env node
// Frees the ports the Playwright suite serves its builds on.
//
// playwright.config.ts sets `reuseExistingServer: false` on purpose: reusing
// a server means skipping the build in front of it, and a suite that tests
// last hour's artifact while reporting green is worse than one that fails.
// The cost of that strictness is that a server left behind by an interrupted
// run blocks the next one, so `npm run e2e` clears the ports first.
//
// Only ports this repo's own preview servers use, and only processes
// listening on them. Nothing else is touched.
import { execFileSync } from 'node:child_process';

const PORTS = [4173, 4174];

function listeningPids(port) {
  const pids = new Set();
  try {
    const out =
      process.platform === 'win32'
        ? execFileSync('netstat', ['-ano'], { encoding: 'utf8' })
        : execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' });

    if (process.platform !== 'win32') {
      for (const line of out.split('\n')) if (line.trim()) pids.add(line.trim());
      return [...pids];
    }

    for (const line of out.split('\n')) {
      if (!/LISTENING/i.test(line)) continue;
      const columns = line.trim().split(/\s+/);
      const local = columns[1] ?? '';
      if (!local.endsWith(`:${port}`)) continue;
      const pid = columns[columns.length - 1];
      if (pid && pid !== '0') pids.add(pid);
    }
  } catch {
    // No listener, or the tool is unavailable. Either way there is nothing
    // to free, and failing here would block a suite that would have run.
  }
  return [...pids];
}

let freed = 0;
for (const port of PORTS) {
  for (const pid of listeningPids(port)) {
    try {
      if (process.platform === 'win32')
        execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
      else process.kill(Number(pid), 'SIGKILL');
      console.log(`Freed port ${port} (pid ${pid}).`);
      freed += 1;
    } catch {
      console.warn(`Could not free port ${port} (pid ${pid}). Playwright will say so.`);
    }
  }
}

if (freed === 0) console.log('Ports 4173 and 4174 are already free.');

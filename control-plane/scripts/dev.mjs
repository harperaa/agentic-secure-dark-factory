#!/usr/bin/env node
// Run the Next.js dev server and the Convex dev deployment together, because running only the
// first lets the backend drift from the frontend: a new Convex function typechecks locally and
// the page compiles, then the browser asks a deployment that has never heard of it and fails
// with "Could not find public function". Both halves belong to one local runtime.
//
// No dependency: package.json is a forced-gray path (design §12.2), so a dev-only process
// runner is not worth a human review on every product that inherits this template.
//
// Either child exiting stops the other, so Ctrl-C leaves nothing orphaned holding port 3000.
import { spawn } from 'node:child_process';

const children = [
  { name: 'next', command: 'next', args: ['dev'] },
  // --typecheck-components is off: Next already typechecks the app, and doubling it slows the
  // push loop that makes running Convex alongside worth it.
  { name: 'convex', command: 'npx', args: ['convex', 'dev'] },
];

const running = new Map();
let shuttingDown = false;
let exitCode = 0;

function stopAll(signal = 'SIGTERM') {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const [name, child] of running) {
    if (child.exitCode === null && child.signalCode === null) {
      process.stderr.write(`[dev] stopping ${name}\n`);
      child.kill(signal);
    }
  }
}

for (const { name, command, args } of children) {
  // stdio inherited: both servers draw their own progress output, and piping it through a
  // prefixer would strip the colour and cursor control that make them readable.
  const child = spawn(command, args, { stdio: 'inherit', shell: false });

  child.on('error', (err) => {
    process.stderr.write(`[dev] ${name} failed to start: ${err.message}\n`);
    exitCode = 1;
    stopAll();
  });

  child.on('exit', (code, signal) => {
    running.delete(name);
    if (!shuttingDown) {
      // A child exiting on its own is the interesting case: report which one, then take the
      // other down so the failure is not hidden behind a server that is still running.
      process.stderr.write(`[dev] ${name} exited (${signal ?? code}); stopping the rest\n`);
      exitCode = code ?? 1;
      stopAll();
    }
  });

  running.set(name, child);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    exitCode = 0;
    stopAll(signal);
  });
}

process.on('exit', () => stopAll('SIGKILL'));

// Exit only once both children are gone, so the shell prompt does not return over live output.
const waitForChildren = setInterval(() => {
  if (running.size === 0) {
    clearInterval(waitForChildren);
    process.exit(exitCode);
  }
}, 100);

import type { Sandbox, Process } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';
import { MOLTBOT_PORT, STARTUP_TIMEOUT_MS } from '../config';
import { buildEnvVars } from './env';
import { mountR2Storage } from './r2';

/**
 * Find an existing OpenClaw gateway process
 *
 * @param sandbox - The sandbox instance
 * @returns The process if found and running/starting, null otherwise
 */
const PROCESS_VERSION = 'v3-hardcoded-token'; // Update this to force restart

/**
 * Find an existing OpenClaw gateway process matching checks
 *
 * @param sandbox - The sandbox instance
 * @param matchVersion - Whether to strictly match the current PROCESS_VERSION
 * @returns The process if found, null otherwise
 */
export async function findMoltbotProcess(sandbox: Sandbox, matchVersion: boolean = true): Promise<Process | null> {
  try {
    const processes = await sandbox.listProcesses();
    for (const proc of processes) {
      // Check if it's a gateway process
      const isGateway = proc.command.includes('start-openclaw.sh') ||
        proc.command.includes('openclaw gateway') ||
        proc.command.includes('clawdbot gateway');

      // Check if it's NOT a CLI command
      const isCli = proc.command.includes('openclaw devices') ||
        proc.command.includes('openclaw --version');

      if (isGateway && !isCli && (proc.status === 'starting' || proc.status === 'running')) {
        // Check version match
        const hasVersion = proc.command.includes(`echo ${PROCESS_VERSION}`);
        if (matchVersion) {
          if (hasVersion) return proc;
        } else {
          // Identify old process (does not have current version)
          if (!hasVersion) return proc;
        }
      }
    }
  } catch (e) {
    console.log('Could not list processes:', e);
  }
  return null;
}

export async function findExistingMoltbotProcess(sandbox: Sandbox): Promise<Process | null> {
  return findMoltbotProcess(sandbox, true);
}

/**
 * Ensure the OpenClaw gateway is running
 */
export async function ensureMoltbotGateway(sandbox: Sandbox, env: MoltbotEnv): Promise<Process> {
  // Mount R2 storage
  await mountR2Storage(sandbox, env);

  // 1. Cleanup OLD processes (Smart Restart)
  const oldProcess = await findMoltbotProcess(sandbox, false);
  if (oldProcess) {
    console.log(`[SmartRestart] Found old process ${oldProcess.id} (cmd: ${oldProcess.command}). Killing...`);
    try {
      await oldProcess.kill();
      // Wait a moment to ensure it's gone
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {
      console.error('[SmartRestart] Failed to kill old process:', e);
    }
  }

  // 2. Check for CURRENT process
  const existingProcess = await findExistingMoltbotProcess(sandbox);
  if (existingProcess) {
    console.log('Found running gateway process:', existingProcess.id);
    try {
      await existingProcess.waitForPort(MOLTBOT_PORT, { mode: 'tcp', timeout: STARTUP_TIMEOUT_MS });
      return existingProcess;
    } catch (_e) {
      console.log('Existing process stuck, restarting...');
      try { await existingProcess.kill(); } catch (e) { /* ignore */ }
    }
  }

  // 3. Start NEW process with Version Tag
  console.log(`Starting new OpenClaw gateway (${PROCESS_VERSION})...`);
  const envVars = buildEnvVars(env);

  // Trick: Add version to command so we can identify it later
  const command = `sh -c "echo ${PROCESS_VERSION} && /usr/local/bin/start-openclaw.sh"`;

  try {
    const process = await sandbox.startProcess(command, {
      env: Object.keys(envVars).length > 0 ? envVars : undefined,
    });
    console.log('Process started with id:', process.id);

    // Wait for ready
    await process.waitForPort(MOLTBOT_PORT, { mode: 'tcp', timeout: STARTUP_TIMEOUT_MS });
    return process;
  } catch (startErr) {
    console.error('Failed to start process:', startErr);
    throw startErr;
  }
}

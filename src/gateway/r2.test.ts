import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountR2Storage } from './r2';
import type { Sandbox } from '@cloudflare/sandbox';
import type { ClawdbotEnv } from '../types';

// Helper to create a minimal env object
function createEnv(overrides: Partial<ClawdbotEnv> = {}): ClawdbotEnv {
  return {
    Sandbox: {} as any,
    ASSETS: {} as any,
    CLAWDBOT_BUCKET: {} as any,
    ...overrides,
  };
}

// Helper to create a mock sandbox
function createMockSandbox(): { sandbox: Sandbox; mountBucketMock: ReturnType<typeof vi.fn> } {
  const mountBucketMock = vi.fn().mockResolvedValue(undefined);
  const sandbox = {
    mountBucket: mountBucketMock,
    listProcesses: vi.fn(),
    startProcess: vi.fn(),
    containerFetch: vi.fn(),
    wsConnect: vi.fn(),
  } as unknown as Sandbox;

  return { sandbox, mountBucketMock };
}

describe('mountR2Storage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns false when AWS_ACCESS_KEY_ID is missing', async () => {
    const { sandbox } = createMockSandbox();
    const env = createEnv({
      AWS_SECRET_ACCESS_KEY: 'secret',
      CF_ACCOUNT_ID: 'account123',
    });

    const result = await mountR2Storage(sandbox, env);

    expect(result).toBe(false);
  });

  it('returns false when AWS_SECRET_ACCESS_KEY is missing', async () => {
    const { sandbox } = createMockSandbox();
    const env = createEnv({
      AWS_ACCESS_KEY_ID: 'key123',
      CF_ACCOUNT_ID: 'account123',
    });

    const result = await mountR2Storage(sandbox, env);

    expect(result).toBe(false);
  });

  it('returns false when CF_ACCOUNT_ID is missing', async () => {
    const { sandbox } = createMockSandbox();
    const env = createEnv({
      AWS_ACCESS_KEY_ID: 'key123',
      AWS_SECRET_ACCESS_KEY: 'secret',
    });

    const result = await mountR2Storage(sandbox, env);

    expect(result).toBe(false);
  });

  it('returns false when all R2 credentials are missing', async () => {
    const { sandbox } = createMockSandbox();
    const env = createEnv();

    const result = await mountR2Storage(sandbox, env);

    expect(result).toBe(false);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('R2 storage not configured')
    );
  });

  it('mounts R2 bucket when all credentials are provided', async () => {
    const { sandbox, mountBucketMock } = createMockSandbox();
    const env = createEnv({
      AWS_ACCESS_KEY_ID: 'key123',
      AWS_SECRET_ACCESS_KEY: 'secret',
      CF_ACCOUNT_ID: 'account123',
    });

    const result = await mountR2Storage(sandbox, env);

    expect(result).toBe(true);
    expect(mountBucketMock).toHaveBeenCalledWith(
      'clawdbot-data',
      '/data/clawdbot',
      { endpoint: 'https://account123.r2.cloudflarestorage.com' }
    );
  });

  it('returns false when mountBucket throws an error', async () => {
    const { sandbox, mountBucketMock } = createMockSandbox();
    mountBucketMock.mockRejectedValue(new Error('Mount failed'));
    
    const env = createEnv({
      AWS_ACCESS_KEY_ID: 'key123',
      AWS_SECRET_ACCESS_KEY: 'secret',
      CF_ACCOUNT_ID: 'account123',
    });

    const result = await mountR2Storage(sandbox, env);

    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      'Failed to mount R2 bucket:',
      expect.any(Error)
    );
  });

  it('logs success message when mounted successfully', async () => {
    const { sandbox } = createMockSandbox();
    const env = createEnv({
      AWS_ACCESS_KEY_ID: 'key123',
      AWS_SECRET_ACCESS_KEY: 'secret',
      CF_ACCOUNT_ID: 'account123',
    });

    await mountR2Storage(sandbox, env);

    expect(console.log).toHaveBeenCalledWith(
      'R2 bucket mounted successfully - clawdbot data will persist across sessions'
    );
  });
});

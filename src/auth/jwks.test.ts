import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getJWKS, clearJWKSCache } from './jwks';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock crypto.subtle.importKey
const mockImportKey = vi.fn();
vi.stubGlobal('crypto', {
  subtle: {
    importKey: mockImportKey,
  },
});

describe('getJWKS', () => {
  beforeEach(() => {
    clearJWKSCache();
    mockFetch.mockReset();
    mockImportKey.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches JWKS from the correct URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ keys: [] }),
    });

    await getJWKS('myteam.cloudflareaccess.com');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://myteam.cloudflareaccess.com/cdn-cgi/access/certs'
    );
  });

  it('throws error when fetch fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(getJWKS('myteam.cloudflareaccess.com')).rejects.toThrow(
      'Failed to fetch JWKS from https://myteam.cloudflareaccess.com/cdn-cgi/access/certs: 500'
    );
  });

  it('imports RSA keys and returns a map', async () => {
    const mockCryptoKey = {} as CryptoKey;
    mockImportKey.mockResolvedValue(mockCryptoKey);
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        keys: [
          { kid: 'key1', kty: 'RSA', n: 'modulus', e: 'exponent' },
          { kid: 'key2', kty: 'RSA', n: 'modulus2', e: 'exponent2' },
        ],
      }),
    });

    const keys = await getJWKS('myteam.cloudflareaccess.com');

    expect(keys.size).toBe(2);
    expect(keys.has('key1')).toBe(true);
    expect(keys.has('key2')).toBe(true);
    expect(mockImportKey).toHaveBeenCalledTimes(2);
  });

  it('skips keys without kid', async () => {
    const mockCryptoKey = {} as CryptoKey;
    mockImportKey.mockResolvedValue(mockCryptoKey);
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        keys: [
          { kty: 'RSA', n: 'modulus', e: 'exponent' }, // no kid
          { kid: 'key1', kty: 'RSA', n: 'modulus', e: 'exponent' },
        ],
      }),
    });

    const keys = await getJWKS('myteam.cloudflareaccess.com');

    expect(keys.size).toBe(1);
    expect(keys.has('key1')).toBe(true);
  });

  it('skips non-RSA keys', async () => {
    const mockCryptoKey = {} as CryptoKey;
    mockImportKey.mockResolvedValue(mockCryptoKey);
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        keys: [
          { kid: 'key1', kty: 'EC', crv: 'P-256' }, // EC key, not RSA
          { kid: 'key2', kty: 'RSA', n: 'modulus', e: 'exponent' },
        ],
      }),
    });

    const keys = await getJWKS('myteam.cloudflareaccess.com');

    expect(keys.size).toBe(1);
    expect(keys.has('key2')).toBe(true);
    expect(mockImportKey).toHaveBeenCalledTimes(1);
  });

  it('caches JWKS and returns cached value on subsequent calls', async () => {
    const mockCryptoKey = {} as CryptoKey;
    mockImportKey.mockResolvedValue(mockCryptoKey);
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        keys: [{ kid: 'key1', kty: 'RSA', n: 'modulus', e: 'exponent' }],
      }),
    });

    // First call - should fetch
    await getJWKS('myteam.cloudflareaccess.com');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call - should use cache
    await getJWKS('myteam.cloudflareaccess.com');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refetches after cache expires', async () => {
    vi.useFakeTimers();
    
    const mockCryptoKey = {} as CryptoKey;
    mockImportKey.mockResolvedValue(mockCryptoKey);
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        keys: [{ kid: 'key1', kty: 'RSA', n: 'modulus', e: 'exponent' }],
      }),
    });

    // First call
    await getJWKS('myteam.cloudflareaccess.com');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance time past cache TTL (1 hour = 3600000ms)
    vi.advanceTimersByTime(3600001);

    // Third call - should refetch because cache expired
    await getJWKS('myteam.cloudflareaccess.com');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns same cache within TTL', async () => {
    vi.useFakeTimers();
    
    const mockCryptoKey = {} as CryptoKey;
    mockImportKey.mockResolvedValue(mockCryptoKey);
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        keys: [{ kid: 'key1', kty: 'RSA', n: 'modulus', e: 'exponent' }],
      }),
    });

    // First call
    await getJWKS('myteam.cloudflareaccess.com');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance time but stay within TTL (30 minutes)
    vi.advanceTimersByTime(1800000);

    // Second call - should still use cache
    await getJWKS('myteam.cloudflareaccess.com');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('clearJWKSCache', () => {
  beforeEach(() => {
    clearJWKSCache();
    mockFetch.mockReset();
    mockImportKey.mockReset();
  });

  it('clears the cache forcing a refetch', async () => {
    const mockCryptoKey = {} as CryptoKey;
    mockImportKey.mockResolvedValue(mockCryptoKey);
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        keys: [{ kid: 'key1', kty: 'RSA', n: 'modulus', e: 'exponent' }],
      }),
    });

    // First call - fetch
    await getJWKS('myteam.cloudflareaccess.com');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Clear cache
    clearJWKSCache();

    // Next call - should fetch again
    await getJWKS('myteam.cloudflareaccess.com');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { readEnv, hasServerCredentials } from '../env';
import { resolveClient, sanitizeKey, NoCredentialsError } from '../lib/client';

const base = { PORT: '8080' } as NodeJS.ProcessEnv;

function fakeFactory() {
  const seen: Array<Record<string, unknown>> = [];
  const factory = vi.fn((cfg: Record<string, unknown>) => {
    seen.push(cfg);
    return { ground: vi.fn(), structure: vi.fn() };
  });
  return { factory: factory as never, seen };
}

describe('readEnv', () => {
  it('starts without credentials rather than crash-looping', () => {
    const env = readEnv(base);
    expect(env.port).toBe(8080);
    expect(hasServerCredentials(env)).toBe(false);
  });

  it('prefers Vertex AI only when explicitly enabled and a project exists', () => {
    expect(readEnv({ ...base, GOOGLE_CLOUD_PROJECT: 'p' }).vertex).toBeUndefined();
    expect(readEnv({ ...base, USE_VERTEX_AI: 'true' }).vertex).toBeUndefined();
    expect(readEnv({ ...base, USE_VERTEX_AI: 'true', GOOGLE_CLOUD_PROJECT: 'p' })).toMatchObject({
      vertex: { project: 'p', location: 'us-central1' },
    });
  });

  it('treats blank credential strings as absent', () => {
    expect(readEnv({ ...base, GEMINI_API_KEY: '   ' }).geminiApiKey).toBeUndefined();
  });

  it('parses comma lists, ignoring stray whitespace and empties', () => {
    expect(readEnv({ ...base, ALLOWED_ORIGINS: 'https://a.com, ,https://b.com ' }).allowedOrigins).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });
});

describe('sanitizeKey', () => {
  it('strips the invisible characters that pasted keys carry', () => {
    expect(sanitizeKey('​AIza-key\n')).toBe('AIza-key');
  });

  it('treats a key that was only whitespace as absent', () => {
    expect(sanitizeKey('  ​ ')).toBeUndefined();
    expect(sanitizeKey(undefined)).toBeUndefined();
  });
});

describe('resolveClient — account tier and key source are independent', () => {
  it('uses the caller key when supplied, even though the service has its own', () => {
    const { factory, seen } = fakeFactory();
    const env = readEnv({ ...base, GEMINI_API_KEY: 'server-key' });

    const out = resolveClient({ env, callerKey: 'caller-key', factory });

    // A subscriber who brings a key has chosen to spend their own quota.
    // Silently billing ours instead would be expensive and dishonest.
    expect(out.keySource).toBe('caller');
    expect(seen[0]).toMatchObject({ apiKey: 'caller-key' });
  });

  it('falls back to the service key when the caller sends none', () => {
    const { factory, seen } = fakeFactory();
    const env = readEnv({ ...base, GEMINI_API_KEY: 'server-key' });

    const out = resolveClient({ env, factory });

    expect(out.keySource).toBe('server');
    expect(seen[0]).toMatchObject({ apiKey: 'server-key' });
  });

  it('uses Vertex credentials when configured and no caller key is present', () => {
    const { factory, seen } = fakeFactory();
    const env = readEnv({ ...base, USE_VERTEX_AI: 'true', GOOGLE_CLOUD_PROJECT: 'proj', GOOGLE_CLOUD_LOCATION: 'europe-west1' });

    const out = resolveClient({ env, factory });

    expect(out.keySource).toBe('server');
    expect(seen[0]).toMatchObject({
      vertex: { project: 'proj', location: 'europe-west1' },
      model: 'gemini-2.5-flash',
      structureModel: 'gemini-2.5-flash-lite',
    });
  });

  it('lets a caller key override Vertex — bring-your-own-key beats our service account', () => {
    const { factory, seen } = fakeFactory();
    const env = readEnv({ ...base, USE_VERTEX_AI: 'true', GOOGLE_CLOUD_PROJECT: 'proj' });

    const out = resolveClient({ env, callerKey: 'caller-key', factory });

    expect(out.keySource).toBe('caller');
    expect(seen[0]).not.toHaveProperty('vertex');
  });

  it('ignores a caller key that is only invisible characters', () => {
    const { factory } = fakeFactory();
    const env = readEnv({ ...base, GEMINI_API_KEY: 'server-key' });
    expect(resolveClient({ env, callerKey: '​  ', factory }).keySource).toBe('server');
  });

  it('refuses clearly when there are no credentials anywhere', () => {
    const { factory } = fakeFactory();
    expect(() => resolveClient({ env: readEnv(base), factory })).toThrow(NoCredentialsError);
  });
});

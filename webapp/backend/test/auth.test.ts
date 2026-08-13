import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { verifyIdToken, __resetKeyCacheForTests } from '../src/lib/auth';

describe('verifyIdToken (protects every route — must reject anything not genuinely Google-signed)', () => {
  let mock: MockFirebaseContext;

  beforeEach(async () => {
    __resetKeyCacheForTests();
    mock = await setupMockFirebase();
  });
  afterEach(() => mock.restore());

  it('accepts a validly-signed token for the right project', async () => {
    const token = await mock.signIdToken({ sub: 'uid-1', email: 'user@example.com' });
    const decoded = await verifyIdToken(token, mock.serviceAccount.project_id);
    expect(decoded.uid).toBe('uid-1');
    expect(decoded.email).toBe('user@example.com');
  });

  it('rejects a token issued for a different project (aud mismatch)', async () => {
    const token = await mock.signIdToken({ sub: 'uid-1', email: 'user@example.com' });
    await expect(verifyIdToken(token, 'some-other-project')).rejects.toThrow(/audience/i);
  });

  it('rejects a malformed token', async () => {
    await expect(verifyIdToken('not-a-real-token', mock.serviceAccount.project_id)).rejects.toThrow();
  });

  it('rejects a token whose signature was tampered with', async () => {
    const token = await mock.signIdToken({ sub: 'uid-1', email: 'user@example.com' });
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -4)}AAAA`;
    await expect(verifyIdToken(tampered, mock.serviceAccount.project_id)).rejects.toThrow(/signature/i);
  });

  it('rejects an expired token', async () => {
    const token = await mock.signIdToken({ sub: 'uid-1', email: 'user@example.com', extraClaims: { exp: Math.floor(Date.now() / 1000) - 10 } });
    await expect(verifyIdToken(token, mock.serviceAccount.project_id)).rejects.toThrow(/expired/i);
  });
});

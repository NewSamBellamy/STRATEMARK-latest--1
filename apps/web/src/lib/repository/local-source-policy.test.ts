import { describe, expect, it } from 'vitest';
import { allowsLocalSourceRequest } from './local-source-policy';

describe('local preview source boundary', () => {
  it('allows the same-origin loopback preview only', () => {
    expect(allowsLocalSourceRequest('POST', '127.0.0.1:4174', 'http://127.0.0.1:4174', '127.0.0.1', 'local-preview')).toBe(true);
  });
  it.each([
    ['GET', '127.0.0.1:4174', 'http://127.0.0.1:4174', '127.0.0.1', 'local-preview'],
    ['POST', '127.0.0.1:4174', 'https://evil.example', '127.0.0.1', 'local-preview'],
    ['POST', '127.0.0.1:4174', undefined, '127.0.0.1', 'local-preview'],
    ['POST', '127.0.0.1:4174', 'http://127.0.0.1:4174', '192.168.1.12', 'local-preview'],
    ['POST', 'evil.example:4174', 'http://evil.example:4174', '127.0.0.1', 'local-preview'],
    ['POST', '127.0.0.1:4174', 'http://127.0.0.1:4174', '127.0.0.1', undefined],
  ])('rejects unauthorized source retrieval (%s, %s, %s, %s)', (method, host, origin, address, marker) => {
    expect(allowsLocalSourceRequest(method, host, origin, address, marker)).toBe(false);
  });
});

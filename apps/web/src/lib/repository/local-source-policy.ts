/** Reject remote clients and cross-origin requests before reading their payload. */
export function allowsLocalSourceRequest(method: string | undefined, host: string | undefined,
  origin: string | undefined, address: string | undefined, marker: string | undefined): boolean {
  if (method !== 'POST' || marker !== 'local-preview' || !host || !origin ||
    !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '')) return false;
  try {
    const target = new URL(`http://${host}`);
    return ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) && origin === target.origin;
  } catch { return false; }
}

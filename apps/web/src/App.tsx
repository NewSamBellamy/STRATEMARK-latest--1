import { HashRouter, MemoryRouter } from 'react-router-dom';
import { AppRoutes } from './routes';
import { DeepDiveProviderWithPanel } from '@/features/deepdive/DeepDive';

/**
 * Can this document support a URL-based router?
 *
 * HashRouter needs `window.location.href` to be a valid URL base — React Router
 * calls `new URL(...)` against it. Inside an `about:srcdoc` iframe (how some
 * viewers and note apps embed raw HTML) there is no real document URL, so that
 * throws `Failed to construct 'URL': Invalid URL` and the whole app falls into
 * its error boundary. Detect that case and fall back to an in-memory router:
 * deep links stop working, but the product renders and stays usable, which is
 * the right trade for an embed.
 */
function supportsUrlRouting(): boolean {
  try {
    const href = window.location?.href ?? '';
    if (!href || /^about:/i.test(href)) return false;
    new URL(href);
    return true;
  } catch {
    return false;
  }
}

// HashRouter keeps deep links working under Electron's file:// origin (Electron-ready),
// and avoids the data-router fetch/Request machinery we don't need (no loaders/actions).
export function App() {
  // The panel reads route/search state, so it must live under either router.
  const content = (
    <DeepDiveProviderWithPanel>
      <AppRoutes />
    </DeepDiveProviderWithPanel>
  );
  if (!supportsUrlRouting()) {
    return <MemoryRouter initialEntries={['/']}>{content}</MemoryRouter>;
  }
  return <HashRouter>{content}</HashRouter>;
}

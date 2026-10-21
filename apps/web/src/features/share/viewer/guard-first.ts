/** Imported first by the share entry, so the guard is in place before any other module runs. */
import { installShareGuard } from './guard';

// Read straight from the build setting: importing the app's own config here would run other code before the guard is in place.
installShareGuard(undefined, { shareApi: String(import.meta.env.VITE_STRATEMARK_API_URL ?? '').trim() });

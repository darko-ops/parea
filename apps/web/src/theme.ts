/**
 * The web's light or dark, remembered in a cookie so the server can render
 * the right one. Dark unless somebody picks light — the app's default too.
 */
export const THEME_COOKIE = 'parea-theme';

export type Look = 'dark' | 'light';

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAP_STYLE_URL: string;
  /** DS3 light-theme basemap; default OpenFreeMap positron. */
  readonly VITE_MAP_STYLE_URL_LIGHT?: string;
  /** F10 public share page basemap (light); default OpenFreeMap positron. */
  readonly VITE_SHARE_MAP_STYLE_URL?: string;
  readonly VITE_DEV_LOGIN_EMAIL?: string;
  readonly VITE_DEV_LOGIN_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

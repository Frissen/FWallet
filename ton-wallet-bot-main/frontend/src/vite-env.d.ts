/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TONCENTER_API_KEY?: string
  readonly VITE_P2P_API_BASE?: string
  readonly VITE_CHANGENOW_API_KEY?: string
  readonly VITE_BOT_USERNAME?: string
  readonly VITE_MINIAPP_SHORTNAME?: string
  readonly VITE_APP_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

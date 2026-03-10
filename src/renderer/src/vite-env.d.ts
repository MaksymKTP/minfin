/// <reference types="vite/client" />

import type { MinfinApi } from "../../preload";

declare global {
  interface Window {
    minfinApi: MinfinApi;
  }
}

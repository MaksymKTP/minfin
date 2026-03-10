import { contextBridge, ipcRenderer } from "electron";
import type { AutoUpdateStatus, DataResponse, FilterOptions, FiltersState, UserSettings } from "../shared/types";

const api = {
  getDefaultFilters: (): Promise<FiltersState> => ipcRenderer.invoke("filters:default"),
  getFilterOptions: (filters: Pick<FiltersState, "cityId" | "currency">): Promise<FilterOptions> =>
    ipcRenderer.invoke("filters:options", filters),
  getRatesData: (filters: FiltersState): Promise<DataResponse> => ipcRenderer.invoke("rates:data", filters),
  openExternalUrl: (url: string): Promise<void> => ipcRenderer.invoke("external:open-url", url),
  getUserSettings: (): Promise<UserSettings> => ipcRenderer.invoke("user-settings:get"),
  saveUserSettings: (payload: UserSettings): Promise<UserSettings> => ipcRenderer.invoke("user-settings:save", payload),
  installUpdateNow: (): Promise<void> => ipcRenderer.invoke("auto-update:install-now"),
  onAutoUpdateStatus: (callback: (status: AutoUpdateStatus) => void): (() => void) => {
    const listener = (_: unknown, status: AutoUpdateStatus): void => callback(status);
    ipcRenderer.on("auto-update:status", listener);
    return () => ipcRenderer.off("auto-update:status", listener);
  },
  onOpenSettings: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on("menu:open-settings", listener);
    return () => ipcRenderer.off("menu:open-settings", listener);
  }
};

contextBridge.exposeInMainWorld("minfinApi", api);

export type MinfinApi = typeof api;

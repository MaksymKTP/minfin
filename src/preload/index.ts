import { contextBridge, ipcRenderer } from "electron";
import type { DataResponse, FilterOptions, FiltersState } from "../shared/types";

const api = {
  getDefaultFilters: (): Promise<FiltersState> => ipcRenderer.invoke("filters:default"),
  getFilterOptions: (filters: Pick<FiltersState, "cityId" | "currency">): Promise<FilterOptions> =>
    ipcRenderer.invoke("filters:options", filters),
  getRatesData: (filters: FiltersState): Promise<DataResponse> => ipcRenderer.invoke("rates:data", filters),
  openExternalUrl: (url: string): Promise<void> => ipcRenderer.invoke("external:open-url", url)
};

contextBridge.exposeInMainWorld("minfinApi", api);

export type MinfinApi = typeof api;

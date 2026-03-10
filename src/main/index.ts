import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { autoUpdater } from "electron-updater";
import { getData, getDefaultFilters, getFilterOptions } from "./db";
import type { FiltersState } from "../shared/types";

function createWindow(): void {
  const preloadPath = fileURLToPath(new URL("../preload/index.mjs", import.meta.url));

  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1280,
    minHeight: 760,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.on("preload-error", (_, preloadPath, error) => {
    console.error("Preload error:", preloadPath, error);
  });

  mainWindow.webContents.on("did-fail-load", (_, errorCode, errorDescription) => {
    console.error("Renderer load failed:", errorCode, errorDescription);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function initAutoUpdates(): void {
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (error) => {
    console.error("Auto update error:", error);
  });

  void autoUpdater.checkForUpdatesAndNotify();
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.minfin.arbitrage");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  ipcMain.handle("filters:default", () => getDefaultFilters());
  ipcMain.handle("filters:options", (_, filters: Pick<FiltersState, "cityId" | "currency">) => getFilterOptions(filters));
  ipcMain.handle("rates:data", (_, filters: FiltersState) => getData(filters));
  ipcMain.handle("external:open-url", (_, url: string) => shell.openExternal(url));

  createWindow();
  initAutoUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

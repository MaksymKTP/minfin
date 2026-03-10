import { Menu, app, BrowserWindow, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import electronUpdater from "electron-updater";
import { getData, getDefaultFilters, getFilterOptions } from "./db";
import type { AutoUpdateStatus, FiltersState, UserSettings } from "../shared/types";

const { autoUpdater } = electronUpdater;
const USER_SETTINGS_FILE_NAME = "user-settings.json";
let mainWindowRef: BrowserWindow | null = null;

function emitAutoUpdateStatus(status: AutoUpdateStatus): void {
  if (!mainWindowRef) {
    return;
  }
  mainWindowRef.webContents.send("auto-update:status", status);
}

function getUserSettingsPath(): string {
  return path.join(app.getPath("userData"), USER_SETTINGS_FILE_NAME);
}

async function getUserSettings(): Promise<UserSettings> {
  try {
    const raw = await fs.readFile(getUserSettingsPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      companyName: typeof parsed.companyName === "string" ? parsed.companyName : ""
    };
  } catch {
    return { companyName: "" };
  }
}

async function saveUserSettings(payload: UserSettings): Promise<UserSettings> {
  const next: UserSettings = {
    companyName: typeof payload.companyName === "string" ? payload.companyName.trim() : ""
  };
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(getUserSettingsPath(), JSON.stringify(next, null, 2), "utf-8");
  return next;
}

function createWindow(): void {
  const preloadPath = fileURLToPath(new URL("../preload/index.mjs", import.meta.url));

  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1280,
    minHeight: 760,
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindowRef = mainWindow;

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

  const menu = Menu.buildFromTemplate([
    {
      label: "Настройки",
      submenu: [
        {
          label: "Открыть настройки",
          accelerator: "CmdOrCtrl+,",
          click: () => mainWindow.webContents.send("menu:open-settings")
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

function initAutoUpdates(): void {
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (error) => {
    console.error("Auto update error:", error);
    emitAutoUpdateStatus({ type: "error", message: error.message });
  });
  autoUpdater.on("checking-for-update", () => emitAutoUpdateStatus({ type: "checking" }));
  autoUpdater.on("update-available", (info) => emitAutoUpdateStatus({ type: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => emitAutoUpdateStatus({ type: "not-available" }));
  autoUpdater.on("update-downloaded", (info) => emitAutoUpdateStatus({ type: "downloaded", version: info.version }));

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
  ipcMain.handle("user-settings:get", () => getUserSettings());
  ipcMain.handle("user-settings:save", (_, payload: UserSettings) => saveUserSettings(payload));
  ipcMain.handle("auto-update:install-now", async () => {
    if (!app.isPackaged) {
      return;
    }
    autoUpdater.quitAndInstall();
  });

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

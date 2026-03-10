import { Menu, app, BrowserWindow, dialog, ipcMain, shell } from "electron";
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
      companyName: typeof parsed.companyName === "string" ? parsed.companyName : "",
      dbHost: typeof parsed.dbHost === "string" ? parsed.dbHost : "",
      dbPort: typeof parsed.dbPort === "string" ? parsed.dbPort : "",
      dbUser: typeof parsed.dbUser === "string" ? parsed.dbUser : "",
      dbPassword: typeof parsed.dbPassword === "string" ? parsed.dbPassword : ""
    };
  } catch {
    return { companyName: "", dbHost: "", dbPort: "", dbUser: "", dbPassword: "" };
  }
}

async function saveUserSettings(payload: UserSettings): Promise<UserSettings> {
  const next: UserSettings = {
    companyName: typeof payload.companyName === "string" ? payload.companyName.trim() : "",
    dbHost: typeof payload.dbHost === "string" ? payload.dbHost.trim() : "",
    dbPort: typeof payload.dbPort === "string" ? payload.dbPort.trim() : "",
    dbUser: typeof payload.dbUser === "string" ? payload.dbUser.trim() : "",
    dbPassword: typeof payload.dbPassword === "string" ? payload.dbPassword : ""
  };
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(getUserSettingsPath(), JSON.stringify(next, null, 2), "utf-8");
  return next;
}

function createWindow(): void {
  const preloadPath = fileURLToPath(new URL("../preload/index.mjs", import.meta.url));
  const appTitle = `Minfin Arbitrage v${app.getVersion()}`;

  const mainWindow = new BrowserWindow({
    title: appTitle,
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
    mainWindow.setTitle(appTitle);
    mainWindow.show();
  });

  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow.setTitle(appTitle);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.setTitle(appTitle);
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

async function runPreLaunchUpdateFlow(): Promise<"launch" | "installing"> {
  if (!app.isPackaged) {
    return "launch";
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (error) => {
    console.error("Auto update error:", error);
    emitAutoUpdateStatus({ type: "error", message: error.message });
  });

  try {
    emitAutoUpdateStatus({ type: "checking" });
    const result = await autoUpdater.checkForUpdates();
    const nextVersion = result?.updateInfo?.version;

    if (!nextVersion || nextVersion === app.getVersion()) {
      emitAutoUpdateStatus({ type: "not-available" });
      return "launch";
    }

    emitAutoUpdateStatus({ type: "available", version: nextVersion });
    const answer = await dialog.showMessageBox({
      type: "question",
      title: "Доступно обновление",
      message: `Найдена новая версия ${nextVersion}.`,
      detail: "Установить обновление перед запуском приложения?",
      buttons: ["Да, установить", "Нет, позже"],
      defaultId: 0,
      cancelId: 1
    });

    if (answer.response !== 0) {
      return "launch";
    }

    await autoUpdater.downloadUpdate();
    emitAutoUpdateStatus({ type: "downloaded", version: nextVersion });
    autoUpdater.quitAndInstall();
    return "installing";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown auto-update error";
    if (message.includes("No published versions on GitHub")) {
      return "launch";
    }
    console.error("Pre-launch update flow failed:", error);
    return "launch";
  }
}

app.whenReady().then(async () => {
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

  const updateFlowResult = await runPreLaunchUpdateFlow();
  if (updateFlowResult === "launch") {
    createWindow();
  }

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

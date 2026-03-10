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
const UPDATE_WINDOW_TITLE = "Minfin Arbitrage - Обновление";

const UPDATE_WINDOW_HTML = `
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      body {
        margin: 0;
        background: #101826;
        color: #d9e2f2;
        font-family: Segoe UI, Arial, sans-serif;
      }
      .wrap {
        height: 100vh;
        padding: 18px;
        display: grid;
        align-content: center;
        gap: 12px;
      }
      .title {
        font-size: 18px;
        font-weight: 600;
      }
      .status {
        font-size: 13px;
        color: #c7d4ea;
      }
      .bar {
        width: 100%;
        height: 12px;
        border: 1px solid #344055;
        border-radius: 99px;
        background: #162234;
        overflow: hidden;
      }
      .fill {
        width: 0%;
        height: 100%;
        background: linear-gradient(90deg, #2f6db2 0%, #54a8ff 100%);
        transition: width 0.2s ease;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="title">Проверка обновлений</div>
      <div id="status" class="status">Инициализация...</div>
      <div class="bar"><div id="fill" class="fill"></div></div>
    </div>
    <script>
      window.__setUpdateProgress = (status, percent) => {
        document.getElementById("status").textContent = status;
        document.getElementById("fill").style.width = Math.max(0, Math.min(100, percent)) + "%";
      };
    </script>
  </body>
</html>
`;

function emitAutoUpdateStatus(status: AutoUpdateStatus): void {
  if (!mainWindowRef) {
    return;
  }
  mainWindowRef.webContents.send("auto-update:status", status);
}

async function createUpdateWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    title: UPDATE_WINDOW_TITLE,
    width: 520,
    height: 220,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    autoHideMenuBar: true
  });
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(UPDATE_WINDOW_HTML)}`);
  window.show();
  return window;
}

function setUpdateWindowProgress(updateWindow: BrowserWindow, status: string, percent: number): void {
  if (updateWindow.isDestroyed()) {
    return;
  }
  const escapedStatus = JSON.stringify(status);
  void updateWindow.webContents.executeJavaScript(`window.__setUpdateProgress(${escapedStatus}, ${percent});`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

async function runPreLaunchUpdateFlow(updateWindow: BrowserWindow): Promise<"launch" | "installing"> {
  if (!app.isPackaged) {
    setUpdateWindowProgress(updateWindow, "Режим разработки: проверка обновлений пропущена.", 100);
    await sleep(800);
    return "launch";
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (error) => {
    console.error("Auto update error:", error);
    emitAutoUpdateStatus({ type: "error", message: error.message });
  });
  autoUpdater.on("download-progress", (progress) => {
    setUpdateWindowProgress(
      updateWindow,
      `Скачивание обновления... ${Math.round(progress.percent)}%`,
      Math.max(10, Math.round(progress.percent))
    );
  });

  try {
    emitAutoUpdateStatus({ type: "checking" });
    setUpdateWindowProgress(updateWindow, "Проверка обновлений...", 10);
    const result = await autoUpdater.checkForUpdates();
    const nextVersion = result?.updateInfo?.version;

    if (!nextVersion || nextVersion === app.getVersion()) {
      emitAutoUpdateStatus({ type: "not-available" });
      setUpdateWindowProgress(updateWindow, "Версия актуальна.", 100);
      await sleep(1000);
      return "launch";
    }

    emitAutoUpdateStatus({ type: "available", version: nextVersion });
    setUpdateWindowProgress(updateWindow, `Найдена версия ${nextVersion}. Подготовка к скачиванию...`, 20);

    await autoUpdater.downloadUpdate();
    emitAutoUpdateStatus({ type: "downloaded", version: nextVersion });
    setUpdateWindowProgress(updateWindow, "Обновление скачано. Установка...", 100);
    await sleep(700);
    autoUpdater.quitAndInstall();
    return "installing";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown auto-update error";
    if (message.includes("No published versions on GitHub")) {
      setUpdateWindowProgress(updateWindow, "Опубликованных обновлений нет. Запуск...", 100);
      await sleep(1000);
      return "launch";
    }
    console.error("Pre-launch update flow failed:", error);
    setUpdateWindowProgress(updateWindow, "Ошибка проверки обновлений. Запуск текущей версии...", 100);
    await sleep(1200);
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

  const updateWindow = await createUpdateWindow();
  const updateFlowResult = await runPreLaunchUpdateFlow(updateWindow);
  if (updateFlowResult === "launch") {
    if (!updateWindow.isDestroyed()) {
      updateWindow.close();
    }
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

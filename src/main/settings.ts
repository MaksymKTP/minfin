import fs from "node:fs";
import path from "node:path";

export interface AppSettings {
  defaultCityId: number;
  defaultCurrency: string;
  supportedCurrencies: string[];
  cities: Record<string, string>;
}

const SETTINGS_FILE_NAME = "settings.json";

function getSettingsPath(): string {
  const packagedPath = path.join(process.resourcesPath, SETTINGS_FILE_NAME);
  if (fs.existsSync(packagedPath)) {
    return packagedPath;
  }
  return path.resolve(process.cwd(), SETTINGS_FILE_NAME);
}

export function loadSettings(): AppSettings {
  const settingsPath = getSettingsPath();
  const raw = fs.readFileSync(settingsPath, "utf-8");
  const parsed = JSON.parse(raw) as AppSettings;

  if (
    !parsed.defaultCityId ||
    !parsed.defaultCurrency ||
    !Array.isArray(parsed.supportedCurrencies) ||
    parsed.supportedCurrencies.length === 0 ||
    !parsed.cities
  ) {
    throw new Error("Invalid settings.json");
  }

  return parsed;
}

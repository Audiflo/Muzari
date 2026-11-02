import { useEffect, useState } from "react";
import type { SettingsManager } from "../platform/settings/settings";

export function useSettingsState(settings: SettingsManager) {
  const [settingsState, setSettingsState] = useState(() =>
    settings.getSettings(),
  );

  useEffect(() => {
    const updateSettings = () => setSettingsState(settings.getSettings());

    settings.on("settingschange", updateSettings);
    updateSettings();

    return () => settings.off("settingschange", updateSettings);
  }, [settings]);

  return settingsState;
}

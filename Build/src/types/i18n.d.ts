import type { bundledResources } from "../helpers/i18nManual";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: (typeof bundledResources)["en"]["translation"];
    };
  }
}
import type {
  IconDefinition,
  IconDefinitionMap,
  IconLibraryConfig,
  IconLibraryConfigMap,
  IconLibraryMap,
  IconPropTransformer,
  ResolvedComponentIcon,
  ResolvedIcon,
} from "../../../types/icons";
import type { IconSet } from "../types";
import type { ThemingEvents } from "../events";
import { createLogger, throwError } from "../../../helpers/logger";

const logger = createLogger("icon");

const ICON_STORAGE_KEY = "selected-icon-set";

interface ThemeJsonModule {
  default: {
    id: string;
    label: string;
    themeName: string;
    icons?: Record<string, unknown>;
    cssFile?: string;
  };
}

interface IconModule {
  default: IconDefinitionMap;
  libraries?: IconLibraryMap;
  libraryConfig?: IconLibraryConfigMap;
}

const iconJsonFiles = import.meta.glob(
  "../../resources/themes/Icons/**/*.theme.json",
  { eager: true },
);

const iconModuleFiles = import.meta.glob(
  "../../resources/themes/Icons/**/*.icons.{ts,tsx}",
  { eager: false },
);

class LRUCache<K, V> {
  private maxSize: number;
  private cache: Map<K, V>;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, value);
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

const builtinLibraries: Record<string, () => Promise<Record<string, unknown>>> =
  {
    lucide: async () => {
      const lib = await import("lucide-react");
      return lib;
    },
  };

function asIconComponent(
  value: unknown,
): React.ComponentType<React.SVGProps<SVGSVGElement>> | null {
  if (typeof value === "function") {
    return value as React.ComponentType<React.SVGProps<SVGSVGElement>>;
  }
  if (typeof value === "object" && value !== null && "$$typeof" in value) {
    return value as React.ComponentType<React.SVGProps<SVGSVGElement>>;
  }
  return null;
}

export class IconEngine {
  private iconSets: IconSet[] = [];
  private currentSet: IconSet | null = null;
  private loadedIcons: LRUCache<string, unknown> = new LRUCache(100);
  private loadedLibraries: Map<string, unknown> = new Map();
  private events: ThemingEvents;

  constructor(events: ThemingEvents) {
    this.events = events;
  }

  async load(): Promise<IconSet[]> {
    const loaded: IconSet[] = [];

    for (const [path, module] of Object.entries(iconJsonFiles)) {
      const json = (module as ThemeJsonModule).default || module;

      if (json.icons || !json.cssFile) {
        const iconSet: IconSet = {
          id: json.id || this.extractIdFromPath(path),
          label: json.label || json.id || this.extractIdFromPath(path),
          themeName: json.themeName || json.id || "",
          path: path.replace(".theme.json", ".icons.ts"),
        };
        loaded.push(iconSet);
      }
    }

    this.iconSets = loaded;
    return loaded;
  }

  private extractIdFromPath(path: string): string {
    const match = path.match(/\/([^/]+)\/[^\/]+\.theme\.json/);
    const id = match?.[1];
    return id ? id.toLowerCase() : "unknown";
  }

  getAll(): IconSet[] {
    return this.iconSets;
  }

  getCurrent(): IconSet | null {
    return this.currentSet;
  }

  getById(id: string): IconSet | undefined {
    return this.iconSets.find((s) => s.id === id || s.label === id);
  }

  async apply(iconSetId: string): Promise<void> {
    const iconSet = this.getById(iconSetId);
    if (!iconSet) {
      const error = `Icon set "${iconSetId}" not found`;
      this.events.emit("iconerror", { error });
      return throwError(error);
    }

    if (!iconModuleFiles[iconSet.path]) {
      const error = `Icon module not found: ${iconSet.path}`;
      this.events.emit("iconerror", { error });
      return throwError(error);
    }

    this.currentSet = iconSet;
    this.loadedIcons.clear();
    localStorage.setItem(ICON_STORAGE_KEY, iconSet.id);

    this.events.emit("iconchange", { iconSet: iconSet.id });
  }

  async resolve(name: string): Promise<ResolvedIcon | null> {
    if (!this.currentSet) {
      return null;
    }

    const cacheKey = `${this.currentSet.id}:${name}`;
    const cached = this.loadedIcons.get(cacheKey);
    if (cached) {
      return cached as ResolvedIcon;
    }

    try {
      const module = (await iconModuleFiles[this.currentSet.path]!()) as
        | IconModule
        | undefined;
      if (!module) {
        return null;
      }

      const definition = module.default?.[name];
      const resolved = definition
        ? await this.resolveDefinition(definition, module)
        : null;
      if (resolved) {
        this.loadedIcons.set(cacheKey, resolved);
        return resolved;
      }

      const fallback = await this.resolveFromBuiltin(name);
      if (fallback) {
        this.loadedIcons.set(cacheKey, fallback);
        return fallback;
      }

      return null;
    } catch (error) {
      logger.error(`Failed to resolve icon "${name}":`, {
        error: String(error),
      });
      return null;
    }
  }

  private async resolveDefinition(
    definition: IconDefinition,
    module: IconModule,
  ): Promise<ResolvedIcon | null> {
    switch (definition.type) {
      case "library": {
        const component = await this.resolveLibraryComponent(
          definition.library,
          definition.icon,
          module,
        );
        if (!component) {
          return null;
        }
        return {
          type: "component",
          Component: component,
          propTransformer: this.getPropTransformer(module, definition.library),
          title: definition.title,
        };
      }
      case "component":
        return {
          type: "component",
          Component: definition.component,
          defaultProps: definition.props,
          title: definition.title,
        };
      case "image":
        return {
          type: "image",
          src: definition.src,
          alt: definition.alt,
          title: definition.title,
        };
      case "svg-inline":
        return {
          type: "svg-inline",
          content: definition.content,
          viewBox: definition.viewBox,
          alt: definition.alt,
          title: definition.title,
        };
      default:
        return null;
    }
  }

  private async resolveLibraryComponent(
    libraryName: string,
    iconName: string,
    module: IconModule,
  ): Promise<React.ComponentType<React.SVGProps<SVGSVGElement>> | null> {
    const library = await this.getLibrary(libraryName, module);
    return asIconComponent(library?.[iconName]);
  }

  private async getLibrary(
    libraryName: string,
    module: IconModule,
  ): Promise<Record<string, unknown> | null> {
    const declared = module.libraries?.[libraryName];
    if (declared) {
      const setId = this.currentSet?.id ?? "unknown";
      return this.loadLibraryModule(`set:${setId}:${libraryName}`, declared);
    }

    const builtinLoader = builtinLibraries[libraryName];
    if (!builtinLoader) {
      return null;
    }
    return this.loadLibraryModule(`builtin:${libraryName}`, builtinLoader);
  }

  private async loadLibraryModule(
    cacheKey: string,
    source: IconLibraryMap[string],
  ): Promise<Record<string, unknown>> {
    if (typeof source !== "function") {
      return source;
    }
    const cached = this.loadedLibraries.get(cacheKey);
    if (cached) {
      return cached as Record<string, unknown>;
    }
    const loaded = await source();
    this.loadedLibraries.set(cacheKey, loaded);
    return loaded as Record<string, unknown>;
  }

  private getPropTransformer(
    module: IconModule,
    libraryName: string,
  ): IconPropTransformer | undefined {
    const config = module.libraryConfig?.[libraryName] as
      | IconLibraryConfig
      | undefined;
    return config?.propTransformer;
  }

  private async resolveFromBuiltin(
    name: string,
  ): Promise<ResolvedComponentIcon | null> {
    const exactName = name.charAt(0).toUpperCase() + name.slice(1);
    for (const [libName, loader] of Object.entries(builtinLibraries)) {
      const library = await this.loadLibraryModule(`builtin:${libName}`, loader);
      const iconComponent = asIconComponent(library[name] ?? library[exactName]);
      if (iconComponent) {
        return { type: "component", Component: iconComponent };
      }
    }
    return null;
  }

  getStored(): string | null {
    return localStorage.getItem(ICON_STORAGE_KEY);
  }

  reset(): void {
    this.currentSet = null;
    this.loadedIcons.clear();
    this.loadedLibraries.clear();
    localStorage.removeItem(ICON_STORAGE_KEY);
  }
}

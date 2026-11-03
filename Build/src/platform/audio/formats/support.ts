import { isSafari } from "../../utils/safari";
import { createLogger } from "../../../helpers/logger";

const logger = createLogger("formats");
import {
  FormatCapabilityRegistry,
  identifyFormat,
  type AudioFormat,
} from "@audiflo/komorebi";

export type BackendKind = "flo" | "symphonia" | "html";

const decoderProviders = new FormatCapabilityRegistry();
const metadataProviders = new FormatCapabilityRegistry();

decoderProviders.register({
  id: "flo",
  supports: (format) => format.id === "flo",
});
decoderProviders.register({
  id: "symphonia",
  supports: (format) => format.decode === "required",
});
metadataProviders.register({
  id: "flo",
  supports: (format) => format.id === "flo" && format.metadata === "available",
});
metadataProviders.register({
  id: "music-metadata",
  supports: (format) => format.id !== "flo" && format.metadata === "available",
});

function decoderBackendFor(format: AudioFormat): BackendKind | null {
  const provider = decoderProviders.find(format);
  return provider?.id === "flo" || provider?.id === "symphonia"
    ? provider.id
    : null;
}

function metadataProviderFor(
  format: AudioFormat | undefined,
): "music-metadata" | "flo" | "none" {
  if (!format) return "none";
  const provider = metadataProviders.find(format);
  if (provider?.id === "flo" || provider?.id === "music-metadata") {
    return provider.id;
  }
  return "none";
}

export type SupportVerdict =
  | { status: "supported"; format: AudioFormat; backend: BackendKind }
  | { status: "unrecognized"; fileName: string; mimeType: string }
  | {
      status: "unplayable";
      format: AudioFormat;
      reason: string;
      metadataOnly: boolean;
    };

export function safariMajorVersion(): number | null {
  if (typeof navigator === "undefined") return null;
  if (!isSafari()) return null;

  const fromVersion = /version\/(\d+)(?:\.(\d+))?/i.exec(navigator.userAgent);
  if (fromVersion?.[1]) {
    const major = Number(fromVersion[1]);
    const minor = fromVersion[2] === undefined ? 0 : Number(fromVersion[2]);
    return major + minor / 10;
  }

  const fromOs = /os (\d+)[._](\d+)/i.exec(navigator.userAgent);
  if (fromOs?.[1]) {
    return Number(fromOs[1]);
  }

  return null;
}

function probeCanPlay(mime: string): boolean {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("audio");
  return probe.canPlayType(mime) !== "";
}

export function canPlayWithHtmlAudio(format: AudioFormat): boolean {
  const support = format.htmlAudio;
  if (!support) return false;

  const minimum = support.minSafariVersion;
  if (minimum !== undefined) {
    const version = safariMajorVersion();
    if (version !== null && version < minimum) return false;
  }

  return probeCanPlay(support.mime);
}

export function chooseBackendFor(
  format: AudioFormat | undefined,
  options: { hasStoredAudio: boolean; isSafariRuntime?: boolean },
): BackendKind {
  if (!format) {
    const onSafari = options.isSafariRuntime ?? isSafari();
    return onSafari || !options.hasStoredAudio ? "html" : "symphonia";
  }

  const decoder = format ? decoderBackendFor(format) : null;
  if (decoder === "flo") return "flo";

  const onSafari = options.isSafariRuntime ?? isSafari();
  if (onSafari || !options.hasStoredAudio) return "html";

  if (decoder === null) return "html";

  return "symphonia";
}

export function metadataExtractorFor(
  format: AudioFormat | undefined,
): "music-metadata" | "flo" | "none" {
  if (!format) return "none";
  return metadataProviderFor(format);
}

export function resolveSupport(
  fileName: string,
  mimeType: string,
  options: { hasStoredAudio: boolean; isSafariRuntime?: boolean },
): SupportVerdict {
  const format = identifyFormat(fileName, mimeType);

  if (!format) {
    return { status: "unrecognized", fileName, mimeType };
  }

  const backend = chooseBackendFor(format, options);

  if (backend === "flo") {
    return { status: "supported", format, backend };
  }

  if (backend === "symphonia") {
    return { status: "supported", format, backend };
  }

  if (canPlayWithHtmlAudio(format)) {
    return { status: "supported", format, backend };
  }

  const metadataOnly = format.metadata !== "none";
  const minimum = format.htmlAudio?.minSafariVersion;
  const reason =
    minimum !== undefined
      ? `requires Safari ${minimum} or newer`
      : `not playable by the browser's audio element`;

  return { status: "unplayable", format, reason, metadataOnly };
}

export function classifyImportFile(file: File): SupportVerdict {
  const verdict = resolveSupport(file.name, file.type, {
    hasStoredAudio: true,
    isSafariRuntime: isSafari(),
  });

  if (verdict.status !== "supported") {
    logger.warn("Skipped unsupported file", {
      file: file.name,
      type: file.type || "<none>",
      size: file.size,
      status: verdict.status,
      ...("format" in verdict
        ? { format: verdict.format.label, reason: verdict.reason }
        : {}),
    });
  }

  return verdict;
}

export function isImportableFile(file: File): boolean {
  return classifyImportFile(file).status === "supported";
}

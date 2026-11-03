interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

interface AlbumArtColors {
  primary: RgbColor;
  secondary: RgbColor;
  background: RgbColor;
  foreground: RgbColor;
}

const ROOT_VARIABLES = [
  "--album-art-image",
  "--album-art-primary",
  "--album-art-secondary",
  "--album-art-background",
  "--album-art-foreground",
] as const;

const FALLBACK_COLORS: AlbumArtColors = {
  primary: { red: 18, green: 24, blue: 38 },
  secondary: { red: 45, green: 62, blue: 88 },
  background: { red: 7, green: 10, blue: 18 },
  foreground: { red: 255, green: 255, blue: 255 },
};

function colorString(color: RgbColor): string {
  return `rgb(${color.red} ${color.green} ${color.blue})`;
}

function mix(first: RgbColor, second: RgbColor, amount: number): RgbColor {
  return {
    red: Math.round(first.red * (1 - amount) + second.red * amount),
    green: Math.round(first.green * (1 - amount) + second.green * amount),
    blue: Math.round(first.blue * (1 - amount) + second.blue * amount),
  };
}

function sampleImage(image: HTMLImageElement): AlbumArtColors {
  const canvas = document.createElement("canvas");
  canvas.width = 24;
  canvas.height = 24;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return FALLBACK_COLORS;

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const colors: RgbColor[] = [];

  for (let index = 0; index < pixels.length; index += 16) {
    if (pixels[index + 3] < 128) continue;
    colors.push({
      red: pixels[index],
      green: pixels[index + 1],
      blue: pixels[index + 2],
    });
  }

  if (colors.length === 0) return FALLBACK_COLORS;

  const average = colors.reduce(
    (total, color) => ({
      red: total.red + color.red / colors.length,
      green: total.green + color.green / colors.length,
      blue: total.blue + color.blue / colors.length,
    }),
    { red: 0, green: 0, blue: 0 },
  );
  const primary = mix(average, { red: 255, green: 255, blue: 255 }, 0.12);
  const background = mix(average, { red: 0, green: 0, blue: 0 }, 0.68);
  const secondary = mix(average, { red: 255, green: 255, blue: 255 }, 0.28);
  const luminance =
    (background.red * 299 + background.green * 587 + background.blue * 114) /
    1000;

  return {
    primary,
    secondary,
    background,
    foreground:
      luminance > 150
        ? { red: 12, green: 16, blue: 24 }
        : { red: 255, green: 255, blue: 255 },
  };
}

function setVariables(colors: AlbumArtColors, albumArtUrl?: string): void {
  const root = document.documentElement;
  root.style.setProperty(
    "--album-art-image",
    albumArtUrl ? `url("${albumArtUrl}")` : "none",
  );
  root.style.setProperty("--album-art-primary", colorString(colors.primary));
  root.style.setProperty(
    "--album-art-secondary",
    colorString(colors.secondary),
  );
  root.style.setProperty(
    "--album-art-background",
    colorString(colors.background),
  );
  root.style.setProperty(
    "--album-art-foreground",
    colorString(colors.foreground),
  );
}

export function applyAlbumArtTheme(albumArtUrl?: string): () => void {
  let cancelled = false;
  setVariables(FALLBACK_COLORS, albumArtUrl);

  if (!albumArtUrl) {
    return () => undefined;
  }

  const image = new Image();
  image.onload = () => {
    if (!cancelled) setVariables(sampleImage(image), albumArtUrl);
  };
  image.src = albumArtUrl;

  return () => {
    cancelled = true;
    const root = document.documentElement;
    ROOT_VARIABLES.forEach((variable) => root.style.removeProperty(variable));
  };
}

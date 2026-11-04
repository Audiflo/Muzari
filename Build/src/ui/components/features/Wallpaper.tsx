import React, { Suspense } from "react";
import { useWallpaper, useTheming } from "../../theming/hooks/useTheming";
import type { WallpaperProps } from "../../theming/types";
import { useAlbumArt } from "../../../hooks/useAlbumArt";
import { applyAlbumArtTheme } from "../../theming/albumArtTheme";

type WallpaperRendererProps = WallpaperProps;

const WallpaperRenderer: React.FC<WallpaperRendererProps> = ({
  currentSong,
  playbackState,
}) => {
  const { currentWallpaper, getWallpaperComponent } = useWallpaper();
  const { isLoading } = useTheming();
  const loadedAlbumArt = useAlbumArt(
    currentSong?.id,
    currentSong?.hasAlbumArt || !!currentSong?.albumArt,
  );
  const albumArtUrl = currentSong?.albumArt || loadedAlbumArt;

  React.useEffect(() => {
    const cleanup = applyAlbumArtTheme(albumArtUrl);
    return cleanup;
  }, [albumArtUrl]);

  const wallpaperSong = React.useMemo(() => {
    if (!currentSong || !albumArtUrl || currentSong.albumArt === albumArtUrl) {
      return currentSong;
    }
    return { ...currentSong, albumArt: albumArtUrl };
  }, [currentSong, albumArtUrl]);

  if (isLoading) {
    return (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: "#000",
          zIndex: -1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
        }}
      >
        Loading wallpaper...
      </div>
    );
  }

  if (!getWallpaperComponent) {
    return (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: "var(--themegradient)",
          zIndex: -1,
        }}
      />
    );
  }

  const wallpaperComponent = getWallpaperComponent?.();

  if (!wallpaperComponent) {
    return (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: "var(--themegradient)",
          zIndex: -1,
        }}
      />
    );
  }

  return (
    <>
      <Suspense
        fallback={
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              background: "var(--album-art-background, #000)",
              zIndex: -1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
            }}
          >
            Loading wallpaper component...
          </div>
        }
      >
        {wallpaperComponent &&
          React.createElement(wallpaperComponent, {
            key: currentWallpaper?.name ?? "none",
            currentSong: wallpaperSong,
            playbackState,
          })}
      </Suspense>
    </>
  );
};

export default React.memo(WallpaperRenderer);

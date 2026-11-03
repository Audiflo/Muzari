import React, { useEffect, useRef } from "react";
import gsap from "gsap";
import type { WallpaperProps } from "../../../theming/types";
import playerStyles from "../../../../components/player/Player.module.css";

const PLATE_COUNT = 5;

const AlbumArtAdaptive: React.FC<WallpaperProps> = ({
  currentSong,
  playbackState,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const playbackStateRef = useRef(playbackState);
  const plates = Array.from({ length: PLATE_COUNT });

  useEffect(() => {
    playbackStateRef.current = playbackState;
  }, [playbackState]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const analyser = playbackStateRef.current?.analyserNode;
    const frequencyData = analyser
      ? new Uint8Array(analyser.frequencyBinCount)
      : undefined;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const state = {
      pulse: 0,
    };

    const plateNodes = Array.from(
      root.querySelectorAll<HTMLElement>("[data-art-plate]"),
    );
    const art = root.querySelector<HTMLElement>("[data-art-main]");
    const details = root.querySelector<HTMLElement>("[data-art-details]");

    gsap.set(plateNodes, {
      opacity: 0,
      scale: 1.26,
      rotation: (index) => (index - 2) * 5,
      x: (index) => (index % 2 === 0 ? -1 : 1) * (80 + index * 18),
      xPercent: -50,
      yPercent: -50,
    });
    gsap.set(art, {
      opacity: 0,
      scale: 0.74,
      rotation: 10,
      x: 120,
      y: 34,
      xPercent: -50,
      yPercent: -50,
    });
    gsap.set(details, { opacity: 0, y: 24 });
    const intro = gsap.timeline({ defaults: { ease: "expo.out" } });
    intro
      .to(plateNodes, {
        opacity: (index) => 0.08 + index * 0.035,
        scale: 1,
        rotation: (index) => (index - 2) * 2.5,
        x: 0,
        duration: 0.9,
        stagger: 0.075,
      })
      .to(
        art,
        {
          opacity: 0.88,
          scale: 1,
          rotation: 0,
          x: 0,
          y: 0,
          duration: 0.9,
          ease: "back.out(1.35)",
        },
        "-=0.65",
      )
      .to(details, { opacity: 1, y: 0, duration: 0.45 }, "-=0.35");

    const ticker = () => {
      if (
        !frequencyData ||
        !analyser ||
        playbackStateRef.current?.isPlaying === false
      ) {
        state.pulse = 0;
        document.documentElement.style.setProperty("--wallpaper-pulse", "0");
        gsap.set(art, { scale: 1 });
        gsap.set(plateNodes, { scale: 1 });
        return;
      }
      analyser.getByteFrequencyData(frequencyData);
      const bassEnd = Math.max(1, Math.floor(frequencyData.length * 0.12));
      const bass =
        frequencyData.slice(0, bassEnd).reduce((sum, value) => sum + value, 0) /
        (bassEnd * 255);
      const bassThreshold = 0.14;
      const bassSignal = Math.max(
        0,
        Math.min(1, (bass - bassThreshold) / (1 - bassThreshold)),
      );

      if (bass <= bassThreshold) {
        state.pulse = 0;
        document.documentElement.style.setProperty("--wallpaper-pulse", "0");
        gsap.set(art, { scale: 1 });
        gsap.set(plateNodes, { scale: 1 });
        return;
      }

      state.pulse +=
        (bassSignal - state.pulse) * (bassSignal > state.pulse ? 0.52 : 0.18);
      if (!reduceMotion) {
        const pulse = state.pulse ** 1.35;
        document.documentElement.style.setProperty(
          "--wallpaper-pulse",
          pulse.toFixed(3),
        );
        gsap.set(art, {
          scale: 1 + pulse * 0.12,
        });
        gsap.set(plateNodes, {
          scale: (index) => 1 + pulse * (0.16 + index * 0.035),
        });
      } else {
        document.documentElement.style.setProperty("--wallpaper-pulse", "0");
      }
    };

    gsap.ticker.add(ticker);
    return () => {
      intro.kill();
      gsap.killTweensOf(state);
      gsap.ticker.remove(ticker);
      document.documentElement.style.removeProperty("--wallpaper-pulse");
      gsap.set([art, ...plateNodes], { clearProps: "transform" });
    };
  }, [currentSong?.id]);

  const image = currentSong?.albumArt;

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: -1,
        overflow: "hidden",
        background: "var(--background)",
        pointerEvents: "none",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "var(--album-art-background)",
          opacity: 0.18,
          mixBlendMode: "multiply",
        }}
      />
      <div
        data-art-details
        style={{
          position: "absolute",
          left: "clamp(1rem, 8vw, 9rem)",
          top: "clamp(5rem, 18vh, 12rem)",
          zIndex: 1,
          color: "var(--foreground)",
          fontFamily: "var(--font-family-base)",
          textTransform: "uppercase",
          letterSpacing: "0.22em",
          fontSize: "clamp(0.55rem, 0.8vw, 0.75rem)",
        }}
      >
        <span>{currentSong?.artist || "Muzari"}</span>
        <span style={{ display: "block", opacity: 0.62, marginTop: 8 }}>
          {currentSong?.album || "Adaptive / 01"}
        </span>
      </div>

      <div
        data-art-main
        className={playerStyles.albumArt}
        style={{
          position: "absolute",
          width: "min(48vw, 660px)",
          height: "min(48vw, 660px)",
          aspectRatio: "1",
          left: "50%",
          top: "43%",
          transform: "translate(-50%, -50%)",
          zIndex: 0,
          overflow: "hidden",
          boxShadow: "24px 28px 0 var(--album-art-secondary)",
          willChange: "transform, opacity",
        }}
      >
        {image ? (
          <img
            src={image}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
              filter: "saturate(1.12) contrast(1.08)",
            }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(115deg, transparent 0 42%, color-mix(in srgb, var(--foreground) 70%, transparent) 42% 44%, transparent 44%)",
            mixBlendMode: "screen",
          }}
        />
      </div>

      {plates.map((_, index) => (
        <div
          key={index}
          data-art-plate
          style={{
            position: "absolute",
            width: "min(48vw, 660px)",
            height: "min(48vw, 660px)",
            aspectRatio: "1",
            left: "50%",
            top: "43%",
            transform: "translate(-50%, -50%)",
            background:
              index % 2 === 0
                ? "color-mix(in srgb, var(--album-art-primary) 16%, transparent)"
                : "color-mix(in srgb, var(--album-art-secondary) 12%, transparent)",
            mixBlendMode: index % 2 ? "screen" : "multiply",
            border: `1px solid color-mix(in srgb, var(--foreground) ${28 + index * 8}%, transparent)`,
            willChange: "transform, opacity",
          }}
        />
      ))}
    </div>
  );
};

export default AlbumArtAdaptive;

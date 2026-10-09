"use client";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/providers";
import { solarPhase } from "@/domain/time";
import { atmosphereMetrics } from "@/domain/atmosphere";
import { createAtmosphereRenderer } from "./atmosphere-renderer";
import styles from "./weather-atmosphere.module.css";
import type { MapCamera } from "./map-camera";
export function WeatherAtmosphere() {
  const { env, overrides } = useApp();
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ env, overrides });
  useEffect(() => {
    latest.current = { env, overrides };
  }, [env, overrides]);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let renderer: ReturnType<typeof createAtmosphereRenderer> = null;
    let frame = 0,
      last = 0,
      elapsed = 0,
      disposed = false,
      slow = 0;
    let adaptive = false;
    const setup = () => {
      try {
        renderer = createAtmosphereRenderer(element);
        setFallback(!renderer);
      } catch {
        setFallback(true);
      }
    };
    setup();
    let camera: MapCamera = {
      x: 0.5,
      y: 0.5,
      scale: 512 * 2048,
      width: element.clientWidth,
      height: element.clientHeight,
      water: [],
    };
    const wrapper = element.closest(".map-canvas-wrap");
    const updateCamera = (event: Event) => {
      camera = (event as CustomEvent<MapCamera>).detail;
      renderer?.setCamera(camera);
      if (latest.current.env.reducedMotion) restart();
    };
    wrapper?.addEventListener("sq-camera", updateCamera);
    function draw(at: number) {
      if (disposed || document.hidden || !renderer) return;
      const { env, overrides } = latest.current,
        m = atmosphereMetrics(env.weather),
        phase = solarPhase(env.now, env.weather.sunrise, env.weather.sunset);
      const mobile = element!.clientWidth < 700,
        low =
          overrides.atmosphereQuality === "low" ||
          (overrides.atmosphereQuality !== "high" && (mobile || adaptive));
      const interval = low ? 1000 / 30 : 1000 / 60;
      if (at - last >= interval - 1) {
        if (last && at - last > 60) slow++;
        else slow = Math.max(0, slow - 1);
        if (slow > 24) adaptive = true;
        elapsed += last ? Math.min(at - last, 100) : 0;
        last = at;
        renderer.draw(
          {
            time: elapsed / 1000,
            cameraX: camera.x,
            cameraY: camera.y,
            cameraScale: camera.scale,
            viewportWidth: camera.width,
            viewportHeight: camera.height,
            storm:
              env.weather.source !== "unavailable" &&
              env.weather.kind === "thunderstorm"
                ? 1
                : 0,
            rain: m.rain,
            snow: m.snow ? m.snowIntensity : 0,
            wind: m.wind,
            direction: m.direction,
            gust: m.gust,
            cloud: m.cloud,
            fog: m.fog,
            night: phase === "midnight" || phase === "evening" ? 1 : 0,
            golden: phase === "golden-hour" ? 1 : phase === "sunset" ? 0.6 : 0,
            motion: env.reducedMotion ? 0 : 1,
          },
          low ? 0.75 : Math.min(window.devicePixelRatio, 1.5),
        );
      }
      // Reduced motion draws a static density field, including precipitation.
      if (!env.reducedMotion) frame = requestAnimationFrame(draw);
    }
    const restart = () => {
      cancelAnimationFrame(frame);
      last = 0;
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    const lost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      renderer?.dispose();
      renderer = null;
      setFallback(true);
    };
    const restored = () => {
      setup();
      renderer?.setCamera(camera);
      restart();
    };
    element.addEventListener("webglcontextlost", lost);
    element.addEventListener("webglcontextrestored", restored);
    document.addEventListener("visibilitychange", restart);
    const resize = new ResizeObserver(restart);
    resize.observe(element);
    restart();
    // Read changing Lab values without allocating a new context; also wake static reduced-motion previews.
    let previousMotion = latest.current.env.reducedMotion;
    const refresh = setInterval(() => {
      const reduced = latest.current.env.reducedMotion;
      if (reduced || previousMotion !== reduced) restart();
      previousMotion = reduced;
    }, 350);
    return () => {
      wrapper?.removeEventListener("sq-camera", updateCamera);
      disposed = true;
      cancelAnimationFrame(frame);
      clearInterval(refresh);
      resize.disconnect();
      document.removeEventListener("visibilitychange", restart);
      element.removeEventListener("webglcontextlost", lost);
      element.removeEventListener("webglcontextrestored", restored);
      renderer?.dispose();
    };
  }, []);
  const phase = solarPhase(env.now, env.weather.sunrise, env.weather.sunset),
    m = atmosphereMetrics(env.weather);
  return (
    <div
      aria-hidden="true"
      className={`weather-atmosphere ${styles.root}`}
      data-renderer={fallback ? "static" : "webgl"}
      data-weather={
        env.weather.source === "unavailable" ? "unavailable" : env.weather.kind
      }
      data-time={phase}
      data-motion={env.reducedMotion ? "reduced" : "normal"}
      data-rain={env.weather.rain}
      data-wind={env.weather.wind}
    >
      <canvas
        ref={canvas}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
      {fallback && (
        <div
          style={{
            background:
              phase === "midnight" || phase === "evening"
                ? "#243747"
                : "#d7e0df",
            opacity: Math.min(0.35, m.fog * 0.3 + m.cloud * 0.12 + 0.05),
          }}
        />
      )}
    </div>
  );
}

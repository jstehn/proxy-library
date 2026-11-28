import type { ResolvedThemeBackdrop } from "./resolve-theme";

type ThemeBackdropProps = Readonly<{
  backdrop: ResolvedThemeBackdrop | null;
}>;

/**
 * Fixed viewport artwork layer for plane themes (Steam-profile style). Renders nothing on flat
 * themes or when palette-only mode is enabled, and hides itself under `forced-colors: active`.
 */
export function ThemeBackdrop({ backdrop }: ThemeBackdropProps) {
  if (backdrop === null) return null;

  return (
    <div
      aria-hidden="true"
      className="theme-backdrop pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div
        className="absolute inset-0 bg-cover bg-no-repeat"
        style={{
          backgroundImage: `url("${backdrop.url}")`,
          backgroundPosition: backdrop.focalPoint,
          opacity: backdrop.opacity,
        }}
      />
      <div className="absolute inset-0" style={{ background: backdrop.scrim }} />
    </div>
  );
}

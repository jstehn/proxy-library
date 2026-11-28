import type { ResolvedThemeBackdrop } from "./resolve-theme";

type ThemeBackdropProps = Readonly<{
  backdrop: ResolvedThemeBackdrop | null;
}>;

/**
 * Fixed viewport artwork + plane-artistry layer (Steam-profile style). Renders nothing on flat
 * themes or when palette-only mode is enabled, and hides itself under `forced-colors: active`.
 */
export function ThemeBackdrop({ backdrop }: ThemeBackdropProps) {
  if (backdrop === null) return null;

  return (
    <div
      aria-hidden="true"
      className="theme-backdrop pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {backdrop.url !== null && (
        <div
          className="absolute inset-0 bg-cover bg-no-repeat"
          style={{
            backgroundImage: `url("${backdrop.url}")`,
            backgroundPosition: backdrop.focalPoint,
            opacity: backdrop.opacity,
          }}
        />
      )}
      <div className="theme-backdrop-art absolute inset-0" />
      <div className="absolute inset-0" style={{ background: backdrop.scrim }} />
    </div>
  );
}

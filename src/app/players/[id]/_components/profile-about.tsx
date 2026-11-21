import { formatLabel } from "@/app/decks/labels";
import type { PlayerProfileView } from "@/modules/social";

const COLOR_LABELS: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

/** The bio and the favourite colours and formats. */
export function ProfileAbout(props: { profile: PlayerProfileView }) {
  const { profile } = props;
  return (
    <>
      {(profile.bio || profile.favoriteColors.length > 0 || profile.favoriteFormats.length > 0) && (
        <section className="flex flex-col gap-3">
          {profile.bio && (
            <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
              {profile.bio}
            </p>
          )}
          <div className="flex flex-wrap gap-6 text-sm">
            {profile.favoriteColors.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted text-xs tracking-wide uppercase">Favorite colors</span>
                <span className="flex items-center gap-1">
                  {profile.favoriteColors.map((color) => (
                    <i
                      key={color}
                      className={`ms ms-${color.toLowerCase()} ms-cost ms-shadow`}
                      title={COLOR_LABELS[color] ?? color}
                      aria-label={COLOR_LABELS[color] ?? color}
                    />
                  ))}
                </span>
              </div>
            )}
            {profile.favoriteFormats.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted text-xs tracking-wide uppercase">Favorite formats</span>
                <span>{profile.favoriteFormats.map(formatLabel).join(" · ")}</span>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}

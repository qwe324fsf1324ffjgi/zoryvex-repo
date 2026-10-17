const WIDTHS = [320, 480, 640, 864] as const;

function srcSet(ext: 'jpg' | 'webp') {
  return WIDTHS.map((w) => `/founder/founder-${w}.${ext} ${w}w`).join(', ');
}

/**
 * Alt text is deliberately neutral: it does not infer race, age, health, or
 * personality — it states only what the image factually is.
 */
export function FounderPhoto() {
  return (
    <picture>
      <source type="image/webp" srcSet={srcSet('webp')} sizes="(min-width: 640px) 320px, 60vw" />
      <img
        src="/founder/founder-480.jpg"
        srcSet={srcSet('jpg')}
        sizes="(min-width: 640px) 320px, 60vw"
        width={864}
        height={1060}
        alt="Portrait of Zerah, founder of Zoryvex."
        className="w-full max-w-xs rounded-lg border border-warm-200 object-cover"
      />
    </picture>
  );
}

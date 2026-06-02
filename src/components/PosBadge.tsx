import './PosBadge.css';

interface PosBadgeProps {
  /** Raw part-of-speech abbreviation from the es det (n, v, adj, interj, …). */
  pos?: string | null;
  /** Only render when the word1 has more than one discoverable POS. */
  hasMultiplePos?: boolean;
  className?: string;
}

/**
 * Small "(v)" / "(n)" disambiguation badge shown next to a Spanish headword when
 * that spelling has multiple discoverable parts of speech (e.g. `vivir` exists as
 * both a verb and a noun). Renders nothing for single-POS words or Chinese.
 */
export default function PosBadge({ pos, hasMultiplePos, className }: PosBadgeProps) {
  if (!hasMultiplePos || !pos) return null;
  return (
    <span className={`pos-badge${className ? ` ${className}` : ''}`} aria-label={`part of speech: ${pos}`}>
      ({pos})
    </span>
  );
}

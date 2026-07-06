// Shared est English-translation renderer. Underlines the `translatedVocab`
// substring — the English word/phrase corresponding to the card's headword —
// so the English mirrors the underline the foreign-text cpcd draws under the
// headword characters. Used by both card-detail surfaces (the eip's est in
// InfoCardPanelBody and the read-only/saved cdp in VocabCardDetailBody) so the
// two stay identical. Case-insensitive match; underlines the first occurrence.
export function renderEnglishWithVocabUnderline(
  english: string,
  translatedVocab?: string
): React.ReactNode {
  if (!translatedVocab) return english;
  const idx = english.toLowerCase().indexOf(translatedVocab.toLowerCase());
  if (idx === -1) return english;
  return (
    <>
      {english.slice(0, idx)}
      <span style={{ textDecoration: "underline" }}>
        {english.slice(idx, idx + translatedVocab.length)}
      </span>
      {english.slice(idx + translatedVocab.length)}
    </>
  );
}

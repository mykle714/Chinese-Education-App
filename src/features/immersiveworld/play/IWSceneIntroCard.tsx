import { alpha } from '@mui/material/styles';
import { Box, ButtonBase, Typography } from '@mui/material';
import { CARD_SURFACE, COLORS, SHADOW, TEXT } from '../../../theme';

/**
 * IWSceneIntroCard — the author's "what to do here" note, shown once as the scene opens
 * (`IWScene.introText`, migration 167; docs/IMMERSIVE_WORLD.md § 12 phase 1d).
 *
 * LAYER: feature view. Stateless — the page owns whether it is showing, and owns the world
 * hold (`useIWSceneRuntime` → `setPaused`) that keeps the scene still behind it.
 *
 * TWO WAYS OUT, ONE MEANING. The gold Start button is the deliberate exit; tapping the scrim
 * outside the card does the same thing, because a learner who taps the world is telling us
 * they want to play. A tap ON the card is swallowed so reading it never dismisses it by
 * accident.
 *
 * WHY IT COVERS THE COMPOSER TOO. The page mounts this over its whole body, not just the
 * stage: a line typed while the world is held would sit parked at the hold with no visible
 * reason, so the text box is behind the scrim with everything else.
 *
 * WHY THE SCRIM IS LIGHTER THAN THE INTERACTION POPUP'S. That popup IS the content (a picture
 * to study), so it darkens the world away. This card is a preface to the world, so the board
 * stays visible behind it — the learner sees where they are about to walk in.
 *
 * ⚠️ The text is author prose written OUT of world. It is rendered, never sent anywhere.
 *
 * Referenced by: src/features/immersiveworld/play/IWPlayPage.tsx.
 */

export interface IWSceneIntroCardProps {
  /** The scene's name — the card's title, so the intro reads as "this place". */
  sceneName: string;
  /** `IWScene.introText`, already known to be non-blank. */
  text: string;
  onDismiss(): void;
}

export default function IWSceneIntroCard({ sceneName, text, onDismiss }: IWSceneIntroCardProps) {
  return (
    <Box
      className="iw-scene-intro-card__scrim"
      onClick={onDismiss}
      sx={{
        position: 'absolute', inset: 0, zIndex: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: 2.5,
        bgcolor: alpha(COLORS.onSurface, 0.38),
        animation: 'iwIntroFade 180ms ease-out',
        '@keyframes iwIntroFade': { from: { opacity: 0 }, to: { opacity: 1 } },
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    >
      <Box
        className="iw-scene-intro-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="iw-scene-intro-card-title"
        // Swallow taps on the card itself — only the scrim and the button dismiss.
        onClick={(e) => e.stopPropagation()}
        sx={{
          ...CARD_SURFACE,
          boxShadow: SHADOW.popover,
          bgcolor: COLORS.white,
          width: '100%', maxWidth: 360,
          px: 2.5, pt: 2.25, pb: 2,
          display: 'flex', flexDirection: 'column', gap: 1.25,
          animation: 'iwIntroRise 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          '@keyframes iwIntroRise': {
            from: { opacity: 0, transform: 'translateY(8px) scale(0.98)' },
            to: { opacity: 1, transform: 'none' },
          },
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        <Typography className="iw-scene-intro-card__overline" sx={{ ...TEXT.overline, color: COLORS.textFaint }}>
          Your scene
        </Typography>
        <Typography
          id="iw-scene-intro-card-title"
          className="iw-scene-intro-card__title"
          sx={{ ...TEXT.cardTitle, color: COLORS.onSurface }}
        >
          {sceneName}
        </Typography>
        <Typography
          className="iw-scene-intro-card__text"
          // pre-wrap: the author's line breaks are part of what they wrote.
          sx={{ ...TEXT.body, color: COLORS.textSecondary, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {text}
        </Typography>
        <ButtonBase
          className="iw-scene-intro-card__start"
          onClick={onDismiss}
          autoFocus
          // `--gld` is the app's "the one thing to tap" metal (see COLORS.gld), ink on it.
          sx={{
            ...TEXT.bodyEmph,
            mt: 0.75,
            height: 44, borderRadius: 999,
            bgcolor: COLORS.gld, color: COLORS.onSurface,
            '&:active': { transform: 'scale(0.98)' },
            '&.Mui-focusVisible': { outline: `2px solid ${COLORS.onSurface}`, outlineOffset: 2 },
          }}
        >
          Start
        </ButtonBase>
      </Box>
    </Box>
  );
}

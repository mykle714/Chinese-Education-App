import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, ButtonBase, CircularProgress, IconButton, InputBase, Tooltip } from '@mui/material';
import { alpha, darken, keyframes } from '@mui/material/styles';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import SendIcon from '@mui/icons-material/Send';
import SearchIcon from '@mui/icons-material/Search';
import BackspaceIcon from '@mui/icons-material/Backspace';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import { apiGet } from '../../../api/http';
import IWLookupResults from './IWLookupResults';
import { IW_MAX_UTTERANCE_CHARS } from '../../../../server/contracts/iw';
import type { DictionaryEntry } from '../../../types';
import type { IWFloor } from './useIWSceneRuntime';
import { IW_SELECT_BLUE_CSS } from './iwTapColors';
import { COLORS } from '../../../theme';

/**
 * IWComposer — how a beginner with no IME says something (§ 9a, § 14 Q4b/Q4c).
 *
 * ⚠️ **THIS IS A THROWAWAY, AND IT SAYS SO IN THE PLAN.** § 12 phase 2 requires the writing
 * assistant to be "entirely under `features/iw`, header-commented as destined for replacement
 * by BACKLOG item 1" (the beginner writing keyboard). Nothing outside this folder imports it,
 * and nothing here is a contract. When the real keyboard exists, this file is deleted rather
 * than migrated.
 *
 * ── What the input IS (Q4c, decided) ──────────────────────────────────────────────────────
 * FREE TEXT, assisted. Not a palette of server-issued words: a canned palette can only say
 * what somebody anticipated, and Q31's complications are improvised and hand the resolution
 * back to the learner. So the field accepts anything, and the assistance is a way IN rather
 * than a fence.
 *
 * ── The one question it answers: a PURE DICTIONARY (decided 2026-09-07) ───────────────────
 * *"I know what I want to say but cannot type it"* — type English or pinyin, tap a result, the
 * hanzi is appended. That is the whole component.
 *
 * ── HOW THE LOOKUP IS RANKED (2026-09-09) ────────────────────────────────────────────────
 * A dictionary query is never "an English search" or "a pinyin search": one SQL statement ORs
 * the headword, the pinyin regexes and the gloss regex together, and the RANKING decides which
 * reading leads. Every search surface now shares one four-bucket ladder (see
 * `DictionarySearchRanking`, server/contracts/wire.ts):
 *
 *     0  complete English   a sense IS the term            "long" → 长; "me" → 我
 *     1  complete word      headword/pronunciation IS it   "long" → 龙 lóng
 *     2  partial word       the term is a leading prefix   "long" → 龙虾 lóng xiā
 *     3  partial English    the term sits inside a sense   "long" → 寿 "long life"
 *
 * ⚠️ **THE ONLY THING THIS TRAY DOES DIFFERENTLY IS THE INTERLEAVED HEAD.** It passes
 * `rankBy: 'english-first'`, which prepends the first two rows of EVERY bucket
 * (0,0,1,1,2,2,3,3) before the ladder resumes. On a strip this short, straight bucket order
 * would let a term with dozens of exact glosses fill every visible chip with bucket 0, hiding
 * that a complete pinyin reading of what the learner typed exists at all. A page-long list has
 * no such problem, which is why the dictionary page does not get the head. Purely a
 * re-ordering: same rows, same total, nothing dropped or repeated as pages append.
 *
 * The ladder itself was a general fix and is NOT tray-specific — at `limit: 8` it had also been
 * deciding which reading survived the LIMIT inside Postgres, which is why the page size below
 * is 16 and the strip pages rather than truncating.
 *
 * ⚠️ **IT DELIBERATELY NO LONGER SUGGESTS ANYTHING.** Two chip rows were removed: a hardcoded
 * `OPENERS` list (你好 / 请问 / 我要 / …) and a row of the learner's own `getGameVocabPool`
 * words. Both put words on screen before the learner had typed a character, which made the
 * tray read as a menu of things to say rather than a tool for saying your own thing — the
 * palette Q4c rejected, arriving through the back door. **Nothing renders until the learner
 * types**, and what renders is only ever what they asked for.
 *
 * ⚠️ **THIS GIVES UP § 9a's SECOND REQUIREMENT, KNOWINGLY.** § 9a asks the assistant to answer
 * *"I don't know where to begin"* too, and calls it the harder one, because Q24 removed the
 * native-language companion and Q29 removed the nudge. A pure dictionary answers only the
 * first: a learner who cannot start a sentence now has nothing to press. That safety net is
 * **unassigned**, not relocated — if it comes back it must arrive as something other than a
 * standing word list, and BACKLOG item 1's keyboard is the natural owner.
 *
 * ── No volume control (§ 4c, withdrawn 2026-09-23) ────────────────────────────────────────
 * There used to be a whisper/say/shout chip in this row. It is gone with the hearing gate it
 * drove: everybody in a scene hears every line, and WHO the learner meant is worked out from
 * position, facing and the sentence itself (§ 4.2), not from a range the learner picked.
 *
 * ⚠️ **IT IS NOT A BOUND ON INPUT** (§ 9a, § 7). The character counter here is a courtesy so
 * a learner is not surprised by a refusal; the real cap is `IW_MAX_UTTERANCE_CHARS` on the
 * server, which assumes this component was bypassed entirely.
 *
 * ── THE CONTINUE BAR (§ 5.3d, 2026-09-23) ─────────────────────────────────────────────────
 * Whenever the learner does not hold the floor, the WHOLE composer band becomes one solid blue
 * bar, edge to edge — it is not a disabled text box with a spinner in the send button (which
 * is what it replaced), and not a pill inset inside the band either: the entire strip is the
 * tap target, so the learner can hit it without looking down.
 * `waiting` is the bar inert, with a soft three-dot pulse (a turn in flight, a line queued but
 * not painted yet); `continue` is the bar live, and tapping it dismisses the NPC line on screen.
 * The draft in the text box survives the swap — `text` is state here, not in the input — so an
 * ambient line that interrupts a half-typed sentence costs the learner nothing.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.3d, § 9a, § 12 phase 2, § 14 Q4b, § 14 Q4c, § 14 Q29.
 */

/**
 * How many lookup results one page of the strip holds. Still a phone row rather than a
 * dictionary page — but big enough that the English-first ranking (see the header) has room
 * to show BOTH readings of the term, which eight slots did not.
 */
const LOOKUP_PAGE_SIZE = 16;

/**
 * Which reading of the typed term leads the results. See the header, and
 * `DictionarySearchRanking` in server/contracts/wire.ts.
 */
const LOOKUP_RANK_BY = 'english-first';

/** The slice of `GET /api/dictionary/search` this tray reads. It ignores the AI-fallback flags. */
interface LookupPage {
  entries: DictionaryEntry[];
  pagination?: { page: number; limit: number; total: number; totalPages: number };
}

/** Debounce on the lookup field. Long enough that typing a word is one query, not five. */
const LOOKUP_DEBOUNCE_MS = 300;

/**
 * The text row's height: a `size="small"` IconButton (18–20px glyph + 5px padding each side).
 * The Continue bar takes the same height so swapping one for the other never moves the stage.
 */
const IW_COMPOSER_ROW_HEIGHT = 34;

/**
 * The whole composer band with the tray closed: the row, the band's `p: 1` (8px) above and
 * below, and its 1px top border. The Continue bar replaces the entire band at this height.
 */
const IW_COMPOSER_BAND_HEIGHT = IW_COMPOSER_ROW_HEIGHT + 2 * 8 + 1;

/**
 * How far a pressed/hovered band darkens off the selection blue — enough to register under a
 * thumb, not so much that the band reads as a different colour.
 */
const IW_CONTINUE_BAND_PRESS_DARKEN = 0.12;

/** The waiting bar's three dots, each a staggered copy of this one breath. */
const dotBreath = keyframes`
  0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
  40% { opacity: 0.9; transform: translateY(-2px); }
`;

export interface IWComposerProps {
  language: 'zh' | 'es';
  /**
   * Who may speak next (`useIWSceneRuntime` → `IWFloor`). `open` is the text box; `waiting`
   * and `continue` are the bar; `frozen` is the text box with send permanently inert.
   */
  floor: IWFloor;
  onSend(text: string): void;
  /** The Continue tap. Only ever called while `floor === 'continue'`. */
  onContinue(): void;
}

export default function IWComposer({ language, floor, onSend, onContinue }: IWComposerProps) {
  const disabled = floor !== 'open';
  const showBar = floor === 'waiting' || floor === 'continue';
  const [text, setText] = useState('');
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DictionaryEntry[]>([]);
  const [looking, setLooking] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /**
   * Paging state lives in REFS, not state. `loadMore` is handed to the strip's scroll/resize
   * measurement, which calls whatever closure it captured — a state read there would see a
   * stale page number and re-request the page it just appended. The chips themselves are
   * state, because they are what renders; these four are only ever read inside a callback.
   *
   * `termRef` is the guard for the other race: a page that resolves AFTER the learner has
   * retyped is a page of the wrong query, and appending it would mix two searches in one strip.
   */
  const pageRef = useRef(1);
  const totalPagesRef = useRef(1);
  const loadingMoreRef = useRef(false);
  const termRef = useRef('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lookupRef = useRef<HTMLInputElement | null>(null);

  /**
   * Opening the quick dictionary FOCUSES its field, which is the whole point of the button:
   * the learner pressed it because they cannot write the word, so the thing they need next is
   * a cursor in the lookup field.
   *
   * ⚠️ WHICH KEYBOARD COMES UP IS NOT DECIDED HERE. The lookup field is an ordinary eligible
   * field inside the composer's `keep` region, so for a Chinese learner the focus hands the
   * handwriting keyboard over to it (or leaves the OS keyboard up, if the session is on `ABC`
   * — the choice is a session preference, BEGINNER_KEYBOARD.md § 6z-3). It is NOT marked
   * `data-beginner-keyboard="off"` any more (2026-09-24): that forced the latin OS keyboard
   * up on every open, and the learner now reaches it the same way as from any other field —
   * the switch bar's `ABC` segment. A Spanish learner has no handwriting keyboard, so they
   * get the OS keyboard as before.
   *
   * It runs in an effect rather than in the click handler because the field does not exist
   * until the tray has rendered. React flushes a discrete click's state synchronously, so the
   * focus still lands inside the user gesture — which is what mobile browsers require before
   * they will raise the OS keyboard.
   */
  useEffect(() => {
    if (dictionaryOpen) lookupRef.current?.focus();
  }, [dictionaryOpen]);

  const glyphs = useMemo(() => [...text.trim()].length, [text]);
  const overLimit = glyphs > IW_MAX_UTTERANCE_CHARS;
  const canSend = glyphs > 0 && !overLimit && !disabled;

  // ── Look up a word by English or pinyin ─────────────────────────────────────────────────
  // The ordinary dictionary search, which already resolves pinyin and English (its multi-stage
  // matcher is what the Dictionary page uses). iw does not need a search of its own — only a
  // different RANKING of the same results (see the header) and a page size it can grow.

  /** Reset paging. Called for a new query and after a send clears the tray. */
  const resetPaging = useCallback((term: string) => {
    pageRef.current = 1;
    totalPagesRef.current = 1;
    loadingMoreRef.current = false;
    termRef.current = term;
    setLoadingMore(false);
  }, []);

  useEffect(() => {
    const term = query.trim();
    resetPaging(term);
    // One character is enough: "I" and Spanish "a"/"o"/"y" are whole words.
    if (!dictionaryOpen || !term) { setResults([]); return; }
    let cancelled = false;
    setLooking(true);
    const timer = setTimeout(() => {
      apiGet<LookupPage>('/api/dictionary/search', {
        params: { term, language, limit: LOOKUP_PAGE_SIZE, page: 1, rankBy: LOOKUP_RANK_BY },
      })
        .then(data => {
          if (cancelled) return;
          setResults(data.entries ?? []);
          totalPagesRef.current = data.pagination?.totalPages ?? 1;
        })
        // A failed lookup is an empty result, never an error in front of a learner mid-scene.
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLooking(false); });
    }, LOOKUP_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, language, dictionaryOpen, resetPaging]);

  /**
   * Append the next page. Fired by the strip when the learner reaches its right edge — the
   * strip has no idea whether more exists, so every guard is here: nothing in flight, a term
   * to search for, and a page left to fetch.
   */
  const loadMore = useCallback(() => {
    const term = termRef.current;
    if (!term || loadingMoreRef.current) return;
    if (pageRef.current >= totalPagesRef.current) return;

    const nextPage = pageRef.current + 1;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    apiGet<LookupPage>('/api/dictionary/search', {
      params: { term, language, limit: LOOKUP_PAGE_SIZE, page: nextPage, rankBy: LOOKUP_RANK_BY },
    })
      .then(data => {
        // The learner retyped while this was in flight: it answers a question that is no
        // longer on screen, so drop it rather than mixing two searches into one strip.
        if (termRef.current !== term) return;
        pageRef.current = nextPage;
        totalPagesRef.current = data.pagination?.totalPages ?? nextPage;
        setResults(prev => {
          // Pages should not overlap, but a duplicate id would break the React keys and show
          // the same word twice, so it is cheap insurance rather than a trusted invariant.
          const seen = new Set(prev.map(entry => entry.id));
          return [...prev, ...(data.entries ?? []).filter(entry => !seen.has(entry.id))];
        });
      })
      // A failed page is simply no more chips — same rule as the first page.
      .catch(() => {})
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [language]);

  const append = useCallback((word: string) => {
    // Chinese is not space-delimited and Spanish is: joining with a space in zh would put a
    // gap inside a sentence nobody writes with gaps.
    setText(prev => (prev && language === 'es' ? `${prev} ${word}` : `${prev}${word}`));
    inputRef.current?.focus();
  }, [language]);

  const send = useCallback(() => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
    setQuery('');
    setResults([]);
    // The tray is emptied with the sentence, so its paging cursor has to go back to the
    // start too — otherwise the next query would resume from a stale page number.
    resetPaging('');
  }, [canSend, onSend, text, resetPaging]);

  // The Continue bar REPLACES the band rather than sitting inside it (§ 5.3d). An early return
  // is safe here — every hook is above — and the composer stays mounted, so the draft, the
  // tray's open state and its results are all still there when the text box comes back.
  if (showBar) return <IWContinueBar ready={floor === 'continue'} onContinue={onContinue} />;

  return (
    <Box
      className="iw-composer"
      /*
        Every control in here acts on the sentence being composed — the helper toggle, the
        dictionary chips, backspace, send. The handwriting keyboard treats
        focus as a TRIGGER and dismisses on anything not explicitly kept (BEGINNER_KEYBOARD.md
        § 6z), and a `<button>` takes focus when clicked on desktop, so without this the
        keyboard closed the moment the learner reached for send. Marked on the whole composer
        rather than per button so a control added here later inherits it.
      */
      data-beginner-keyboard="keep"
      sx={{
        position: 'relative',
        display: 'flex', flexDirection: 'column', gap: 0.75,
        p: 1,
        // ⚠️ THE COMPOSER IS CHROME, NOT THE SCENE — so it is theme-skinned, like the side
        // panels of the scene editor and for the same reason phase 1d gives there: only a
        // Pixi canvas gets to be dark, and this is an ordinary form control sitting under the
        // page's `LeafPage` paper. It shipped as a near-black bar (`rgba(12,12,16,0.92)`)
        // while every control inside it kept `color: 'inherit'`, which inherits the page's
        // DARK-on-light body colour — so the learner typed invisible text onto black. Painting
        // the text white would have hidden that mismatch rather than fixed it; the ground was
        // the thing that was wrong.
        bgcolor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
      }}
    >
      {dictionaryOpen && (
        <Box className="iw-composer__dictionary" sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {/*
            The quick dictionary, and nothing above it. The tray is EMPTY until the learner
            types — no openers, no card list, no standing suggestions of any kind.
          */}
          <Box
            className="iw-composer__lookup"
            /*
              No `data-beginner-keyboard` of its own: the field inherits the composer's
              `keep`, so it is eligible for the handwriting keyboard like the sentence field
              and tapping between the two retargets the keyboard rather than dismissing it.
              The query is usually English or pinyin, and the learner switches to the OS
              keyboard with the switch bar's `ABC` when it is (see the focus effect above).
            */
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <SearchIcon sx={{ fontSize: 16, opacity: 0.6 }} />
            <InputBase
              className="iw-composer__lookup-input"
              inputRef={lookupRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={language === 'zh' ? 'Quick dictionary — english or pinyin' : 'Quick dictionary — english'}
              sx={{ flex: 1, fontSize: 13, color: 'inherit' }}
            />
            {looking && <CircularProgress size={12} />}
          </Box>
          {results.length > 0 && (
            <IWLookupResults
              results={results}
              language={language}
              loadingMore={loadingMore}
              onSelect={append}
              onReachEnd={loadMore}
            />
          )}
        </Box>
      )}

      <Box className="iw-composer__row" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {/*
          A BOOK, not a lightbulb. The tray is a dictionary — it looks a word up, it does not
          suggest what to say (see the header: the suggestion rows were deliberately removed).
          A lightbulb promised the hint this control has not offered since then.
        */}
        <Tooltip title="Quick dictionary">
          <IconButton
            className="iw-composer__dictionary-toggle"
            size="small"
            color={dictionaryOpen ? 'primary' : 'default'}
            onClick={() => setDictionaryOpen(open => !open)}
            aria-label="Quick dictionary"
          >
            <MenuBookOutlinedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <InputBase
          className="iw-composer__input"
          inputRef={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Say something…"
          sx={{ flex: 1, fontSize: 15, color: 'inherit' }}
        />
        {text && (
          <IconButton
            className="iw-composer__backspace"
            size="small"
            aria-label="Delete the last character"
            // A backspace BUTTON, because the assistant appends whole words and a learner
            // without a Chinese keyboard may have no other way to take one back.
            onClick={() => setText(prev => [...prev].slice(0, -1).join(''))}
          >
            <BackspaceIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
        {/*
          The counter now appears only as the limit gets close. It used to sit there
          permanently at half opacity, which cost a slot in a row that is already tight
          on a phone — and a courtesy warning is not a warning until there is
          something to warn about (the real cap is the server's; see the header).
        */}
        {glyphs > IW_MAX_UTTERANCE_CHARS * 0.7 && (
          <Box
            className="iw-composer__count"
            sx={{ fontSize: 10, opacity: overLimit ? 1 : 0.6, color: overLimit ? 'error.main' : 'inherit' }}
          >
            {glyphs}/{IW_MAX_UTTERANCE_CHARS}
          </Box>
        )}
        {/*
          A bare icon, not a pill — on a phone this row holds the dictionary toggle, the field,
          backspace and this. `aria-label` keeps the verb for anybody not reading the row
          visually.
        */}
        <Tooltip title="Say it">
          <span>
            <IconButton
              className="iw-composer__send"
              size="small"
              color="primary"
              disabled={!canSend}
              onClick={send}
              aria-label="Say it"
            >
              <SendIcon sx={{ fontSize: 20 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}

/**
 * The band the composer turns into while an NPC holds the floor (§ 5.3d): one solid blue
 * strip, full width, square-edged, the whole of it the tap target.
 *
 * ⚠️ **THE BLUE IS THE STAGE'S SELECTION BLUE (`iwTapColors.ts`), NOT THE THEME PRIMARY.** The
 * same light blue outlines whatever a tap on the board selected and rings the person you are
 * addressing, so "blue" means one thing on this surface: the live thing, the one to act on. A
 * light fill needs dark text — white on it is ~1.6:1 — so the label is the app's ink
 * (`COLORS.onSurface`), like text on every other v2 surface colour.
 *
 * ONE element in both states, so going from waiting to ready changes only its contents and
 * shade — nothing moves or resizes under the learner's thumb. Waiting is the same blue washed
 * toward the page (inert, three-dot pulse); ready is the full blue with **Continue ›**. Its
 * height is the text band's (`IW_COMPOSER_BAND_HEIGHT`), so the stage above does not jump.
 */
function IWContinueBar({ ready, onContinue }: { ready: boolean; onContinue(): void }) {
  return (
    <ButtonBase
      className={`iw-composer__continue-bar${ready ? ' iw-composer__continue-bar--ready' : ''}`}
      disabled={!ready}
      onClick={onContinue}
      aria-label={ready ? 'Continue' : 'Waiting for them to speak'}
      sx={theme => {
        const band = IW_SELECT_BLUE_CSS;
        const pressed = darken(band, IW_CONTINUE_BAND_PRESS_DARKEN);
        return {
          width: '100%',
          flexShrink: 0,
          minHeight: IW_COMPOSER_BAND_HEIGHT,
          borderRadius: 0,
          gap: 0.25,
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: 0.3,
          color: COLORS.onSurface,
          // Waiting is the band's blue washed toward the page ground rather than a grey: the
          // band keeps its identity across both states, and only "can I tap it" changes.
          bgcolor: ready ? band : alpha(band, 0.45),
          transition: theme.transitions.create('background-color', { duration: 180 }),
          // Pressed/hovered settles one step darker than the band.
          '&:active': { bgcolor: pressed },
          '@media (hover: hover)': { '&:hover': { bgcolor: ready ? pressed : undefined } },
          // `disabled` would grey the dots out via MUI's defaults; the waiting state styles itself.
          '&.Mui-disabled': { color: COLORS.onSurface },
        };
      }}
    >
      {ready ? (
        <>
          <span className="iw-composer__continue-label">Continue</span>
          <ChevronRightIcon className="iw-composer__continue-chevron" sx={{ fontSize: 20, mr: -0.75 }} />
        </>
      ) : (
        <Box className="iw-composer__waiting-dots" sx={{ display: 'flex', gap: 0.75 }}>
          {[0, 1, 2].map(i => (
            <Box
              key={i}
              className="iw-composer__waiting-dot"
              sx={{
                width: 5, height: 5, borderRadius: '50%', bgcolor: 'currentColor',
                animation: `${dotBreath} 1.2s ease-in-out ${i * 0.16}s infinite`,
              }}
            />
          ))}
        </Box>
      )}
    </ButtonBase>
  );
}

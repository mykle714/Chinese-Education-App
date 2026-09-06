import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Chip, CircularProgress, IconButton, InputBase, Tooltip } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import SearchIcon from '@mui/icons-material/Search';
import BackspaceIcon from '@mui/icons-material/Backspace';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import { apiGet } from '../../../api/http';
import ForeignText from '../../../components/ForeignText';
import { IW_MAX_UTTERANCE_CHARS } from '../../../../server/contracts/iw';
import type { DictionaryEntry } from '../../../types';

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
 * ── The two questions it has to answer ────────────────────────────────────────────────────
 * § 9a names them, and they are different problems:
 *
 * | The learner's problem | This component's answer |
 * |---|---|
 * | *"I know what I want to say but cannot type it"* | **Look it up** — type English or pinyin, tap a result, the hanzi is appended |
 * | *"I don't know where to begin"* | **Openers** — a handful of in-language phrases to start from |
 *
 * The second is the harder requirement and the one iw cannot skip: Q24 removed the
 * native-language companion and Q29 removed the nudge, so this is the learner's ONLY safety
 * net. An assistant that only solves the first problem leaves a beginner staring at an empty
 * field, which is exactly the failure § 9a warns about.
 *
 * ⚠️ **IT IS NOT A BOUND ON INPUT** (§ 9a, § 7). The character counter here is a courtesy so
 * a learner is not surprised by a refusal; the real cap is `IW_MAX_UTTERANCE_CHARS` on the
 * server, which assumes this component was bypassed entirely.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 9a, § 12 phase 2, § 14 Q4b, § 14 Q4c, § 14 Q29.
 */

/**
 * Openers, in the target language — the answer to "I don't know where to begin".
 *
 * ⚠️ HARDCODED CONTENT, AND KNOWINGLY SO. These are not authored per scene and not drawn from
 * the learner's cards: they are the four or five things anybody can say in any situation, and
 * the point is that they are always there. A scene-aware version is a better feature and a
 * bigger one; an empty field with nothing to press is the failure this exists to prevent.
 */
const OPENERS: Record<'zh' | 'es', string[]> = {
  zh: ['你好', '请问', '我要', '多少钱', '谢谢', '我不懂'],
  es: ['Hola', 'Perdone', 'Quiero', '¿Cuánto cuesta?', 'Gracias', 'No entiendo'],
};

/** How many lookup results to show. A phone row, not a dictionary page. */
const LOOKUP_LIMIT = 8;

/** Debounce on the lookup field. Long enough that typing a word is one query, not five. */
const LOOKUP_DEBOUNCE_MS = 300;

export interface IWComposerProps {
  language: 'zh' | 'es';
  /** The learner's own words (§ 9.4) — the most likely things they can actually read. */
  knownWords: readonly string[];
  /** A turn is in flight, or the scene is frozen: the send button is inert. */
  disabled: boolean;
  sending: boolean;
  onSend(text: string): void;
}

export default function IWComposer({ language, knownWords, disabled, sending, onSend }: IWComposerProps) {
  const [text, setText] = useState('');
  const [assistOpen, setAssistOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DictionaryEntry[]>([]);
  const [looking, setLooking] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const glyphs = useMemo(() => [...text.trim()].length, [text]);
  const overLimit = glyphs > IW_MAX_UTTERANCE_CHARS;
  const canSend = glyphs > 0 && !overLimit && !disabled;

  // ── Look up a word by English or pinyin ─────────────────────────────────────────────────
  // The ordinary dictionary search, which already resolves pinyin and English (its multi-stage
  // matcher is what the Dictionary page uses). iw does not need a search of its own.
  useEffect(() => {
    const term = query.trim();
    if (!assistOpen || term.length < 2) { setResults([]); return; }
    let cancelled = false;
    setLooking(true);
    const timer = setTimeout(() => {
      apiGet<{ entries: DictionaryEntry[] }>('/api/dictionary/search', {
        params: { term, language, limit: LOOKUP_LIMIT },
      })
        .then(data => { if (!cancelled) setResults(data.entries ?? []); })
        // A failed lookup is an empty result, never an error in front of a learner mid-scene.
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLooking(false); });
    }, LOOKUP_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, language, assistOpen]);

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
  }, [canSend, onSend, text]);

  return (
    <Box
      className="iw-composer"
      sx={{
        position: 'relative',
        display: 'flex', flexDirection: 'column', gap: 0.75,
        p: 1,
        bgcolor: 'rgba(12,12,16,0.92)',
        borderTop: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      {assistOpen && (
        <Box className="iw-composer__assistant" sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {/* "I don't know where to begin" — always present, never search-dependent. */}
          <Box className="iw-composer__openers" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {OPENERS[language].map(opener => (
              <Chip
                key={opener}
                className="iw-composer__opener"
                size="small"
                label={<ForeignText text={opener} language={language} size="xs" showPinyin={false} />}
                onClick={() => append(opener)}
              />
            ))}
          </Box>

          {/* The learner's own cards — the words they are most likely to be able to read. */}
          {knownWords.length > 0 && (
            <Box
              className="iw-composer__known"
              sx={{ display: 'flex', gap: 0.5, overflowX: 'auto', pb: 0.5 }}
            >
              {knownWords.slice(0, 24).map(word => (
                <Chip
                  key={word}
                  className="iw-composer__known-word"
                  size="small"
                  variant="outlined"
                  label={<ForeignText text={word} language={language} size="xs" showPinyin={false} />}
                  onClick={() => append(word)}
                />
              ))}
            </Box>
          )}

          {/* "How do I say…" */}
          <Box className="iw-composer__lookup" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <SearchIcon sx={{ fontSize: 16, opacity: 0.6 }} />
            <InputBase
              className="iw-composer__lookup-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={language === 'zh' ? 'How do I say… (english or pinyin)' : 'How do I say… (english)'}
              sx={{ flex: 1, fontSize: 13, color: 'inherit' }}
            />
            {looking && <CircularProgress size={12} />}
          </Box>
          {results.length > 0 && (
            <Box
              className="iw-composer__results"
              sx={{ display: 'flex', gap: 0.5, overflowX: 'auto', pb: 0.5 }}
            >
              {results.map(entry => (
                <Chip
                  key={entry.id}
                  className="iw-composer__result"
                  size="small"
                  onClick={() => append(entry.word1)}
                  label={(
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                      <ForeignText
                        text={entry.word1}
                        pronunciation={entry.pronunciation}
                        language={language}
                        size="xs"
                      />
                      <Box component="span" sx={{ fontSize: 10, opacity: 0.65 }}>
                        {entry.definitions?.[0] ?? ''}
                      </Box>
                    </Box>
                  )}
                />
              ))}
            </Box>
          )}
        </Box>
      )}

      <Box className="iw-composer__row" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Tooltip title="Help me say something">
          <IconButton
            className="iw-composer__assist-toggle"
            size="small"
            color={assistOpen ? 'primary' : 'default'}
            onClick={() => setAssistOpen(open => !open)}
          >
            <LightbulbOutlinedIcon sx={{ fontSize: 18 }} />
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
        <Box
          className="iw-composer__count"
          sx={{ fontSize: 10, opacity: overLimit ? 1 : 0.5, color: overLimit ? 'error.main' : 'inherit' }}
        >
          {glyphs}/{IW_MAX_UTTERANCE_CHARS}
        </Box>
        <Button
          className="iw-composer__send"
          size="small"
          variant="contained"
          disabled={!canSend}
          onClick={send}
          startIcon={sending ? <CircularProgress size={12} color="inherit" /> : <SendIcon sx={{ fontSize: 16 }} />}
        >
          Say
        </Button>
      </Box>
    </Box>
  );
}

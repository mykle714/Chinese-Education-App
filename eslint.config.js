import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'server/', '.claude/'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettierConfig],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  // Iso text: no `dominantBaseline` in the iso kit or the scenes that print on it. It centres
  // the font's EM box, which WebKit and Chromium place differently for the CJK face the kit
  // prints in, so labels drift off-centre on iPhone only. Use IsoText / IsoSpacedText
  // (src/features/deckTower/iso/IsoText.tsx). docs/ISO_ART_FRAMEWORK.md § "Text in the iso kit".
  {
    files: ['src/features/deckTower/iso/**/*.tsx', 'src/features/discover/SortBins.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dominantBaseline']",
          message:
            'dominantBaseline drifts on iOS WebKit with the CJK face. Draw centred iso text with IsoText (or IsoSpacedText); see docs/ISO_ART_FRAMEWORK.md § "Text in the iso kit".',
        },
      ],
    },
  },
)

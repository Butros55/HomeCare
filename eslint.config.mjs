import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/** eslint-config-next 16 liefert native Flat-Configs (kein FlatCompat nötig). */
const eslintConfig = [
  {
    // Coreflow/StudyMate sind separate Referenzprojekte und werden nicht gelintet.
    ignores: [
      'Coreflow/**',
      'StudyMate/**',
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
      'public/sw.js',
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Portierter StudyMate-Kalender: nutzt bewusst Ref-Spiegel im Render,
    // Element-Caches und imperative CSS-Variablen (Pinch-Zoom-Performance).
    // Die React-Compiler-Regeln würden genau diese Techniken zerreißen –
    // die Vorlage ist damit produktionserprobt.
    files: ['src/features/calendar/pro/**'],
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
];

export default eslintConfig;

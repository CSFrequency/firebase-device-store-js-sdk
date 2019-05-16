import commonjs from 'rollup-plugin-commonjs';
import copy from 'rollup-plugin-copy';
import resolveModule from 'rollup-plugin-node-resolve';
import typescript from 'rollup-plugin-typescript2';
import { uglify } from 'rollup-plugin-uglify';

import pkg from './package.json';

const plugins = [
  resolveModule(),
  typescript({
    typescript: require('typescript'),
  }),
  commonjs(),
];

const external = Object.keys(pkg.peerDependencies || {});

export default [
  // Node.js build
  {
    input: `src/index.ts`,
    output: [{ file: pkg.main, format: 'cjs', sourcemap: true }],
    plugins,
    external,
  },
  // Browser builds
  {
    input: `src/index.ts`,
    output: [
      { file: pkg.browser, format: 'cjs', sourcemap: true },
      { file: pkg.module, format: 'es', sourcemap: true },
    ],
    plugins: [
      ...plugins,
      // uglify(),
      // Copy flow files
      copy({
        [`src/index.js.flow`]: `dist/index.cjs.js.flow`,
      }),
      copy({
        [`src/index.js.flow`]: `dist/index.esm.js.flow`,
      }),
    ],
    external,
  },
];

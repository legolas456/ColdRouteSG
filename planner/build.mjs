// Bundles the planner and the console code it shares (../frontend/src/lib)
// into one file for the Lambda Node.js 22 runtime. The AWS SDK clients are
// bundled too, so the function does not depend on the runtime's SDK version.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/handler.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // some SDK dependencies are CommonJS and call require()
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
})

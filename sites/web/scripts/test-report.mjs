import { build } from 'vite'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

await build({
  configFile: false,
  build: {
    ssr: resolve('tests/report.test.ts'),
    target: 'node22',
    outDir: 'node_modules/.tmp/report-tests',
    rollupOptions: { output: { entryFileNames: 'report.test.mjs' } },
  },
})
const result = spawnSync(process.execPath, [resolve('node_modules/.tmp/report-tests/report.test.mjs')], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1

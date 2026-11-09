import { createWriteStream, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const DEBUG_EXPORT_DIR = 'debug-exports'

/**
 * Dev only: POST /__debug-export?name=<file> writes the request body to
 * debug-exports/<file> in the project, so debug exports land on disk without
 * a save dialog and can be read straight from the repo folder.
 */
function debugExport(): Plugin {
  return {
    name: 'color-pitchy-debug-export',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__debug-export', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const url = new URL(req.url ?? '', 'http://localhost')
        // Keep it to a plain file name inside the export folder.
        const name = basename(url.searchParams.get('name') ?? '').replace(/[^\w.\- ]/g, '_')
        if (!name) {
          res.statusCode = 400
          res.end('missing name')
          return
        }
        const dir = join(server.config.root, DEBUG_EXPORT_DIR)
        mkdirSync(dir, { recursive: true })
        const out = createWriteStream(join(dir, name))
        req.pipe(out)
        out.on('finish', () => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ path: `${DEBUG_EXPORT_DIR}/${name}` }))
        })
        out.on('error', (err) => {
          res.statusCode = 500
          res.end(String(err))
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), debugExport()],
})

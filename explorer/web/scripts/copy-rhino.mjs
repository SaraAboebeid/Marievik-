// Copy rhino3dm (the WebAssembly build of openNURBS) next to the app, so .3dm files load offline.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
const src = 'node_modules/rhino3dm/'
const dst = 'public/rhino3dm/'
mkdirSync(dst, { recursive: true })
for (const f of ['rhino3dm.js', 'rhino3dm.wasm']) {
  if (existsSync(src + f)) copyFileSync(src + f, dst + f)
}
console.log('rhino3dm copied to', dst)

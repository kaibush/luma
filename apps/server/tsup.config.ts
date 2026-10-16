import { defineConfig } from 'tsup'
export default defineConfig({ entry: ['src/index.ts'], format: ['esm'], platform: 'node', target: 'node24', removeNodeProtocol: false, noExternal: ['@remote/protocol'], outDir: 'dist', clean: true })

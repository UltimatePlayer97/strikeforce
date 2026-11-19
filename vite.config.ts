
import { defineConfig } from 'vite';

export default defineConfig({
    base: '/strikeforce/',
    server: {
        host: '0.0.0.0',
        port: 5173,
        strictPort: true,
    },
    build: {
        target: 'es2022',
        sourcemap: true,
        assetsInlineLimit: 0,
    },
});

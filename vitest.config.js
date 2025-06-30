export default {
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', '.git'],
    setupFiles: ['./test/setup.ts'],
    typecheck: {
      enabled: false
    }
  }
}
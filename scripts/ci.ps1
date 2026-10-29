$ErrorActionPreference = 'Stop'
npm ci
npx tsc --noEmit
npx vitest run
npm run build
Write-Host 'CI checks passed.'

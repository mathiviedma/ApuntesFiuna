// Descarga Chromium para Playwright después de `npm install` (solo en desarrollo local), así la
// verificación contra insweb funciona sin pasos extra. En Vercel se usa @sparticuz/chromium.
// Si falla (sin internet, proxy), no rompe la instalación.
import { execSync } from 'node:child_process';

if (!process.env.VERCEL && !process.env.CI) {
  try {
    console.log('Descargando Chromium para leer insweb (una sola vez, ~150 MB)…');
    execSync('npx playwright-core install chromium', { stdio: 'inherit' });
  } catch {
    console.warn('\n⚠ No se pudo descargar Chromium. Más tarde ejecutá: npm run instalar-navegador');
    console.warn('  Mientras tanto podés usar VERIFICADOR=simulado en .env para ensayar la demo.\n');
  }
}

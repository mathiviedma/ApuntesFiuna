// Descarga Chromium para Playwright después de `npm install`, así la verificación
// contra insweb funciona sin pasos extra. Si falla (sin internet, proxy), no rompe la instalación.
// En Vercel no hace falta: allí se usa @sparticuz/chromium.
import { execSync } from 'node:child_process';

if (process.env.VERCEL || process.env.CI) process.exit(0);

try {
  console.log('Descargando Chromium para leer insweb (una sola vez, ~150 MB)…');
  execSync('npx playwright install chromium', { stdio: 'inherit' });
} catch {
  console.warn('\n⚠ No se pudo descargar Chromium. Más tarde ejecutá: npm run instalar-navegador');
  console.warn('  Mientras tanto podés usar VERIFICADOR=simulado en .env para ensayar la demo.\n');
}

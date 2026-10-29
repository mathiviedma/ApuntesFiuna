// Descarga Chromium para Playwright después de `npm install`, así la verificación
// contra insweb funciona sin pasos extra. Si falla (sin internet, proxy), no rompe la instalación.
import { execSync } from 'node:child_process';

try {
  console.log('Descargando Chromium para leer insweb (una sola vez, ~150 MB)…');
  execSync('npx playwright install chromium', { stdio: 'inherit' });
} catch {
  console.warn('\n⚠ No se pudo descargar Chromium. Más tarde ejecutá: npm run instalar-navegador');
  console.warn('  Mientras tanto podés usar VERIFICADOR=simulado en .env para ensayar la demo.\n');
}

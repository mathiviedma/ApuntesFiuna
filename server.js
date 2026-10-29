// Arranque local (npm start). En Vercel la app se exporta desde api/index.js.
import { config } from './src/config.js';
import { app } from './src/app.js';

app.listen(config.puerto, async () => {
  console.log(`Apuntes FIUNA corriendo en http://localhost:${config.puerto}`);
  if (config.verificador === 'simulado') {
    console.log('Verificador de notas: SIMULADO (cuentas de prueba en data/insweb-simulado.json)');
  } else {
    console.log(`Verificador de notas: insweb real (${config.insweb.url}${config.insweb.rutaNotasFinales})`);
    const { navegadorDisponible } = await import('./src/verificador/insweb.js');
    if (!(await navegadorDisponible()))
      console.warn('⚠ Falta Chromium para leer insweb. Ejecutá: npm run instalar-navegador');
  }
});

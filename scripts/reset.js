// Borra la base y los archivos subidos. Al volver a arrancar se cargan los datos de demo.
import fs from 'node:fs';
import { config } from '../src/config.js';

for (const f of [config.rutaDb, `${config.rutaDb}-wal`, `${config.rutaDb}-shm`]) fs.rmSync(f, { force: true });
fs.rmSync(config.carpetaArchivos, { recursive: true, force: true });
console.log('Base y archivos borrados. Ejecutá "npm start" para empezar con los datos de demo.');

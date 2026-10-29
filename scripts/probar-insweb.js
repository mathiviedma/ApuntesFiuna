// Prueba manual del lector de insweb con TU cuenta.
// Abre Chromium visible, guarda capturas, HTML y JSON en ./debug-insweb/ y muestra
// las notas leídas. Las capturas y el HTML contienen tus notas: borralos después.
//
//   npm run probar-insweb
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { config } from '../src/config.js';

const carpeta = path.join(config.raiz, 'debug-insweb');
fs.mkdirSync(carpeta, { recursive: true });

function preguntar(texto, oculto = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) {
      rl._writeToOutput = (s) => rl.output.write(s.includes(texto) ? s : s.replace(/[^\r\n]/g, '*'));
    }
    rl.question(texto, (r) => {
      rl.close();
      if (oculto) process.stdout.write('\n');
      resolve(r);
    });
  });
}

const usuario = await preguntar('Usuario de insweb: ');
const password = await preguntar('Contraseña de insweb: ', true);

const { obtenerNotasFinales } = await import('../src/verificador/insweb.js');
try {
  const notas = await obtenerNotasFinales({ usuario, password }, { debug: true, carpetaDebug: carpeta });
  console.log(`\nSe leyeron ${notas.length} filas de Notas finales:\n`);
  console.table(notas);
  const { MATERIAS } = await import('../src/materias.js');
  const { evaluarMateria } = await import('../src/verificador/index.js');
  console.log('\nResultado de la regla (nota 4 o 5) para cada materia del catálogo:\n');
  console.table(
    MATERIAS.map((m) => {
      const r = evaluarMateria(notas, m);
      return { materia: m.nombre, cumple: r.cumple ? 'sí' : 'no', detalle: r.detalle };
    }),
  );
  console.log(`\nCapturas, HTML y respuestas JSON guardados en ${carpeta} (contienen tus notas: borralos cuando termines).`);
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  console.error(`Revisá las capturas en ${carpeta} para ver en qué paso se trabó.`);
  process.exitCode = 1;
}

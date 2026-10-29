// Fuente simulada de "Notas finales" para la demo. Imita cómo podría verse insweb
// (nombres en mayúsculas, números romanos) para ejercitar la normalización.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { ErrorVerificacion } from './index.js';

const archivo = path.join(config.raiz, 'data', 'insweb-simulado.json');

export async function obtenerNotasFinales({ usuario, password }) {
  const alumnos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const alumno = alumnos[String(usuario).trim()];
  await new Promise((r) => setTimeout(r, 800)); // simula la demora del login real
  if (!alumno || alumno.password !== password) {
    throw new ErrorVerificacion('Usuario o contraseña de insweb incorrectos.', 'credenciales');
  }
  return alumno.notasFinales;
}

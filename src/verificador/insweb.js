// Lectura real de "Notas finales" desde insweb.ing.una.py.
//
// insweb es una aplicación de una sola página: el HTML que entrega el servidor no trae
// ni el formulario ni las notas, los dibuja JavaScript. Por eso usamos Playwright
// (un Chromium sin ventana) que hace lo mismo que el alumno:
//
//   1. abre /login, completa usuario y contraseña, envía
//   2. abre /main/NotasFinales
//   3. lee las notas por DOS vías y se queda con la más completa:
//      a) la respuesta JSON que la página descarga para dibujar la tabla (no depende del HTML)
//      b) la tabla visible en pantalla (recorriendo la paginación si existe)
//
// Las credenciales solo viven dentro de esta función; no se guardan ni se loguean.
// Para ver qué pasa paso a paso con una cuenta real: `npm run probar-insweb`.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { ErrorVerificacion } from './index.js';

async function cargarPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    throw new ErrorVerificacion(
      'Playwright no está instalado. Ejecutá "npm install" en la carpeta del proyecto.',
      'no_disponible',
    );
  }
}

/**
 * Opciones para lanzar Chromium. En Vercel (sin navegador instalado) se usa @sparticuz/chromium,
 * un Chromium comprimido hecho para funciones serverless; en local, el que baja Playwright
 * (o el Chrome/Edge indicado con INSWEB_CANAL / INSWEB_CHROMIUM).
 */
async function opcionesLanzamiento(debug) {
  if (config.esVercel) {
    const { default: sparticuz } = await import('@sparticuz/chromium');
    return { headless: true, args: sparticuz.args, executablePath: await sparticuz.executablePath() };
  }
  return {
    headless: !debug,
    slowMo: debug ? 150 : 0,
    channel: config.insweb.canal,
    executablePath: config.insweb.ejecutable,
  };
}

/** Verifica al arrancar que Chromium esté descargado, para avisar antes de la demo. */
export async function navegadorDisponible() {
  try {
    if (config.esVercel) return true; // Chromium viene con @sparticuz/chromium
    if (config.insweb.canal) return true; // usa el Chrome/Edge instalado
    if (config.insweb.ejecutable) return fs.existsSync(config.insweb.ejecutable);
    const { chromium } = await import('playwright-core');
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const SEL_FILAS_CON_DATOS = 'table tbody tr td, [role="row"] [role="cell"], [role="row"] [role="gridcell"], mat-row mat-cell';
const SEL_SIGUIENTE = [
  '.p-paginator-next',
  '.mat-mdc-paginator-navigation-next',
  '.mat-paginator-navigation-next',
  'button[aria-label*="siguiente" i]',
  'button[aria-label*="next" i]',
  'a[aria-label*="siguiente" i]',
  'a[aria-label*="next" i]',
  '.pagination .next a',
  '.page-item.next a',
  'li.next a',
].join(', ');

/**
 * @param {{usuario: string, password: string}} credenciales
 * @param {{debug?: boolean, carpetaDebug?: string}} opciones
 * @returns {Promise<Array<{materia: string, nota: number|null}>>}
 */
export async function obtenerNotasFinales({ usuario, password }, opciones = {}) {
  const { chromium } = await cargarPlaywright();
  const { url, timeoutMs, rutaLogin, rutaNotasFinales, apiNotasFinales, textoMenuNotas, textoNotasFinales } = config.insweb;
  const debug = Boolean(opciones.debug);
  const carpeta = opciones.carpetaDebug;
  const log = (...a) => debug && console.log('  ·', ...a);
  let paso = 0;

  const browser = await opcionesLanzamiento(debug)
    .then((o) => chromium.launch(o))
    .catch((e) => {
    throw new ErrorVerificacion(
      `No se pudo abrir Chromium (${e.message.split('\n')[0]}). Ejecutá "npm run instalar-navegador".`,
      'no_disponible',
    );
  });

  const captura = async (page, nombre) => {
    if (!debug || !carpeta) return;
    paso += 1;
    await page.screenshot({ path: path.join(carpeta, `${String(paso).padStart(2, '0')}-${nombre}.png`), fullPage: true }).catch(() => {});
  };

  try {
    const context = await browser.newContext({ locale: 'es-PY', viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    // Guardamos toda respuesta JSON: la tabla de notas casi siempre llega así.
    const respuestasJson = [];
    page.on('response', async (r) => {
      if (!(r.headers()['content-type'] || '').includes('json')) return;
      try {
        respuestasJson.push({ url: r.url(), datos: await r.json() });
      } catch {
        /* cuerpo vacío o no JSON */
      }
    });

    // ── 1) Login ──
    await iniciarSesion(page, { url, rutaLogin, usuario, password, log, captura });
    await captura(page, 'inicio');

    // ── 2) Notas finales ──
    // Esperamos ESPECÍFICAMENTE la respuesta de /insweb-backend/notas_finales. No sirve
    // "cualquier tabla con filas": tras el login insweb muestra /main/inscripciones, que tiene
    // su propia tabla, y leerla daría las materias inscriptas en vez de las notas finales.
    const esApiNotas = (r) => r.url().includes(apiNotasFinales) && r.request().method() === 'GET';
    const esperarApi = (ms) =>
      page
        .waitForResponse((r) => esApiNotas(r) && r.ok(), { timeout: ms })
        .then((r) => r.json())
        .catch(() => null);
    const enNotasFinales = () => new URL(page.url()).pathname.toLowerCase().startsWith(rutaNotasFinales.toLowerCase());

    // a) Navegación interna de la SPA (sin recargar: conserva la sesión aunque viva en memoria)
    log(`navegando dentro de la app a ${rutaNotasFinales}`);
    let pendiente = esperarApi(15000);
    await page.evaluate((ruta) => {
      history.pushState({}, '', ruta);
      dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    }, rutaNotasFinales);
    let datosApi = await pendiente;

    // b) Carga directa de la URL
    if (!datosApi) {
      log(`sin respuesta de ${apiNotasFinales}; abriendo ${url}${rutaNotasFinales}`);
      pendiente = esperarApi(20000);
      await page.goto(`${url}${rutaNotasFinales}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      if (page.url().toLowerCase().includes('login')) {
        // c) La sesión no sobrevivió a la recarga: volver a entrar y usar el menú
        log('la recarga volvió al login; reingresando y usando el menú');
        await iniciarSesion(page, { url, rutaLogin, usuario, password, log, captura });
        pendiente = esperarApi(20000);
        await clickPorTexto(page, textoMenuNotas, true).catch(() => {});
        await clickPorTexto(page, textoNotasFinales, false).catch(() => {});
      }
      datosApi = await pendiente;
    }
    await page.waitForLoadState('networkidle').catch(() => {});
    await captura(page, 'notas-finales');

    // ── 3) Leer ──
    const delJson = datosApi ? extraerDeJson([{ url: apiNotasFinales, datos: datosApi }]) : [];
    let delDom = [];
    if (!delJson.length && enNotasFinales()) {
      // Respaldo: tabla visible, SOLO si estamos efectivamente en la pantalla de Notas finales.
      await esperarFilas(page, 8000);
      delDom = await leerTodasLasPaginas(page, log);
    }
    log(`página actual: ${page.url()}`);
    log(`del JSON (${apiNotasFinales}): ${delJson.length} filas · de la tabla: ${delDom.length} filas`);

    if (debug && carpeta) {
      fs.writeFileSync(path.join(carpeta, 'notas-finales.html'), await page.content());
      fs.writeFileSync(
        path.join(carpeta, 'respuestas-json.json'),
        JSON.stringify(respuestasJson.filter((r) => r.url.includes('nota')), null, 2),
      );
    }

    const notas = delJson.length ? delJson : delDom;
    // Si ninguna fila trae nota numérica, lo leído no es la lista de notas finales: mejor fallar
    // que rechazar al alumno diciendo que la materia "no figura".
    if (!notas.some((n) => Number.isInteger(n.nota))) {
      throw new ErrorVerificacion(
        'No se pudieron leer las Notas finales de insweb (no llegó la respuesta de notas). Probá de nuevo.',
        'sin_tabla',
      );
    }
    return notas;
  } catch (e) {
    if (e instanceof ErrorVerificacion) throw e;
    if (e.name === 'TimeoutError') {
      throw new ErrorVerificacion('insweb tardó demasiado en responder. Probá de nuevo en unos minutos.', 'timeout');
    }
    throw new ErrorVerificacion(`Error leyendo insweb: ${e.message.split('\n')[0]}`, 'error');
  } finally {
    await browser.close();
  }
}

// ───────────────────────── ayudas de navegación ─────────────────────────

async function iniciarSesion(page, { url, rutaLogin, usuario, password, log, captura }) {
  log(`abriendo ${url}${rutaLogin}`);
  await page.goto(`${url}${rutaLogin}`, { waitUntil: 'domcontentloaded' });
  const campoPass = page.locator('input[type="password"]:visible').first();
  await campoPass.waitFor({ state: 'visible' });
  if (await hayCaptcha(page)) {
    throw new ErrorVerificacion('insweb pide un captcha: la verificación automática no es posible.', 'no_disponible');
  }
  const campoUsuario = page
    .locator('input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):visible')
    .first();
  await campoUsuario.fill(String(usuario));
  await campoPass.fill(String(password));
  await captura(page, 'login-completado'); // la contraseña se ve como puntos
  const botonEnviar = page
    .locator('button[type="submit"]:visible, input[type="submit"]:visible, button:visible:has-text("Ingresar"), button:visible:has-text("Iniciar"), button:visible:has-text("Entrar"), button:visible:has-text("Acceder")')
    .first();
  if (await botonEnviar.count()) await botonEnviar.click();
  else await campoPass.press('Enter');

  const entro = await Promise.race([
    page.waitForURL((u) => !u.pathname.toLowerCase().includes('login'), { timeout: 15000 }).then(() => true),
    page.waitForFunction(() => !document.querySelector('input[type="password"]'), null, { timeout: 15000 }).then(() => true),
  ]).catch(() => false);
  if (!entro) {
    await captura(page, 'login-fallido');
    const msg = await mensajeDeError(page);
    throw new ErrorVerificacion(
      msg ? `insweb respondió: "${msg}"` : 'insweb rechazó el usuario o la contraseña.',
      'credenciales',
    );
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  log('sesión iniciada:', page.url());
}

async function hayCaptcha(page) {
  return (await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha, [data-sitekey]').count()) > 0;
}

async function mensajeDeError(page) {
  const sel = '[role="alert"], .alert, .error, mat-error, .mat-mdc-snack-bar-label, .toast-message, .p-toast-detail, .swal2-html-container, .invalid-feedback';
  const textos = await page.locator(sel).allInnerTexts().catch(() => []);
  return textos.map((t) => t.trim()).find(Boolean)?.slice(0, 160) ?? '';
}

async function esperarFilas(page, ms) {
  return page.waitForSelector(SEL_FILAS_CON_DATOS, { timeout: ms }).then(() => true).catch(() => false);
}

async function clickPorTexto(page, texto, exacto) {
  const candidatos = [
    page.getByRole('link', { name: texto, exact: exacto }),
    page.getByRole('menuitem', { name: texto, exact: exacto }),
    page.getByRole('button', { name: texto, exact: exacto }),
    page.getByText(texto, { exact: exacto }),
  ];
  for (const loc of candidatos) {
    const el = loc.first();
    if (await el.isVisible().catch(() => false)) {
      await el.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      return;
    }
  }
  throw new Error(`No se encontró "${texto}" en el menú`);
}

async function leerTodasLasPaginas(page, log) {
  const todas = [];
  let firmaAnterior = '';
  for (let pagina = 1; pagina <= 30; pagina++) {
    const filas = await page.evaluate(leerTablaEnPagina);
    const firma = JSON.stringify(filas);
    if (firma === firmaAnterior) break; // el "siguiente" no cambió nada
    firmaAnterior = firma;
    todas.push(...filas);

    const sig = page.locator(SEL_SIGUIENTE).first();
    if (!(await sig.count())) break;
    const habilitado = await sig
      .evaluate((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !/disabled/.test(el.className + ' ' + (el.parentElement?.className ?? '')))
      .catch(() => false);
    if (!habilitado) break;
    log(`tabla paginada: pasando a la página ${pagina + 1}`);
    await sig.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(300);
  }
  return todas;
}

// ───────────────────────── lectura de datos ─────────────────────────

const PALABRAS_NOTA = { cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };

/** "4", "4 (cuatro)", "Cuatro", 4, "4.0" -> 4 ; "Ausente", "" -> null */
export function leerNota(valor) {
  if (typeof valor === 'number') return Number.isInteger(valor) && valor >= 0 && valor <= 5 ? valor : null;
  const s = String(valor ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const m = s.match(/(?:^|[^\d])([0-5])(?:[.,]0+)?(?![\d])/);
  if (m) return Number(m[1]);
  const w = s.match(/\b(cero|uno|dos|tres|cuatro|cinco)\b/);
  return w ? PALABRAS_NOTA[w[1]] : null;
}

// insweb usa { descrip: "CALCULO 1", codnota: "4  ", codasign: "23012", tipo: "NOTAS FINALES", ... }
const RE_CLAVE_MATERIA = /descrip|asign|materia|curso|disciplina/i;
const RE_CLAVE_NOTA = /nota|calif/i;
const RE_CLAVE_NO_NOTA = /fecha|parcial|acta|^id|id$|periodo|oportunidad/i;

function textoDeMateria(v) {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') {
    for (const k of ['nombre', 'descripcion', 'denominacion', 'nombreAsignatura', 'nombreMateria', 'name']) {
      if (typeof v[k] === 'string') return v[k].trim();
    }
  }
  return '';
}

/**
 * Busca, en cualquier JSON recibido, el arreglo de objetos que mejor parece una lista
 * de notas: cada objeto con un campo tipo "asignatura/materia" y otro tipo "nota".
 */
export function extraerDeJson(respuestas) {
  let mejor = [];
  const visitar = (nodo, prof = 0) => {
    if (!nodo || prof > 8) return;
    if (Array.isArray(nodo)) {
      const filas = nodo.map(filaDeObjeto).filter(Boolean);
      if (filas.length > mejor.length) mejor = filas;
      nodo.forEach((n) => visitar(n, prof + 1));
    } else if (typeof nodo === 'object') {
      Object.values(nodo).forEach((n) => visitar(n, prof + 1));
    }
  };
  for (const r of respuestas) visitar(r.datos);
  return mejor;
}

function filaDeObjeto(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  // Si el registro dice de qué tipo es, solo cuentan las notas finales.
  if (typeof obj.tipo === 'string' && /nota/i.test(obj.tipo) && !/final/i.test(obj.tipo)) return null;
  const claves = Object.keys(obj);
  // La materia es el campo de texto con letras ("codasign" es numérico y se descarta solo).
  const kMat = claves.find((k) => RE_CLAVE_MATERIA.test(k) && /[a-zA-Z]{3,}/.test(textoDeMateria(obj[k])));
  const candidatasNota = claves.filter((k) => RE_CLAVE_NOTA.test(k) && !RE_CLAVE_NO_NOTA.test(k));
  const kNota =
    candidatasNota.find((k) => /final/i.test(k)) ??
    candidatasNota.find((k) => /^(cod)?nota$/i.test(k)) ??
    candidatasNota[0];
  if (!kMat || !kNota) return null;
  return { materia: textoDeMateria(obj[kMat]), nota: leerNota(obj[kNota]) };
}

// Se ejecuta DENTRO del navegador. Devuelve [{ materia, nota }].
// Soporta varias tablas en la página (p. ej. una por semestre), cada una con su encabezado.
export function leerTablaEnPagina() {
  const SEL_CELDAS = 'th, td, [role="cell"], [role="gridcell"], [role="columnheader"], mat-cell, mat-header-cell';
  const filas = [...document.querySelectorAll('tr, [role="row"], mat-row, mat-header-row')]
    .map((f) => [...f.querySelectorAll(SEL_CELDAS)].map((c) => c.innerText.replace(/\s+/g, ' ').trim()))
    .filter((celdas) => celdas.length >= 2);

  const sinTilde = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const PAL = { cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };
  const leerNota = (v) => {
    const s = sinTilde(String(v ?? ''));
    const m = s.match(/(?:^|[^\d])([0-5])(?:[.,]0+)?(?![\d])/);
    if (m) return Number(m[1]);
    const w = s.match(/\b(cero|uno|dos|tres|cuatro|cinco)\b/);
    return w ? PAL[w[1]] : null;
  };
  const esEncabezado = (f) => {
    const t = f.map(sinTilde);
    return t.some((c) => /asignatura|materia|curso|descrip/.test(c)) && t.some((c) => /nota|calif/.test(c));
  };

  const resultado = [];
  let iMat = -1;
  let iNota = -1;
  for (const f of filas) {
    if (esEncabezado(f)) {
      const enc = f.map(sinTilde);
      iMat = enc.findIndex((c) => /asignatura|materia|curso|descrip/.test(c));
      iNota = enc.findIndex((c) => /(nota|calif).*final/.test(c));
      if (iNota < 0) iNota = enc.findIndex((c) => /^final$/.test(c));
      if (iNota < 0) iNota = enc.findIndex((c) => /nota|calif/.test(c) && !/fecha|parcial|acta/.test(c));
      continue;
    }
    if (iMat >= 0 && iNota >= 0 && f.length > Math.max(iMat, iNota)) {
      if (/[a-zA-Z]{3,}/.test(f[iMat])) resultado.push({ materia: f[iMat], nota: leerNota(f[iNota]) });
    }
  }
  if (resultado.length) return resultado;

  // Respaldo sin encabezado: materia = celda con más letras; nota = última celda que sea solo 0–5.
  for (const f of filas) {
    const materia = [...f].sort((a, b) => b.replace(/[^a-zA-Z]/g, '').length - a.replace(/[^a-zA-Z]/g, '').length)[0];
    const celdaNota = [...f].reverse().find((c) => /^[0-5]$/.test(c));
    if (materia && /[a-zA-Z]{4,}/.test(materia) && celdaNota) resultado.push({ materia, nota: Number(celdaNota) });
  }
  return resultado;
}

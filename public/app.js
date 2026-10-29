// Frontend sin build: rutas por hash (#/, #/subir, #/tutorias, #/ser-tutor, #/entrar)

const $vista = document.getElementById('vista');
const estado = { yo: null, meta: null, materias: [] };

// ───────── utilidades ─────────
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(ruta, opciones = {}) {
  const init = { credentials: 'same-origin', ...opciones };
  if (opciones.json !== undefined) {
    init.method ??= 'POST';
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opciones.json);
  }
  const r = await fetch(ruta, init);
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(datos.error || `Error ${r.status}`), { status: r.status });
  return datos;
}

function aviso(texto) {
  const el = document.getElementById('aviso');
  el.textContent = texto;
  el.classList.add('ver');
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => el.classList.remove('ver'), 2800);
}

const TIPO_TXT = { apunte: 'Apunte', examen: 'Examen', resumen: 'Resumen', practica: 'Práctica' };
const CARRERA_CORTA = { civil: 'Civil', electromecanica: 'Electromecánica' };
const kb = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const iniciales = (n) => n.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
const fecha = (iso) => new Date(iso).toLocaleDateString('es-PY', { day: 'numeric', month: 'short', year: 'numeric' });

function opcionesMaterias(seleccionada = '', carrera = '') {
  let html = '';
  let sem = 0;
  for (const m of estado.materias) {
    if (carrera && !m.carreras.includes(carrera)) continue;
    if (m.semestre !== sem) {
      if (sem) html += '</optgroup>';
      sem = m.semestre;
      html += `<optgroup label="${sem}° semestre">`;
    }
    html += `<option value="${m.id}" ${String(m.id) === String(seleccionada) ? 'selected' : ''}>${esc(m.nombre)}</option>`;
  }
  return html + (sem ? '</optgroup>' : '');
}

function porSemestre(lista) {
  const grupos = new Map();
  for (const m of lista) {
    if (!grupos.has(m.semestre)) grupos.set(m.semestre, []);
    grupos.get(m.semestre).push(m);
  }
  return grupos;
}

function pedirLogin(mensaje) {
  return `<div class="panel angosto"><p>${esc(mensaje)}</p>
    <a class="btn primario" href="#/entrar?volver=${encodeURIComponent(location.hash.slice(1) || '/')}">Iniciar sesión</a></div>`;
}

// ───────── sesión en la barra ─────────
function pintarSesion() {
  const el = document.getElementById('sesion');
  if (estado.yo) {
    el.innerHTML = `<span>${esc(estado.yo.nombre.split(' ')[0])} · ${CARRERA_CORTA[estado.yo.carrera]}</span>
      <button class="btn chico" id="salir">Salir</button>`;
    el.querySelector('#salir').onclick = async () => {
      await api('/api/logout', { method: 'POST' });
      estado.yo = null;
      pintarSesion();
      router();
    };
  } else {
    el.innerHTML = `<a class="btn chico primario" href="#/entrar">Entrar</a>`;
  }
}

// ───────── Vista: Apuntes (buscador) ─────────
async function vistaApuntes(params, mios = false) {
  if (mios && !estado.yo) {
    $vista.innerHTML = `<div class="cabecera"><h1>Mis apuntes</h1></div>` + pedirLogin('Iniciá sesión para ver tus apuntes.');
    return;
  }
  const base = mios ? '#/mis-apuntes' : '#/';
  const f = {
    q: params.get('q') ?? '',
    materia: params.get('materia') ?? '',
    tipo: params.get('tipo') ?? '',
    anio: params.get('anio') ?? '',
    carrera: params.get('carrera') ?? '',
    orden: params.get('orden') ?? 'votos',
  };
  const anioActual = new Date().getFullYear();
  $vista.innerHTML = `
    <div class="cabecera">
      ${mios
        ? `<div class="etiqueta-seccion">Tu material</div><h1>Mis apuntes</h1><p>Lo que subiste. Podés editarlo, reemplazar el archivo o borrarlo.</p>`
        : `<div class="etiqueta-seccion">Repositorio</div><h1>Apuntes y exámenes anteriores</h1>
           <p>Todo lo que hoy se pierde en los grupos de WhatsApp, ordenado por materia.</p>`}
    </div>
    <form class="buscador" id="fbusca">
      <input id="q" type="search" placeholder="Buscá: calculo final 2025, integrales dobles, armaduras…" value="${esc(f.q)}" autocomplete="off" />
      <button class="btn primario">Buscar</button>
    </form>
    <div class="filtros">
      <select id="carrera"><option value="">Todas las carreras</option>
        ${Object.entries(estado.meta.carreras).map(([k, v]) => `<option value="${k}" ${f.carrera === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      <select id="materia"><option value="">Todas las materias</option>${opcionesMaterias(f.materia, f.carrera)}</select>
      <select id="tipo"><option value="">Todo tipo</option>
        ${estado.meta.tipos.map((t) => `<option value="${t}" ${f.tipo === t ? 'selected' : ''}>${TIPO_TXT[t]}</option>`).join('')}
      </select>
      <select id="anio"><option value="">Cualquier año</option>
        ${Array.from({ length: 8 }, (_, i) => anioActual - i).map((a) => `<option ${String(a) === f.anio ? 'selected' : ''}>${a}</option>`).join('')}
      </select>
      <select id="orden">
        <option value="votos" ${f.orden === 'votos' ? 'selected' : ''}>Más gustados</option>
        <option value="recientes" ${f.orden === 'recientes' ? 'selected' : ''}>Más recientes</option>
      </select>
    </div>
    <div class="resumen-resultados" id="resumen"></div>
    <div class="lista" id="resultados"></div>`;

  const ir = () => {
    const p = new URLSearchParams();
    const v = (id) => document.getElementById(id).value;
    for (const k of ['q', 'carrera', 'materia', 'tipo', 'anio', 'orden']) if (v(k) && !(k === 'orden' && v(k) === 'votos')) p.set(k, v(k));
    const destino = `${base}${p.toString() ? '?' + p : ''}`;
    if (location.hash === destino) buscar(); else location.hash = destino;
  };
  document.getElementById('fbusca').onsubmit = (e) => { e.preventDefault(); ir(); };
  for (const id of ['carrera', 'materia', 'tipo', 'anio', 'orden']) document.getElementById(id).onchange = ir;

  async function buscar() {
    const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    if (mios) p.set('mios', '1');
    const lista = await api(`/api/apuntes?${p}`);
    const materia = estado.materias.find((m) => String(m.id) === f.materia);
    document.getElementById('resumen').textContent =
      `${lista.length} resultado${lista.length === 1 ? '' : 's'}${f.q ? ` para “${f.q}”` : ''}${materia ? ` en ${materia.nombre}` : ''}`;
    const cont = document.getElementById('resultados');
    if (!lista.length) {
      cont.innerHTML = `<div class="panel vacio">${mios ? 'Todavía no subiste nada' : 'No hay nada todavía con esos filtros'}.<br><br>
        <a class="btn primario" href="#/subir">${mios ? 'Subir material' : 'Subí el primero'}</a></div>`;
      return;
    }
    cont.innerHTML = lista.map(tarjetaApunte).join('');
    cont.querySelectorAll('[data-like]').forEach((b) => (b.onclick = () => darLike(b)));
    cont.querySelectorAll('[data-borrar]').forEach((b) => (b.onclick = () => borrarApunte(b, buscar)));
  }
  await buscar();
}

function tarjetaApunte(a) {
  const tutores = estado.materias.find((m) => m.id === a.materia_id)?.tutores ?? 0;
  return `<article class="panel apunte" data-id="${a.id}">
    <div class="votos">
      <button data-like class="corazon ${a.me_gusta ? 'activo' : ''}" aria-pressed="${a.me_gusta}"
        title="${a.me_gusta ? 'Quitar me gusta' : 'Me gusta'}" aria-label="Me gusta">${a.me_gusta ? '♥' : '♡'}</button>
      <span class="puntaje">${a.likes}</span>
    </div>
    <div>
      <h3>${esc(a.titulo)}</h3>
      ${a.descripcion ? `<p class="desc">${esc(a.descripcion)}</p>` : ''}
      <div class="meta">
        <span class="chip ${a.tipo}">${TIPO_TXT[a.tipo]}${a.periodo ? ' · ' + esc(a.periodo) : ''}</span>
        <a class="chip" href="#/?materia=${a.materia_id}">${esc(a.materia)}</a>
        ${a.anio ? `<span class="chip">${a.anio}</span>` : ''}
        <span>por ${a.es_mio ? '<strong>vos</strong>' : esc(a.autor)} · ${fecha(a.creado)} · ${kb(a.tamano)}</span>
        ${tutores ? `<a href="#/tutorias?materia=${a.materia_id}">${tutores} tutor${tutores > 1 ? 'es' : ''} disponible${tutores > 1 ? 's' : ''} →</a>` : ''}
      </div>
    </div>
    <div class="acciones">
      <a class="btn chico" href="/api/apuntes/${a.id}/archivo" target="_blank" rel="noopener">Ver</a>
      <a class="btn chico" href="/api/apuntes/${a.id}/archivo?descargar=1">Descargar</a>
      ${a.es_mio ? `<a class="btn chico" href="#/subir?editar=${a.id}">Editar</a>
        <button class="btn chico peligro" data-borrar="${a.id}">Borrar</button>` : ''}
    </div>
  </article>`;
}

async function darLike(boton) {
  if (!estado.yo) return aviso('Iniciá sesión para dar me gusta.');
  const tarjeta = boton.closest('.apunte');
  const quiere = !boton.classList.contains('activo');
  try {
    const r = await api(`/api/apuntes/${tarjeta.dataset.id}/like`, { json: { me_gusta: quiere } });
    tarjeta.querySelector('.puntaje').textContent = r.likes;
    boton.classList.toggle('activo', r.me_gusta);
    boton.textContent = r.me_gusta ? '♥' : '♡';
    boton.setAttribute('aria-pressed', r.me_gusta);
  } catch (e) {
    aviso(e.message);
  }
}

async function borrarApunte(boton, recargar) {
  const titulo = boton.closest('.apunte').querySelector('h3').textContent;
  if (!confirm(`¿Borrar "${titulo}"? No se puede deshacer.`)) return;
  try {
    await api(`/api/apuntes/${boton.dataset.borrar}`, { method: 'DELETE' });
    await cargarMaterias();
    aviso('Apunte borrado.');
    recargar();
  } catch (e) {
    aviso(e.message);
  }
}

// ───────── Vista: Subir / Editar ─────────
async function vistaSubir(params) {
  const idEditar = params.get('editar');
  const cab = idEditar
    ? `<div class="cabecera"><div class="etiqueta-seccion">Tu material</div><h1>Editar apunte</h1>
        <p>Cambiá los datos o reemplazá el archivo. Los me gusta se conservan.</p></div>`
    : `<div class="cabecera"><div class="etiqueta-seccion">Compartir</div><h1>Subir material</h1>
        <p>PDF o foto. Etiquetalo bien para que otros lo encuentren.</p></div>`;
  if (!estado.yo) return ($vista.innerHTML = cab + pedirLogin('Para subir material necesitás una cuenta.'));

  const anioActual = new Date().getFullYear();
  const a = idEditar
    ? await api(`/api/apuntes/${idEditar}`)
    : { materia_id: '', tipo: 'apunte', titulo: '', descripcion: '', anio: anioActual, periodo: '' };
  const materia = estado.materias.find((m) => m.id === a.materia_id);
  const carreraFiltro = !materia || materia.carreras.includes(estado.yo.carrera) ? estado.yo.carrera : '';

  $vista.innerHTML = `${cab}
    <form class="panel angosto" id="fsubir">
      <div class="campo"><label for="archivo">${idEditar ? 'Archivo' : 'Archivo'}</label>
        ${idEditar ? `<div class="archivo-actual">📄 ${esc(a.archivo_nombre)} · ${kb(a.tamano)}
            <a href="/api/apuntes/${a.id}/archivo" target="_blank" rel="noopener">ver</a></div>` : ''}
        <input id="archivo" name="archivo" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" ${idEditar ? '' : 'required'} />
        <div class="ayuda">${idEditar ? 'Elegí un archivo solo si querés reemplazar el actual. ' : ''}PDF, JPG, PNG o WEBP · máximo ${estado.meta.maxMb} MB</div></div>
      <div class="campo"><label for="materia_id">Materia</label>
        <select id="materia_id" name="materia_id" required><option value="">Elegí la materia…</option>${opcionesMaterias(a.materia_id, carreraFiltro)}</select>
        ${carreraFiltro ? `<div class="ayuda">Se muestran las materias de ${esc(estado.meta.carreras[estado.yo.carrera])}.</div>` : ''}</div>
      <div class="fila">
        <div class="campo"><label for="tipo">Tipo</label>
          <select id="tipo" name="tipo" required>${estado.meta.tipos.map((t) => `<option value="${t}" ${a.tipo === t ? 'selected' : ''}>${TIPO_TXT[t]}</option>`).join('')}</select></div>
        <div class="campo"><label for="anio">Año</label>
          <input id="anio" name="anio" type="number" min="1990" max="${anioActual}" value="${esc(a.anio ?? '')}" /></div>
      </div>
      <div class="campo" id="campo-periodo" hidden><label for="periodo">Período del examen</label>
        <select id="periodo" name="periodo"><option value="">—</option>${estado.meta.periodos.map((p) => `<option ${a.periodo === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="campo"><label for="titulo">Título</label>
        <input id="titulo" name="titulo" maxlength="150" required placeholder="Ej.: Final de Cálculo 2 — julio" value="${esc(a.titulo)}" /></div>
      <div class="campo"><label for="descripcion">Descripción <span class="ayuda">(opcional)</span></label>
        <textarea id="descripcion" name="descripcion" maxlength="1000" placeholder="¿Qué temas cubre? ¿Está resuelto?">${esc(a.descripcion)}</textarea></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primario" id="btn-subir">${idEditar ? 'Guardar cambios' : 'Subir'}</button>
        ${idEditar ? `<a class="btn" href="#/mis-apuntes">Cancelar</a>
          <button type="button" class="btn peligro" id="btn-borrar" style="margin-left:auto">Borrar apunte</button>` : ''}
      </div>
      <div class="error" id="err"></div>
    </form>`;
  const tipo = document.getElementById('tipo');
  const sync = () => (document.getElementById('campo-periodo').hidden = tipo.value !== 'examen');
  tipo.onchange = sync;
  sync();

  document.getElementById('btn-borrar')?.addEventListener('click', async () => {
    if (!confirm(`¿Borrar "${a.titulo}"? No se puede deshacer.`)) return;
    try {
      await api(`/api/apuntes/${a.id}`, { method: 'DELETE' });
      await cargarMaterias();
      aviso('Apunte borrado.');
      location.hash = '#/mis-apuntes';
    } catch (err) {
      document.getElementById('err').textContent = err.message;
    }
  });

  document.getElementById('fsubir').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-subir');
    const texto = btn.textContent;
    btn.disabled = true;
    btn.textContent = idEditar ? 'Guardando…' : 'Subiendo…';
    const f = e.target;
    const campos = Object.fromEntries(
      ['materia_id', 'tipo', 'titulo', 'descripcion', 'anio', 'periodo'].filter((k) => f[k]).map((k) => [k, f[k].value]),
    );
    try {
      // El archivo va directo a Supabase Storage con una URL firmada (no pasa por el servidor).
      const archivo = f.archivo.files[0];
      if (archivo) {
        const firma = await api('/api/apuntes/subida', { json: { mime: archivo.type, tamano: archivo.size } });
        const r = await fetch(firma.url, { method: 'PUT', headers: { 'Content-Type': archivo.type }, body: archivo });
        if (!r.ok) throw new Error('No se pudo subir el archivo. Probá de nuevo.');
        campos.archivo = firma.clave;
        campos.archivo_nombre = archivo.name;
      }
      if (idEditar) {
        await api(`/api/apuntes/${idEditar}`, { method: 'PUT', json: campos });
        aviso('Cambios guardados.');
        location.hash = '#/mis-apuntes';
      } else {
        await api('/api/apuntes', { json: campos });
        aviso('¡Listo! Gracias por compartir.');
        location.hash = `#/?materia=${campos.materia_id}&orden=recientes`;
      }
      await cargarMaterias();
    } catch (err) {
      document.getElementById('err').textContent = err.message;
      btn.disabled = false;
      btn.textContent = texto;
    }
  };
}

// ───────── Vista: Tutorías ─────────
function botonesContacto(nombre, materia, email, whatsapp) {
  const msg = encodeURIComponent(`Hola ${nombre.split(' ')[0]}, te escribo por la tutoría de ${materia} (apuntes.fiuna).`);
  return (
    (whatsapp ? `<a class="btn chico verde" target="_blank" rel="noopener" href="https://wa.me/${esc(whatsapp)}?text=${msg}">WhatsApp</a> ` : '') +
    `<a class="btn chico" href="mailto:${esc(email)}?subject=${encodeURIComponent('Tutoría de ' + materia)}&body=${msg}">Email</a>`
  );
}

function textoCupos(libres, max) {
  if (libres <= 0) return `<span class="chip no">Sin cupos (${max}/${max})</span>`;
  return `<span class="chip ${libres <= 1 ? 'pend' : 'ok'}">${libres} de ${max} cupo${max > 1 ? 's' : ''} libre${libres > 1 ? 's' : ''}</span>`;
}

async function vistaTutorias(params) {
  const materiaSel = params.get('materia');
  const carrera = estado.yo?.carrera ?? '';
  const lista = estado.materias.filter((m) => !carrera || m.carreras.includes(carrera));
  let grilla = '';
  for (const [sem, ms] of porSemestre(lista)) {
    grilla += `<div class="semestre-titulo">${sem}° semestre</div><div class="materias">${ms
      .map((m) => `<a class="materia ${String(m.id) === materiaSel ? 'sel' : ''}" href="#/tutorias?materia=${m.id}" style="text-decoration:none;color:inherit">
          <span>${esc(m.nombre)}</span><span class="cuenta">${m.tutores ? `${m.tutores} tutor${m.tutores > 1 ? 'es' : ''}` : '—'}</span></a>`)
      .join('')}</div>`;
  }
  const mias = estado.yo ? await api('/api/tutorias') : null;

  $vista.innerHTML = `
    <div class="cabecera"><div class="etiqueta-seccion">Matching</div><h1>Tutorías</h1>
      <p>Estudiantes que aprobaron la materia con 4 o 5 —verificado en insweb— y se ofrecieron a ayudar.
      Cada tutor acompaña como máximo a ${estado.meta.cupoTutor} alumnos a la vez.</p></div>
    ${mias?.como_alumno.length ? `
    <div class="panel" style="margin-bottom:16px"><strong>Mis tutorías en curso</strong>
      ${mias.como_alumno.map((t) => `
        <div class="resultado"><div><div><strong>${esc(t.tutor)}</strong> · ${esc(t.materia)}</div>
          <div class="ayuda">Desde ${fecha(t.creado)}</div></div>
          <div class="botones">${botonesContacto(t.tutor, t.materia, t.email, t.whatsapp)}
            <button class="btn chico" data-cerrar="${t.id}">Dejar la tutoría</button></div></div>`).join('')}
    </div>` : ''}
    <div id="tutores"></div>
    <div class="panel"><strong>¿En qué materia necesitás ayuda?</strong>
      ${carrera ? `<div class="ayuda">Materias de ${esc(estado.meta.carreras[carrera])}</div>` : ''}${grilla}</div>`;
  enlazarCierreTutorias(() => vistaTutorias(params));

  if (!materiaSel) return;
  const materia = estado.materias.find((m) => String(m.id) === materiaSel);
  const nombreMateria = materia?.nombre ?? '';
  const { tutores, logueado, cupo_max } = await api(`/api/tutores?materia=${materiaSel}`);
  const cont = document.getElementById('tutores');
  const titulo = `<h2 style="margin:0 0 12px;font-size:19px">${esc(nombreMateria)}</h2>`;
  if (!tutores.length) {
    cont.innerHTML = `<div class="panel" style="margin-bottom:16px">${titulo}
      <p class="ayuda">Todavía no hay tutores verificados para esta materia.</p>
      <a href="#/?materia=${materiaSel}">Ver apuntes de ${esc(nombreMateria)} →</a> &nbsp;·&nbsp;
      <a href="#/ser-tutor">¿La aprobaste con 4 o 5? Ofrecete como tutor →</a></div>`;
    return;
  }
  cont.innerHTML = `<div style="margin-bottom:16px">${titulo}<div class="lista">${tutores
    .map((t) => {
      let accion;
      if (t.es_yo) accion = `<span class="chip">Sos vos</span>`;
      else if (t.mi_tutoria) accion = botonesContacto(t.nombre, nombreMateria, t.email, t.whatsapp);
      else if (t.cupos_libres <= 0) accion = '';
      else if (!logueado)
        accion = `<a class="btn chico primario" href="#/entrar?volver=${encodeURIComponent('/tutorias?materia=' + materiaSel)}">Entrá para pedir tutoría</a>`;
      else accion = `<button class="btn chico primario" data-pedir="${t.id}">Pedir tutoría</button>`;
      return `<div class="panel tutor">
        <div class="tutor-info"><div class="avatar">${esc(iniciales(t.nombre))}</div>
          <div><div class="nombre">${esc(t.nombre)}</div>
          <div class="meta"><span class="chip ok">✓ Aprobó con ${t.nota}</span><span>${CARRERA_CORTA[t.carrera]}</span>
            ${t.apuntes_materia ? `<span>· ${t.apuntes_materia} apunte${t.apuntes_materia > 1 ? 's' : ''} de ${esc(nombreMateria)}</span>` : ''}</div></div></div>
        <div class="tutor-acciones">${textoCupos(t.cupos_libres, cupo_max)}
          ${t.mi_tutoria ? '<span class="chip ok">Ya sos su alumno</span>' : ''}
          <div class="botones">${accion}</div></div></div>`;
    })
    .join('')}</div></div>`;

  cont.querySelectorAll('[data-pedir]').forEach((b) => {
    const t = tutores.find((x) => String(x.id) === b.dataset.pedir);
    b.onclick = async () => {
      const libres = t.cupos_libres;
      if (!confirm(`¿Pedir tutoría de ${nombreMateria} a ${t.nombre}?\n\nOcupás 1 de sus ${cupo_max} cupos (quedan ${libres}). Podés dejarla cuando quieras para liberar el lugar.`)) return;
      b.disabled = true;
      try {
        await api('/api/tutorias', { json: { tutor_id: t.id, materia_id: Number(materiaSel) } });
        aviso(`Listo: ya podés contactar a ${t.nombre.split(' ')[0]}.`);
        vistaTutorias(params);
      } catch (e) {
        aviso(e.message);
        vistaTutorias(params);
      }
    };
  });
}

function enlazarCierreTutorias(recargar) {
  $vista.querySelectorAll('[data-cerrar]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm(b.dataset.confirmar || '¿Dejar esta tutoría? Se libera el cupo del tutor.')) return;
      try {
        await api(`/api/tutorias/${b.dataset.cerrar}`, { method: 'PATCH', json: {} });
        aviso('Cupo liberado.');
        recargar();
      } catch (e) {
        aviso(e.message);
      }
    };
  });
}

// ───────── Vista: Ser tutor ─────────
async function vistaSerTutor() {
  const cab = `<div class="cabecera"><div class="etiqueta-seccion">Inscripción voluntaria</div><h1>Ofrecerme como tutor</h1>
    <p>Elegí las materias que querés enseñar. Para cada una se verifica en insweb que tengas un 4 o un 5 en Notas finales.
    Si te aplazaste antes y después aprobaste con 4 o 5, igual cumplís.</p></div>`;
  if (!estado.yo) return ($vista.innerHTML = cab + pedirLogin('Para inscribirte como tutor necesitás una cuenta.'));

  const [posts, mias] = await Promise.all([api('/api/postulaciones'), api('/api/tutorias')]);
  const ocupados = mias.como_tutor.length;
  const porMateria = new Map(posts.map((p) => [p.materia_id, p]));
  const pendientes = posts.filter((p) => p.estado === 'pendiente');
  const disponibles = estado.materias.filter(
    (m) => m.carreras.includes(estado.yo.carrera) && !['verificado', 'pendiente'].includes(porMateria.get(m.id)?.estado),
  );

  let grilla = '';
  for (const [sem, ms] of porSemestre(disponibles)) {
    grilla += `<div class="semestre-titulo">${sem}° semestre</div><div class="materias">${ms
      .map((m) => `<label class="materia"><input type="checkbox" name="materias" value="${m.id}" />${esc(m.nombre)}
        ${porMateria.get(m.id)?.estado === 'rechazado' ? '<span class="chip no" style="margin-left:auto">no cumplió</span>' : ''}</label>`)
      .join('')}</div>`;
  }

  const paso = pendientes.length ? 2 : 1;
  const simulado = estado.meta.verificador === 'simulado';

  $vista.innerHTML = `${cab}
    <div class="pasos"><span class="${paso === 1 ? 'activo' : ''}">1 · Elegir materias</span><span class="${paso === 2 ? 'activo' : ''}">2 · Verificar en insweb</span></div>

    ${posts.some((p) => p.estado === 'verificado') ? `
    <div class="panel" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <strong>Mis alumnos</strong>${textoCupos(mias.cupo_max - ocupados, mias.cupo_max)}</div>
      ${ocupados ? mias.como_tutor.map((t) => `
        <div class="resultado"><div><div><strong>${esc(t.alumno)}</strong> · ${esc(t.materia)}</div>
          <div class="ayuda">${CARRERA_CORTA[t.carrera]} · desde ${fecha(t.creado)}</div></div>
          <div class="botones">${botonesContacto(t.alumno, t.materia, t.email, t.whatsapp)}
            <button class="btn chico" data-cerrar="${t.id}" data-confirmar="¿Dar por terminada la tutoría con ${esc(t.alumno)}? Se libera un cupo.">Terminar</button></div></div>`).join('')
        : `<p class="ayuda" style="margin:8px 0 0">Todavía nadie te pidió tutoría. Cuando alguien lo haga, aparece acá con su contacto.</p>`}
    </div>` : ''}


    ${pendientes.length ? `
    <form class="panel angosto" id="fverif">
      <strong>Verificá ${pendientes.length === 1 ? 'tu postulación' : `tus ${pendientes.length} postulaciones`}</strong>
      <p class="ayuda" style="margin:4px 0 14px">${pendientes.map((p) => esc(p.materia)).join(' · ')}</p>
      <div class="nota-seguridad">🔒 Tus datos de insweb se usan una sola vez para leer <em>Notas → Notas finales</em> y se descartan:
        no se guardan ni se registran. Solo guardamos si cumplís y la nota (4 o 5).</div>
      ${simulado ? `<div class="nota-seguridad">Modo demo: insweb está simulado. Probá con usuario <code>1111111</code> o <code>2222222</code>, contraseña <code>demo</code>.</div>` : ''}
      <div class="campo"><label for="iu">Usuario de insweb</label><input id="iu" autocomplete="off" required /></div>
      <div class="campo"><label for="ip">Contraseña de insweb</label><input id="ip" type="password" autocomplete="off" required /></div>
      <button class="btn primario" id="btn-verif">Verificar</button>
      <div class="error" id="err-v"></div>
      <div id="res-v"></div>
    </form>` : ''}

    ${disponibles.length ? `
    <form class="panel" id="fpost">
      <strong>${pendientes.length ? 'Agregar más materias' : '¿Qué materias querés enseñar?'}</strong>${grilla}
      <div class="campo" style="margin-top:18px;max-width:360px"><label for="wa">WhatsApp <span class="ayuda">(opcional)</span></label>
        <input id="wa" inputmode="tel" placeholder="0981 123 456" value="${esc(estado.yo.whatsapp ? '0' + estado.yo.whatsapp.slice(3) : '')}" />
        <div class="ayuda">Si lo dejás, los estudiantes con sesión iniciada podrán escribirte. Si no, solo verán tu email.</div></div>
      <button class="btn primario">Inscribirme</button>
      <div class="error" id="err-p"></div>
    </form>` : ''}

    ${posts.some((p) => p.estado !== 'pendiente') ? `
    <div class="panel" style="margin-top:16px"><strong>Mis materias como tutor</strong>
      ${posts.filter((p) => p.estado !== 'pendiente').map((p) => `
        <div class="resultado"><div><div>${esc(p.materia)}</div><div class="ayuda">${esc(p.detalle ?? '')}</div></div>
          <div style="display:flex;gap:8px;align-items:center">
          ${p.estado === 'verificado'
            ? `<span class="chip ok">Verificado · ${p.nota}</span>
               <label style="display:flex;gap:6px;align-items:center;margin:0;font-weight:400"><input type="checkbox" data-disp="${p.id}" ${p.disponible ? 'checked' : ''} style="width:auto" /> Disponible</label>`
            : `<span class="chip no">No cumple</span>`}
          </div></div>`).join('')}
    </div>` : ''}`;

  enlazarCierreTutorias(() => vistaSerTutor());

  document.getElementById('fpost')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const materias = [...e.target.querySelectorAll('input[name=materias]:checked')].map((i) => Number(i.value));
    if (!materias.length) return (document.getElementById('err-p').textContent = 'Elegí al menos una materia.');
    try {
      await api('/api/postulaciones', { json: { materias, whatsapp: document.getElementById('wa').value } });
      estado.yo = await api('/api/yo');
      vistaSerTutor();
    } catch (err) {
      document.getElementById('err-p').textContent = err.message;
    }
  });

  document.getElementById('fverif')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-verif');
    btn.disabled = true;
    btn.textContent = 'Consultando insweb… (puede tardar unos 20 s)';
    document.getElementById('err-v').textContent = '';
    try {
      const { resultados } = await api('/api/postulaciones/verificar', {
        json: { usuario: document.getElementById('iu').value, password: document.getElementById('ip').value },
      });
      document.getElementById('ip').value = '';
      await cargarMaterias();
      const ok = resultados.filter((r) => r.cumple).length;
      aviso(ok ? `¡Listo! Ya figurás como tutor en ${ok} materia${ok > 1 ? 's' : ''}.` : 'Ninguna materia cumplió el requisito.');
      vistaSerTutor();
    } catch (err) {
      document.getElementById('err-v').textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Verificar';
    }
  });

  $vista.querySelectorAll('[data-disp]').forEach((cb) => {
    cb.onchange = async () => {
      await api(`/api/postulaciones/${cb.dataset.disp}`, { method: 'PATCH', json: { disponible: cb.checked } });
      await cargarMaterias();
      aviso(cb.checked ? 'Visible para otros estudiantes.' : 'Oculto de la lista de tutores.');
    };
  });
}

// ───────── Vista: Entrar / Registrarse ─────────
function vistaEntrar(params) {
  const volver = params.get('volver') || '/';
  let modo = params.get('modo') === 'registro' ? 'registro' : 'login';
  const pintar = () => {
    $vista.innerHTML = `
      <div class="cabecera"><h1>${modo === 'login' ? 'Entrar' : 'Crear cuenta'}</h1></div>
      <div class="panel angosto">
        <div class="tabs"><button data-m="login" class="${modo === 'login' ? 'activo' : ''}">Entrar</button>
          <button data-m="registro" class="${modo === 'registro' ? 'activo' : ''}">Crear cuenta</button></div>
        <form id="fauth">
          ${modo === 'registro' ? `
          <div class="campo"><label for="nombre">Nombre y apellido</label><input id="nombre" required autocomplete="name" /></div>
          <div class="campo"><label for="carrera">Carrera</label><select id="carrera" required>
            ${Object.entries(estado.meta.carreras).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>` : ''}
          <div class="campo"><label for="email">Email</label><input id="email" type="email" required autocomplete="email" placeholder="nombre.apellido@fiuna.edu.py" /></div>
          <div class="campo"><label for="password">Contraseña</label><input id="password" type="password" required minlength="${modo === 'registro' ? 8 : 1}" autocomplete="${modo === 'registro' ? 'new-password' : 'current-password'}" />
            ${modo === 'registro' ? '<div class="ayuda">Es la contraseña de esta app, no la de insweb.</div>' : ''}</div>
          <button class="btn primario">${modo === 'login' ? 'Entrar' : 'Crear cuenta'}</button>
          <div class="error" id="err"></div>
        </form>
        ${modo === 'login' ? `<div class="demo-cuentas">Cuentas de demo (contraseña <code>demo1234</code>):<br>
          <code>ana.benitez@fiuna.edu.py</code> · <code>carla.ortiz@fiuna.edu.py</code> (tutora)</div>` : ''}
      </div>`;
    $vista.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { modo = b.dataset.m; pintar(); }));
    document.getElementById('fauth').onsubmit = async (e) => {
      e.preventDefault();
      const v = (id) => document.getElementById(id)?.value;
      try {
        estado.yo =
          modo === 'login'
            ? await api('/api/login', { json: { email: v('email'), password: v('password') } })
            : await api('/api/registro', { json: { nombre: v('nombre'), carrera: v('carrera'), email: v('email'), password: v('password') } });
        pintarSesion();
        location.hash = '#' + volver;
      } catch (err) {
        document.getElementById('err').textContent = err.message;
      }
    };
  };
  pintar();
}

// ───────── router ─────────
const RUTAS = { '/': (p) => vistaApuntes(p), '/mis-apuntes': (p) => vistaApuntes(p, true), '/subir': vistaSubir, '/tutorias': vistaTutorias, '/ser-tutor': vistaSerTutor, '/entrar': vistaEntrar };

async function cargarMaterias() {
  estado.materias = await api('/api/materias');
}

async function router() {
  const [ruta, qs] = (location.hash.slice(1) || '/').split('?');
  const vista = RUTAS[ruta] ?? vistaApuntes;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('activo', a.dataset.ruta === ruta));
  try {
    await vista(new URLSearchParams(qs));
  } catch (e) {
    $vista.innerHTML = `<div class="panel vacio">Algo falló: ${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}

(async function iniciar() {
  [estado.yo, estado.meta] = await Promise.all([api('/api/yo'), api('/api/meta')]);
  await cargarMaterias();
  pintarSesion();
  window.addEventListener('hashchange', router);
  router();
})();

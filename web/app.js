/* Reformas Barcelona · formulario y presupuesto.
   La web no conoce ningún precio: envía las elecciones del cliente al webhook de n8n
   y pinta el presupuesto con los números que devuelve el flujo. */
(function () {
  'use strict';

  const TIMEOUT_MS = 30000;
  const TELEFONO = '930 000 000';

  // Etiquetas visibles de los slugs del contrato (sin precios).
  const ESTANCIAS = {
    bano: 'baño', cocina: 'cocina', salon: 'salón / comedor',
    dormitorio: 'dormitorio', vivienda: 'vivienda completa'
  };
  const CALIDADES = ['basica', 'media', 'alta'];
  const EXTRAS = ['demolicion', 'fontaneria', 'electricidad', 'pintura', 'suelo_radiante', 'aire_acondicionado', 'licencia'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const NBSP = ' ';

  const MENSAJES = {
    sinConfigurar: `Ahora mismo no podemos calcular presupuestos desde la web. Llámanos al ${TELEFONO} y te lo preparamos por teléfono.`,
    timeout: 'Está tardando más de lo normal. Vuelve a intentarlo en un momento: tus datos siguen aquí.',
    red: 'No hemos podido conectar. Revisa tu conexión a internet y vuelve a intentarlo.',
    generico: `Algo ha fallado al preparar tu presupuesto. Vuelve a intentarlo o llámanos al ${TELEFONO}.`
  };

  // ---------------------------------------------------------------------------
  // Formato de números y fechas (es-ES)
  // Formateador propio: Intl en es-ES no agrupa los números de 4 cifras (1200).
  // ---------------------------------------------------------------------------

  function agrupar(entero) {
    return entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function formatoNumero(n, decimales) {
    const [ent, dec] = Math.abs(n).toFixed(decimales).split('.');
    return (n < 0 ? '−' : '') + agrupar(ent) + (dec ? ',' + dec : '');
  }

  // 1200 → "1.200 €" · 1404.9 → "1.404,90 €"
  function formatoEuros(n) {
    const centimos = Math.round(Number(n) * 100);
    return formatoNumero(centimos / 100, centimos % 100 === 0 ? 0 : 2) + NBSP + '€';
  }

  // 6 → "6" · 7.5 → "7,5" · 7.25 → "7,25"
  function formatoCantidad(n) {
    const redondeado = Math.round(Number(n) * 100) / 100;
    const centesimas = Math.round(Math.abs(redondeado) * 100) % 100;
    const decimales = centesimas === 0 ? 0 : (centesimas % 10 === 0 ? 1 : 2);
    return formatoNumero(redondeado, decimales);
  }

  // "2026-10-09" → "9 de octubre de 2026" (sin pasar por Date para evitar desfases de zona horaria)
  function formatoFecha(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (m) return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
    const hoy = new Date();
    return `${hoy.getDate()} de ${MESES[hoy.getMonth()]} de ${hoy.getFullYear()}`;
  }

  // ---------------------------------------------------------------------------
  // Utilidades DOM: todo texto se inserta con textContent, nunca con innerHTML.
  // ---------------------------------------------------------------------------

  function el(tag, attrs, hijos) {
    const nodo = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') nodo.className = v;
        else if (k === 'text') nodo.textContent = v;
        else nodo.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const hijo of [].concat(hijos || [])) {
      if (hijo === null || hijo === undefined || hijo === false) continue;
      nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
    }
    return nodo;
  }

  const $ = (sel) => document.querySelector(sel);

  const form = $('#form-presupuesto');
  const campos = $('#form-campos');
  const botonEnviar = $('#boton-enviar');
  const avisoError = $('#aviso-error');
  const cargando = $('#cargando');
  const zonaFormulario = $('#zona-formulario');
  const zonaPresupuesto = $('#zona-presupuesto');
  const hojaPresupuesto = $('#presupuesto');
  const descripcion = $('#descripcion');
  const contador = $('#contador-descripcion');

  const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desplazamiento = reducirMovimiento ? 'auto' : 'smooth';

  let intentoEnvio = false;

  // ---------------------------------------------------------------------------
  // Ventanitas de información de los extras (Popover API nativa).
  // En pantallas anchas se colocan bajo su botón; en móvil, el CSS las fija abajo.
  // ---------------------------------------------------------------------------

  const MARGEN_POPOVER = 16;
  const pantallaAncha = window.matchMedia('(min-width: 560px)');

  function prepararVentanas(raiz) {
    raiz.querySelectorAll('.extra__popover').forEach((ventana) => {
      const boton = raiz.querySelector(`[popovertarget="${ventana.id}"]`);
      if (!boton) return;
      boton.setAttribute('aria-expanded', 'false');

      ventana.addEventListener('toggle', (e) => {
        const abierta = e.newState === 'open';
        boton.setAttribute('aria-expanded', abierta ? 'true' : 'false');
        if (!abierta) return;
        ventana.style.top = ventana.style.left = '';
        if (!pantallaAncha.matches) return;
        const b = boton.getBoundingClientRect();
        const ancho = ventana.offsetWidth;
        const alto = ventana.offsetHeight;
        let left = b.right - ancho;
        left = Math.max(MARGEN_POPOVER, Math.min(left, window.innerWidth - ancho - MARGEN_POPOVER));
        let top = b.bottom + 8;
        if (top + alto > window.innerHeight - MARGEN_POPOVER) top = Math.max(MARGEN_POPOVER, b.top - alto - 8);
        ventana.style.left = left + 'px';
        ventana.style.top = top + 'px';
      });
    });
  }
  // Al hacer scroll o cambiar el tamaño, se cierra la ventanita abierta para que no quede descolocada.
  const cerrarVentanas = () => document.querySelectorAll('.extra__popover:popover-open').forEach((v) => v.hidePopover());
  window.addEventListener('resize', cerrarVentanas);
  window.addEventListener('scroll', () => { if (pantallaAncha.matches) cerrarVentanas(); }, { passive: true });

  // ---------------------------------------------------------------------------
  // Estancias: el cliente puede pedir varias en la misma solicitud (baño y cocina…).
  // Cada bloque sale de <template id="plantilla-estancia">; sus ids y names llevan
  // un número propio (estancia-1, m2-1…) que no cambia aunque se quiten otros.
  // ---------------------------------------------------------------------------

  const MAX_ESTANCIAS = 5;
  const ATRIBUTOS_CON_ID = ['id', 'name', 'for', 'aria-describedby', 'aria-labelledby', 'popovertarget'];
  const contenedorEstancias = $('#estancias');
  const plantillaEstancia = $('#plantilla-estancia');
  const botonAnadir = $('#boton-anadir-estancia');
  const ayudaAnadir = $('#ayuda-anadir');
  const avisoEstancias = $('#aviso-estancias');
  let siguienteBloque = 1;

  const bloques = () => [...contenedorEstancias.querySelectorAll('.bloque-estancia')];
  const estanciaDe = (bloque) => form.elements[`estancia-${bloque.dataset.n}`].value;
  const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  function crearBloque() {
    const n = siguienteBloque++;
    const fragmento = plantillaEstancia.content.cloneNode(true);
    fragmento.querySelectorAll('*').forEach((nodo) => {
      for (const attr of ATRIBUTOS_CON_ID) {
        const v = nodo.getAttribute(attr);
        if (v && v.includes('__N__')) nodo.setAttribute(attr, v.replaceAll('__N__', n));
      }
    });
    const bloque = fragmento.querySelector('.bloque-estancia');
    bloque.dataset.n = n;
    bloque.querySelector('.bloque-estancia__quitar').addEventListener('click', () => quitarBloque(bloque));
    prepararVentanas(bloque);
    contenedorEstancias.append(bloque);
    return bloque;
  }

  // Numera los bloques, enseña su cabecera solo si hay varios y decide si se puede añadir otro.
  function actualizarBloques() {
    const todos = bloques();
    const varias = todos.length > 1;
    contenedorEstancias.classList.toggle('estancias--varias', varias);
    todos.forEach((b, i) => {
      const elegida = ESTANCIAS[estanciaDe(b)];
      b.querySelector('.bloque-estancia__titulo').textContent = `Estancia ${i + 1}${elegida ? ` · ${mayuscula(elegida)}` : ''}`;
      b.querySelector('.bloque-estancia__quitar').setAttribute('aria-label', `Quitar estancia ${i + 1}${elegida ? ` (${elegida})` : ''}`);
      b.querySelector('.bloque-estancia__cabecera').hidden = !varias;
    });

    const soloVivienda = !varias && estanciaDe(todos[0]) === 'vivienda';
    const lleno = todos.length >= MAX_ESTANCIAS;
    botonAnadir.hidden = lleno || soloVivienda;
    if (soloVivienda) ayudaAnadir.textContent = 'La vivienda completa ya incluye todas las estancias.';
    else if (lleno) ayudaAnadir.textContent = `Has llegado al máximo de ${MAX_ESTANCIAS} estancias. Si necesitas más, llámanos al ${TELEFONO}.`;
    else ayudaAnadir.textContent = varias ? `Puedes añadir hasta ${MAX_ESTANCIAS} estancias.` : '¿Reformas más de una? Añade, por ejemplo, el baño y la cocina en la misma solicitud.';
  }

  function quitarBloque(bloque) {
    const todos = bloques();
    if (todos.length <= 1) return;
    const posicion = todos.indexOf(bloque);
    bloque.remove();
    actualizarBloques();
    if (intentoEnvio) validarEstancias();

    const restantes = bloques();
    avisoEstancias.textContent = `Estancia quitada. ${restantes.length === 1 ? 'Queda 1 estancia' : `Quedan ${restantes.length} estancias`}.`;
    const destino = restantes[Math.min(posicion, restantes.length - 1)];
    if (restantes.length > 1) destino.querySelector('.bloque-estancia__titulo').focus();
    else if (!botonAnadir.hidden) botonAnadir.focus();
    else form.elements[`estancia-${destino.dataset.n}`][0].focus();
  }

  botonAnadir.addEventListener('click', () => {
    if (bloques().length >= MAX_ESTANCIAS) return;
    const bloque = crearBloque();
    actualizarBloques();
    if (intentoEnvio) validarEstancias();
    bloque.scrollIntoView({ behavior: desplazamiento, block: 'start' });
    bloque.querySelector('.bloque-estancia__titulo').focus({ preventScroll: true });
  });

  crearBloque();
  actualizarBloques();

  // ---------------------------------------------------------------------------
  // Validación en cliente (el flujo vuelve a validar en el servidor)
  // ---------------------------------------------------------------------------

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // Campos de cada bloque: reciben el número del bloque.
  const validadoresEstancia = {
    estancia(n) {
      const v = form.elements[`estancia-${n}`].value;
      if (!ESTANCIAS[v]) return 'Elige qué estancia quieres reformar.';
      if (v === 'vivienda' && bloques().length > 1) {
        return 'La vivienda completa ya incluye todas las estancias. Pídela sola o elige aquí la estancia concreta.';
      }
      return '';
    },
    m2(n) {
      const input = form.elements[`m2-${n}`];
      if (input.validity.badInput) return 'Escribe solo el número de metros, por ejemplo 7,5.';
      if (input.value.trim() === '') return 'Indica los metros cuadrados aproximados.';
      const m2 = Number(input.value);
      if (!Number.isFinite(m2) || m2 <= 0) return 'Los metros tienen que ser mayores que 0.';
      if (m2 > 500) return `Para más de 500 m² llámanos al ${TELEFONO} y lo vemos contigo.`;
      return '';
    },
    calidad(n) {
      return CALIDADES.includes(form.elements[`calidad-${n}`].value) ? '' : 'Elige una calidad de acabados.';
    }
  };

  const validadoresDatos = {
    nombre() {
      return form.elements.nombre.value.trim() ? '' : 'Escribe tu nombre para saber a quién dirigir el presupuesto.';
    },
    email() {
      const v = form.elements.email.value.trim();
      if (!v) return 'Escribe tu email para poder contactarte.';
      return EMAIL_RE.test(v) ? '' : 'Revisa el email: parece que le falta algo (por ejemplo, nombre@correo.com).';
    }
  };

  // "m2-3" → validador de m² del bloque 3 · "email" → validador del email.
  function validadorDe(nombre) {
    const m = /^(estancia|m2|calidad)-(\d+)$/.exec(nombre || '');
    if (m) return () => validadoresEstancia[m[1]](m[2]);
    return validadoresDatos[nombre] || null;
  }

  function mostrarError(nombre, mensaje) {
    const caja = document.getElementById('error-' + nombre);
    const grupo = document.getElementById('grupo-' + nombre);
    caja.textContent = mensaje;
    caja.hidden = !mensaje;
    if (grupo) {
      grupo.classList.toggle('grupo--invalido', Boolean(mensaje));
    } else {
      form.elements[nombre].setAttribute('aria-invalid', mensaje ? 'true' : 'false');
    }
  }

  function validarCampo(nombre) {
    const mensaje = validadorDe(nombre)();
    mostrarError(nombre, mensaje);
    return !mensaje;
  }

  // La regla de la vivienda completa depende de cuántos bloques hay: se revisan todos a la vez.
  function validarEstancias() {
    bloques().forEach((b) => validarCampo(`estancia-${b.dataset.n}`));
  }

  function validarTodo() {
    // Orden visual del formulario, para llevar el foco al primer error.
    const orden = [
      ...bloques().flatMap((b) => ['estancia', 'm2', 'calidad'].map((campo) => `${campo}-${b.dataset.n}`)),
      'nombre', 'email'
    ];
    let primero = null;
    for (const nombre of orden) {
      if (!validarCampo(nombre) && !primero) primero = nombre;
    }
    if (primero) {
      const objetivo = form.elements[primero];
      const foco = objetivo instanceof RadioNodeList ? objetivo[0] : objetivo;
      foco.focus({ preventScroll: true });
      document.getElementById('error-' + primero).closest('fieldset, .campo')
        .scrollIntoView({ behavior: desplazamiento, block: 'center' });
    }
    return !primero;
  }

  // Revalidar en vivo solo tras el primer intento, para no regañar mientras se escribe.
  form.addEventListener('input', (e) => {
    const nombre = e.target.name;
    if (intentoEnvio && validadorDe(nombre)) validarCampo(nombre);
  });
  form.addEventListener('change', (e) => {
    const nombre = e.target.name || '';
    if (nombre.startsWith('estancia-')) {
      actualizarBloques();
      if (intentoEnvio) validarEstancias();
    } else if (intentoEnvio && validadorDe(nombre)) {
      validarCampo(nombre);
    }
  });
  form.addEventListener('focusout', (e) => {
    const nombre = e.target.name || '';
    if ((/^m2-\d+$/.test(nombre) || nombre === 'nombre' || nombre === 'email') && e.target.value.trim() !== '') validarCampo(nombre);
  });

  function actualizarContador() {
    contador.textContent = `${descripcion.value.length} / 1000`;
  }
  descripcion.addEventListener('input', actualizarContador);
  actualizarContador();

  // ---------------------------------------------------------------------------
  // Petición al webhook
  // ---------------------------------------------------------------------------

  function datosDelFormulario() {
    const f = form.elements;
    const estancias = bloques().map((b) => {
      const n = b.dataset.n;
      const marcados = new Set([...b.querySelectorAll(`input[name="extras-${n}"]:checked`)].map((i) => i.value));
      return {
        estancia: f[`estancia-${n}`].value,
        m2: Math.round(Number(f[`m2-${n}`].value) * 100) / 100,
        calidad: f[`calidad-${n}`].value,
        extras: EXTRAS.filter((x) => marcados.has(x))
      };
    });
    return {
      nombre: f.nombre.value.trim().slice(0, 100),
      email: f.email.value.trim().slice(0, 150),
      telefono: f.telefono.value.trim().slice(0, 20),
      direccion: f.direccion.value.trim().slice(0, 200),
      // Compatibilidad: la primera estancia también va suelta, para un flujo que aún no lea `estancias`.
      ...estancias[0],
      estancias,
      descripcion: f.descripcion.value.trim().slice(0, 1000)
    };
  }

  class ErrorCliente extends Error {}

  async function pedirPresupuesto(datos) {
    if (typeof WEBHOOK_URL !== 'string' || !WEBHOOK_URL) {
      // Sin webhook configurado: se muestra el JSON que recibiría n8n (útil para montar el flujo).
      console.warn('Falta WEBHOOK_URL en config.js. Esto es lo que se enviaría al webhook:');
      console.info(JSON.stringify(datos, null, 2));
      throw new ErrorCliente(MENSAJES.sinConfigurar);
    }

    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), TIMEOUT_MS);
    let respuesta;
    try {
      respuesta = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(datos),
        signal: control.signal
      });
    } catch (err) {
      throw new ErrorCliente(err.name === 'AbortError' ? MENSAJES.timeout : MENSAJES.red);
    } finally {
      clearTimeout(temporizador);
    }

    let cuerpo = null;
    try {
      cuerpo = await respuesta.json();
    } catch (_) {
      throw new ErrorCliente(MENSAJES.generico);
    }

    if (!respuesta.ok || !cuerpo || cuerpo.ok !== true) {
      const mensaje = cuerpo && typeof cuerpo.error === 'string' && cuerpo.error.trim() ? cuerpo.error.trim() : MENSAJES.generico;
      throw new ErrorCliente(mensaje);
    }
    if (!respuestaValida(cuerpo)) {
      console.error('Respuesta del webhook con formato inesperado', cuerpo);
      throw new ErrorCliente(MENSAJES.generico);
    }
    if (datos.estancias.length > 1 && !cuerpo.partidas.some((p) => p.grupo)) {
      // Un flujo antiguo solo calcularía la primera estancia: mejor no enseñar un total incompleto.
      console.error('El flujo de n8n no ha devuelto las partidas agrupadas por estancia (¿falta actualizarlo?)', cuerpo);
      throw new ErrorCliente(MENSAJES.generico);
    }
    return cuerpo;
  }

  function esNumero(n) { return typeof n === 'number' && Number.isFinite(n); }

  function respuestaValida(r) {
    return Array.isArray(r.partidas) && r.partidas.length > 0 &&
      r.partidas.every((p) => p && typeof p.concepto === 'string' && esNumero(p.cantidad) && esNumero(p.precioUnitario) && esNumero(p.importe)) &&
      esNumero(r.subtotal) && esNumero(r.iva) && esNumero(r.total);
  }

  // ["bano", "cocina"] → "baño y cocina"
  function nombresEstancias(estancias) {
    const nombres = [...new Set(estancias.map((e) => ESTANCIAS[e.estancia]).filter(Boolean))];
    return nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}` : (nombres[0] || '');
  }

  // Partidas consecutivas con el mismo `grupo` (la estancia a la que pertenecen) van juntas.
  function agruparPartidas(partidas) {
    const grupos = [];
    for (const p of partidas) {
      const nombre = typeof p.grupo === 'string' ? p.grupo : '';
      let ultimo = grupos[grupos.length - 1];
      if (!ultimo || ultimo.nombre !== nombre) grupos.push(ultimo = { nombre, partidas: [] });
      ultimo.partidas.push(p);
    }
    return grupos;
  }

  // ---------------------------------------------------------------------------
  // Envío
  // ---------------------------------------------------------------------------

  let enviando = false;

  function ponerCargando(activo) {
    enviando = activo;
    botonEnviar.disabled = activo;
    botonEnviar.textContent = activo ? 'Preparando tu presupuesto…' : 'Calcular mi presupuesto';
    form.setAttribute('aria-busy', activo ? 'true' : 'false');
    campos.disabled = activo;
    cargando.textContent = activo ? 'Estamos preparando tu presupuesto… Puede tardar unos segundos.' : '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (enviando) return;
    intentoEnvio = true;
    avisoError.hidden = true;
    if (!validarTodo()) return;

    const datos = datosDelFormulario();
    ponerCargando(true);
    try {
      const presupuesto = await pedirPresupuesto(datos);
      mostrarPresupuesto(presupuesto, datos);
    } catch (err) {
      if (!(err instanceof ErrorCliente)) console.error(err);
      avisoError.textContent = err instanceof ErrorCliente ? err.message : MENSAJES.generico;
      avisoError.hidden = false;
      avisoError.scrollIntoView({ behavior: desplazamiento, block: 'center' });
    } finally {
      ponerCargando(false);
    }
  });

  // ---------------------------------------------------------------------------
  // Presupuesto en pantalla (misma estructura que el PDF de ejemplo)
  // ---------------------------------------------------------------------------

  function mostrarPresupuesto(r, enviado) {
    const cliente = Object.assign({}, enviado, r.cliente || {});
    const textos = r.textos || {};
    const estancia = nombresEstancias(enviado.estancias);
    const titulo = r.titulo || `Presupuesto de reforma de ${estancia}`;
    const grupos = agruparPartidas(r.partidas);
    const conGrupos = grupos.some((g) => g.nombre);
    const nombrePila = (cliente.nombre || '').split(/\s+/)[0];

    const filasCliente = [
      ['Cliente', cliente.nombre],
      ['Email', cliente.email],
      ['Teléfono', cliente.telefono],
      ['Dirección de la obra', cliente.direccion]
    ].filter(([, v]) => v && String(v).trim());

    const trabajos = Array.isArray(textos.trabajos) ? textos.trabajos.filter((t) => typeof t === 'string' && t.trim()) : [];
    const condiciones = Array.isArray(r.condiciones) ? r.condiciones.filter((c) => c && c.titulo) : [];
    const ivaPct = esNumero(r.ivaPorcentaje) ? r.ivaPorcentaje : 21;

    const meta = [r.numero ? `Nº ${r.numero}` : null, formatoFecha(r.fecha)].filter(Boolean).join(' · ');

    hojaPresupuesto.replaceChildren(
      el('header', { class: 'p-cabecera' }, [
        el('img', { class: 'marca__logo p-logo', src: 'assets/reformas-barcelona-logo.svg', alt: 'Reformas Barcelona · Reformas integrales desde 1998', width: '724', height: '124' }),
        el('p', { class: 'p-empresa' }, [
          'Reformas Barcelona, S.L. (empresa ficticia)', el('br'),
          'Carrer de la Reforma, 12, 08005 Barcelona', el('br'),
          `${TELEFONO} · presupuestos@reformasbarcelona.example`, el('br'),
          'www.reformasbarcelona.example'
        ])
      ]),

      el('h2', { class: 'p-titulo', id: 'presupuesto-titulo', tabindex: '-1', text: titulo }),
      el('p', { class: 'p-meta', text: meta }),

      filasCliente.length ? el('dl', { class: 'p-cliente' },
        filasCliente.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])) : null,

      el('p', { class: 'p-saludo', text: textos.saludo || (nombrePila ? `Hola ${nombrePila}:` : 'Hola:') }),
      el('p', { class: 'p-resumen', text: textos.resumen ||
        `Muchas gracias por contactar con Reformas Barcelona. Te enviamos el presupuesto para tu reforma de ${estancia}` +
        (enviado.estancias.length === 1 ? ` de unos ${formatoCantidad(enviado.estancias[0].m2)} m².` : '.') }),

      trabajos.length ? el('section', { class: 'p-seccion', 'aria-labelledby': 'p-trabajos' }, [
        el('h3', { id: 'p-trabajos', text: 'Descripción de los trabajos' }),
        el('ul', { class: 'p-lista' }, trabajos.map((t) => el('li', { text: t })))
      ]) : null,

      el('section', { class: 'p-seccion', 'aria-labelledby': 'p-importes' }, [
        el('h3', { id: 'p-importes', text: 'Presupuesto' }),
        el('table', { class: 'p-tabla' }, [
          el('thead', null, el('tr', null, [
            el('th', { scope: 'col', text: 'Concepto' }),
            el('th', { scope: 'col', class: 'num', text: 'Cantidad' }),
            el('th', { scope: 'col', class: 'num', text: 'Precio unitario' }),
            el('th', { scope: 'col', class: 'num', text: 'Importe' })
          ])),
          // Con varias estancias, cada una lleva su fila de cabecera («Baño», «Cocina»…).
          ...grupos.map((g) => el('tbody', null, [
            conGrupos ? el('tr', { class: 'p-grupo' }, el('th', { scope: 'colgroup', colspan: '4', text: g.nombre })) : null,
            ...g.partidas.map((p) => el('tr', null, [
              el('td', { text: p.concepto }),
              el('td', { class: 'num', text: `${formatoCantidad(p.cantidad)}${NBSP}${p.unidad || ''}`.trim() }),
              el('td', { class: 'num', text: formatoEuros(p.precioUnitario) }),
              el('td', { class: 'num', text: formatoEuros(p.importe) })
            ]))
          ]))
        ]),
        el('dl', { class: 'p-totales' }, [
          el('dt', { text: 'Subtotal' }), el('dd', { text: formatoEuros(r.subtotal) }),
          el('dt', { class: 'p-iva', text: `IVA (${formatoCantidad(ivaPct)}${NBSP}%)` }), el('dd', { class: 'p-iva', text: formatoEuros(r.iva) }),
          el('dt', { class: 'p-total', text: 'Total' }), el('dd', { class: 'p-total', text: formatoEuros(r.total) })
        ])
      ]),

      r.plazo ? el('p', { class: 'p-plazo' }, [el('strong', { text: 'Plazo estimado:' }), ` ${r.plazo} desde el inicio de la obra.`]) : null,

      condiciones.length ? el('section', { class: 'p-seccion', 'aria-labelledby': 'p-condiciones' }, [
        el('h3', { id: 'p-condiciones', text: 'Condiciones' }),
        el('ul', { class: 'p-lista' }, condiciones.map((c) =>
          el('li', null, [el('strong', { text: `${c.titulo}:` }), c.detalle ? ` ${c.detalle}` : '']))
        )
      ]) : null,

      el('p', { class: 'p-firma' }, ['Un saludo,', el('br'), el('strong', { text: 'Jordi Ferrer' }), el('br'), 'Gerente · Reformas Barcelona']),

      el('footer', { class: 'p-pie', text: `Reformas Barcelona, S.L. (empresa ficticia) · Carrer de la Reforma, 12, 08005 Barcelona · ${TELEFONO}` })
    );

    hojaPresupuesto.dataset.numero = r.numero || '';
    zonaFormulario.hidden = true;
    document.querySelector('.portada').hidden = true;
    document.querySelector('.pasos-franja').hidden = true;
    zonaPresupuesto.hidden = false;

    hojaPresupuesto.classList.remove('aparece');
    void hojaPresupuesto.offsetWidth; // reinicia la animación si se pide otro
    hojaPresupuesto.classList.add('aparece');

    zonaPresupuesto.scrollIntoView({ behavior: 'auto', block: 'start' });
    $('#presupuesto-titulo').focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------
  // Acciones del presupuesto
  // ---------------------------------------------------------------------------

  $('#boton-pdf').addEventListener('click', () => {
    // El título del documento da nombre al PDF guardado.
    const tituloOriginal = document.title;
    const numero = hojaPresupuesto.dataset.numero;
    document.title = `Presupuesto ${numero ? numero + ' ' : ''}· Reformas Barcelona`;
    window.addEventListener('afterprint', () => { document.title = tituloOriginal; }, { once: true });
    window.print();
  });

  $('#boton-otro').addEventListener('click', () => {
    // Se conservan los datos del formulario para poder cambiar solo lo necesario.
    zonaPresupuesto.hidden = true;
    zonaFormulario.hidden = false;
    document.querySelector('.portada').hidden = false;
    document.querySelector('.pasos-franja').hidden = false;
    avisoError.hidden = true;
    $('#formulario').scrollIntoView({ behavior: 'auto', block: 'start' });
    $('#formulario-titulo').focus({ preventScroll: true });
  });

  // ---------------------------------------------------------------------------
  // Accesos directos de la portada: eligen la estancia del primer bloque y llevan a los metros
  // ---------------------------------------------------------------------------

  document.querySelectorAll('.atajo').forEach((boton) => {
    boton.addEventListener('click', () => {
      const n = bloques()[0].dataset.n;
      const radio = form.querySelector(`input[name="estancia-${n}"][value="${boton.dataset.estancia}"]`);
      if (!radio) return;
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      const m2 = form.elements[`m2-${n}`];
      m2.closest('.campo').scrollIntoView({ behavior: desplazamiento, block: 'center' });
      m2.focus({ preventScroll: true });
    });
  });

  // ---------------------------------------------------------------------------
  // Fotos de obras terminadas (portada)
  // Cambian solas cada pocos segundos; se paran con el botón, al pasar el ratón
  // o el foco por encima, con la pestaña oculta y si el sistema pide menos movimiento.
  // ---------------------------------------------------------------------------

  const obras = $('#obras');
  if (obras) {
    const INTERVALO_MS = 6000;
    const diapositivas = [...obras.querySelectorAll('.obra')];
    const puntos = [...obras.querySelectorAll('.obras__punto')];
    const botonPausa = $('#obras-pausa');
    let actual = 0;
    let temporizador = null;
    let pausadoPorUsuario = reducirMovimiento;
    let encima = false;

    function mostrarObra(i) {
      actual = (i + diapositivas.length) % diapositivas.length;
      diapositivas.forEach((d, n) => {
        const visible = n === actual;
        d.classList.toggle('obra--visible', visible);
        d.inert = !visible;
      });
      puntos.forEach((p, n) => {
        if (n === actual) p.setAttribute('aria-current', 'true');
        else p.removeAttribute('aria-current');
      });
    }

    function programar() {
      clearInterval(temporizador);
      temporizador = null;
      if (pausadoPorUsuario || encima || document.hidden) return;
      temporizador = setInterval(() => mostrarObra(actual + 1), INTERVALO_MS);
    }

    function actualizarBotonPausa() {
      botonPausa.setAttribute('aria-pressed', pausadoPorUsuario ? 'true' : 'false');
      botonPausa.setAttribute('aria-label', pausadoPorUsuario ? 'Reanudar el pase de fotos' : 'Pausar el pase de fotos');
    }

    botonPausa.addEventListener('click', () => {
      pausadoPorUsuario = !pausadoPorUsuario;
      actualizarBotonPausa();
      programar();
    });
    puntos.forEach((p) => p.addEventListener('click', () => {
      mostrarObra(Number(p.dataset.obra));
      programar();
    }));
    obras.addEventListener('mouseenter', () => { encima = true; programar(); });
    obras.addEventListener('mouseleave', () => { encima = false; programar(); });
    obras.addEventListener('focusin', () => { encima = true; programar(); });
    obras.addEventListener('focusout', (e) => {
      if (!obras.contains(e.relatedTarget)) { encima = false; programar(); }
    });
    document.addEventListener('visibilitychange', programar);

    actualizarBotonPausa();
    programar();
  }
})();

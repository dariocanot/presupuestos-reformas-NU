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

  // ---------------------------------------------------------------------------
  // Validación en cliente (el flujo vuelve a validar en el servidor)
  // ---------------------------------------------------------------------------

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  let intentoEnvio = false;

  const validadores = {
    estancia() {
      const v = form.elements.estancia.value;
      return ESTANCIAS[v] ? '' : 'Elige qué estancia quieres reformar.';
    },
    m2() {
      const input = form.elements.m2;
      if (input.validity.badInput) return 'Escribe solo el número de metros, por ejemplo 7,5.';
      if (input.value.trim() === '') return 'Indica los metros cuadrados aproximados.';
      const n = Number(input.value);
      if (!Number.isFinite(n) || n <= 0) return 'Los metros tienen que ser mayores que 0.';
      if (n > 500) return `Para más de 500 m² llámanos al ${TELEFONO} y lo vemos contigo.`;
      return '';
    },
    calidad() {
      return CALIDADES.includes(form.elements.calidad.value) ? '' : 'Elige una calidad de acabados.';
    },
    nombre() {
      return form.elements.nombre.value.trim() ? '' : 'Escribe tu nombre para saber a quién dirigir el presupuesto.';
    },
    email() {
      const v = form.elements.email.value.trim();
      if (!v) return 'Escribe tu email para poder contactarte.';
      return EMAIL_RE.test(v) ? '' : 'Revisa el email: parece que le falta algo (por ejemplo, nombre@correo.com).';
    }
  };

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
    const mensaje = validadores[nombre]();
    mostrarError(nombre, mensaje);
    return !mensaje;
  }

  function validarTodo() {
    // Orden visual del formulario, para llevar el foco al primer error.
    const orden = ['estancia', 'm2', 'calidad', 'nombre', 'email'];
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
    if (intentoEnvio && validadores[nombre]) validarCampo(nombre);
  });
  form.addEventListener('change', (e) => {
    const nombre = e.target.name;
    if (intentoEnvio && validadores[nombre]) validarCampo(nombre);
  });
  form.addEventListener('focusout', (e) => {
    const nombre = e.target.name;
    if (['m2', 'nombre', 'email'].includes(nombre) && e.target.value.trim() !== '') validarCampo(nombre);
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
    const marcados = new Set([...form.querySelectorAll('input[name="extras"]:checked')].map((i) => i.value));
    return {
      nombre: f.nombre.value.trim().slice(0, 100),
      email: f.email.value.trim().slice(0, 150),
      telefono: f.telefono.value.trim().slice(0, 20),
      direccion: f.direccion.value.trim().slice(0, 200),
      estancia: f.estancia.value,
      m2: Math.round(Number(f.m2.value) * 100) / 100,
      calidad: f.calidad.value,
      extras: EXTRAS.filter((x) => marcados.has(x)),
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
    return cuerpo;
  }

  function esNumero(n) { return typeof n === 'number' && Number.isFinite(n); }

  function respuestaValida(r) {
    return Array.isArray(r.partidas) && r.partidas.length > 0 &&
      r.partidas.every((p) => p && typeof p.concepto === 'string' && esNumero(p.cantidad) && esNumero(p.precioUnitario) && esNumero(p.importe)) &&
      esNumero(r.subtotal) && esNumero(r.iva) && esNumero(r.total);
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
    const estancia = ESTANCIAS[enviado.estancia] || '';
    const titulo = r.titulo || `Presupuesto de reforma de ${estancia}`;
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
        `Muchas gracias por contactar con Reformas Barcelona. Te enviamos el presupuesto para tu reforma de ${estancia} de unos ${formatoCantidad(enviado.m2)} m².` }),

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
          el('tbody', null, r.partidas.map((p) => el('tr', null, [
            el('td', { text: p.concepto }),
            el('td', { class: 'num', text: `${formatoCantidad(p.cantidad)}${NBSP}${p.unidad || ''}`.trim() }),
            el('td', { class: 'num', text: formatoEuros(p.precioUnitario) }),
            el('td', { class: 'num', text: formatoEuros(p.importe) })
          ])))
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
  // Accesos directos de la portada: eligen la estancia y llevan a los metros
  // ---------------------------------------------------------------------------

  document.querySelectorAll('.atajo').forEach((boton) => {
    boton.addEventListener('click', () => {
      const radio = form.querySelector(`input[name="estancia"][value="${boton.dataset.estancia}"]`);
      if (!radio) return;
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      const m2 = form.elements.m2;
      m2.closest('.campo').scrollIntoView({ behavior: desplazamiento, block: 'center' });
      m2.focus({ preventScroll: true });
    });
  });

  // ---------------------------------------------------------------------------
  // Ventanitas de información de los extras (Popover API nativa).
  // En pantallas anchas se colocan bajo su botón; en móvil, el CSS las fija abajo.
  // ---------------------------------------------------------------------------

  const MARGEN_POPOVER = 16;
  const pantallaAncha = window.matchMedia('(min-width: 560px)');

  document.querySelectorAll('.extra__popover').forEach((ventana) => {
    const boton = document.querySelector(`[popovertarget="${ventana.id}"]`);
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
  // Al hacer scroll o cambiar el tamaño, se cierra la ventanita abierta para que no quede descolocada.
  const cerrarVentanas = () => document.querySelectorAll('.extra__popover:popover-open').forEach((v) => v.hidePopover());
  window.addEventListener('resize', cerrarVentanas);
  window.addEventListener('scroll', () => { if (pantallaAncha.matches) cerrarVentanas(); }, { passive: true });

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

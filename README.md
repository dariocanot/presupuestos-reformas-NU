# Presupuestos con IA · Reformas Barcelona

Caso práctico de las prácticas en **NU Automatiza**: una web y un flujo de **n8n** que generan al momento los presupuestos de reforma que hoy la empresa hace a mano.

> **En una frase:** el cliente pide su presupuesto en la web, un flujo de n8n lo calcula con las tarifas de la empresa, la IA redacta el texto y el resultado aparece en la web al momento.

Reformas Barcelona es una **empresa ficticia** y todos los datos son inventados. No uses datos personales reales.

---

## Índice

- [El problema](#el-problema)
- [Arquitectura](#arquitectura)
- [Qué hay que construir](#qué-hay-que-construir)
- [Datos de la empresa](#datos-de-la-empresa)
- [Cómo se calcula el presupuesto](#cómo-se-calcula-el-presupuesto)
- [Caso de prueba](#caso-de-prueba)
- [Formato del presupuesto](#formato-del-presupuesto)
- [Extras opcionales](#extras-opcionales)
- [Puesta en marcha (gratis)](#puesta-en-marcha-gratis)
- [Problemas habituales](#problemas-habituales)
- [Entrega y criterios de evaluación](#entrega-y-criterios-de-evaluación)
- [Material de referencia](#material-de-referencia)

---

## El problema

Reformas Barcelona tiene 25 personas en plantilla y trabaja desde 1998. Hoy, cuando alguien pide un presupuesto por teléfono o por correo, Jordi Ferrer (el gerente) apunta lo que le cuentan, busca las tarifas en un Excel, hace las cuentas a mano y redacta el presupuesto en Word. El cliente lo recibe **dos o tres días después**, a veces con errores de cálculo, y para entonces muchos ya han aceptado el presupuesto de otra empresa.

> «Quiero que el cliente pida el presupuesto en nuestra web y lo reciba en el momento, bien explicado, con nuestra imagen y sin errores en los números.» (Jordi, gerente)

## Arquitectura

```
┌──────────────┐   POST    ┌──────────────────────────────────────────┐
│  1 · WEB     │ ────────▶ │  2 · n8n                                 │
│  Formulario  │           │  Webhook → Calcular partidas, IVA, total │
│              │           │          → 3 · IA redacta los textos     │
│  4 · WEB     │ ◀──────── │          → Respond to Webhook            │
│  Presupuesto │   JSON    └──────────────────────────────────────────┘
└──────────────┘
```

1. **Web:** el cliente rellena el formulario.
2. **n8n:** el flujo calcula el precio con las tarifas de la empresa (partidas, subtotal, IVA y total).
3. **IA:** redacta un texto personalizado con el tono de la empresa.
4. **Web:** el cliente ve su presupuesto completo, en la misma página y al momento.

## Qué hay que construir

Todo lo de esta sección es **obligatorio**.

### 1 · Web (frontend)

Formulario con estos campos:

| Campo | Obligatorio | Valores |
|---|---|---|
| Nombre | Sí | |
| Email | Sí | |
| Teléfono | No | |
| Dirección de la obra | No | |
| Tipo de estancia | Sí | Baño · Cocina · Salón/comedor · Dormitorio · Vivienda completa |
| Metros cuadrados | Sí | número |
| Calidad de acabados | Sí | Básica · Media · Alta |
| Extras | No | casillas (ver [Extras](#extras)) |
| «Cuéntanos qué quieres hacer» | No | texto libre |

- Debe llevar la imagen de Reformas Barcelona: logo, colores y tipografía (ver [Identidad visual](#identidad-visual)).
- Basta con HTML, CSS y JavaScript. Se puede usar un framework si se prefiere.

### 2 · Flujo en n8n (backend)

- Recibe los datos de la web con un nodo **Webhook**.
- Calcula las partidas, el subtotal, el IVA (21 %) y el total con las tarifas. Las tarifas pueden ir copiadas dentro del flujo o leerse de una hoja de Google.
- Le pide a la IA que redacte el presupuesto.
- Devuelve el resultado a la web con un nodo **Respond to Webhook**.

### 3 · IA

- Redacta el saludo, un resumen personalizado según lo que ha escrito el cliente y la descripción de los trabajos.
- Usa el tono de la empresa: cercano y profesional, tratando al cliente de tú.
- **Regla clave:** los importes los calcula el flujo. La IA redacta, pero **no inventa ni cambia precios**.

### 4 · Presupuesto en la web

Al enviar el formulario, la web muestra los datos del cliente, el texto redactado, la tabla de partidas, el subtotal, el IVA, el total, el plazo estimado y las condiciones. El modelo a seguir es [`Contexto/reformas-barcelona-presupuesto-ejemplo.pdf`](Contexto/reformas-barcelona-presupuesto-ejemplo.pdf).

## Datos de la empresa

Fuente: [`Contexto/reformas-barcelona-datos.xlsx`](Contexto/reformas-barcelona-datos.xlsx).

### Identidad visual

| Campo | Valor |
|---|---|
| Nombre comercial | Reformas Barcelona |
| Razón social | Reformas Barcelona, S.L. (empresa ficticia) |
| NIF | B00000000 (ficticio) |
| Dirección | Carrer de la Reforma, 12, 08005 Barcelona |
| Teléfono | 930 000 000 |
| Email | presupuestos@reformasbarcelona.example |
| Web | www.reformasbarcelona.example |
| Gerente | Jordi Ferrer |
| Desde | 1998 · 25 personas en plantilla |
| Lema | Reformas integrales desde 1998 |
| Color principal | Terracota `#C4552D` |
| Color de texto | Antracita `#2A2A2A` |
| Color de fondo | Crema `#F6F1EA` |
| Tipografía sugerida | [Manrope](https://fonts.google.com/specimen/Manrope) (Google Fonts) |
| Tono | Cercano y profesional, tratando al cliente de tú |

### Tarifas (€/m², materiales y mano de obra incluidos)

| Estancia | Básica | Media | Alta |
|---|---:|---:|---:|
| Baño | 620 | 880 | 1.250 |
| Cocina | 680 | 950 | 1.400 |
| Salón / comedor | 110 | 170 | 260 |
| Dormitorio | 100 | 155 | 240 |
| Vivienda completa | 520 | 750 | 1.100 |

### Qué incluye cada calidad

Le sirve a la IA para redactar la descripción de los trabajos.

| Calidad | Qué incluye |
|---|---|
| Básica | Materiales de gama económica: azulejo cerámico liso, sanitarios y grifería estándar, pintura plástica blanca. |
| Media | Gres porcelánico, grifería termostática, muebles de baño o cocina modulares, iluminación LED básica. |
| Alta | Porcelánico de gran formato, carpintería a medida, encimeras de piedra, domótica básica e iluminación LED integrada. |

### Extras

Los extras «por m²» usan los mismos m² que la estancia.

| Extra | Tipo | Precio | Descripción |
|---|---|---:|---|
| Demolición y retirada de escombros | por m² | 35 € | Quitar el revestimiento y los sanitarios actuales y llevar los escombros al punto limpio. |
| Fontanería nueva | fijo | 1.200 € | Cambiar todas las tuberías de agua y desagües de la estancia. |
| Instalación eléctrica nueva | fijo | 1.500 € | Cableado, enchufes, mecanismos y cuadro eléctrico nuevos, con boletín. |
| Pintura de paredes y techos | por m² | 12 € | Dos manos de pintura plástica en paredes y techo. |
| Suelo radiante | por m² | 75 € | Suelo radiante por agua, conectado a la caldera existente. |
| Aire acondicionado (1 split) | fijo | 1.100 € | Suministro e instalación de un equipo split con bomba de calor. |
| Gestión de licencia de obra | fijo | 350 € | Tramitación del permiso de obra en el ayuntamiento. |

### Plazos estimados

| Estancia | Plazo |
|---|---|
| Baño | 2–3 semanas |
| Cocina | 3–4 semanas |
| Salón / comedor | 1–2 semanas |
| Dormitorio | 1–2 semanas |
| Vivienda completa | 8–12 semanas |

### Condiciones

Aparecen al final de todos los presupuestos.

| Condición | Detalle |
|---|---|
| Validez del presupuesto | 30 días desde la fecha de emisión |
| Forma de pago | 40 % al aceptar el presupuesto, 40 % a mitad de obra y 20 % al terminar |
| IVA | 21 % sobre el subtotal (simplificado para este ejercicio) |
| Qué incluye el precio | Materiales, mano de obra y limpieza final de la obra |
| Garantía | 2 años en mano de obra |
| Visita técnica | Gratuita. El presupuesto es orientativo hasta confirmar medidas en la visita |
| Numeración (opcional) | P-2026-0001, P-2026-0002… |

## Cómo se calcula el presupuesto

```
Importe estancia   = m² × tarifa[estancia][calidad]
Extra "por m²"     = m² × precio del extra
Extra "fijo"       = precio del extra (una vez)

Subtotal = importe estancia + Σ extras
IVA      = 21 % del subtotal
Total    = subtotal + IVA
```

Los importes salen siempre de estas tablas. La IA solo redacta texto.

## Caso de prueba

Con este caso se comprueba que las cuentas del flujo son correctas.

**Entrada:** Marta Puig · baño · 6 m² · calidad media · extras: demolición y fontanería nueva.
**Lo que pidió:** «Quiero cambiar la bañera por un plato de ducha grande y poner un mueble con dos lavabos. El baño tiene unos 30 años y las tuberías son las originales.»

| Concepto | Cantidad | Precio unitario | Importe |
|---|---:|---:|---:|
| Reforma de baño · calidad media | 6 m² | 880 € | 5.280 € |
| Demolición y retirada de escombros | 6 m² | 35 € | 210 € |
| Fontanería nueva | 1 ud. | 1.200 € | 1.200 € |
| **Subtotal** | | | **6.690 €** |
| **IVA (21 %)** | | | **1.404,90 €** |
| **Total** | | | **8.094,90 €** |

Plazo estimado: 2–3 semanas.

## Formato del presupuesto

El presupuesto de ejemplo ([PDF](Contexto/reformas-barcelona-presupuesto-ejemplo.pdf)) tiene esta estructura:

1. **Cabecera:** logo, «REFORMAS BARCELONA · Reformas integrales desde 1998» y datos de contacto, separados por una línea terracota.
2. **Título:** «Presupuesto de reforma de {estancia}», número (`P-2026-0147`) y fecha.
3. **Datos del cliente:** nombre, email y dirección de la obra.
4. **Saludo y resumen** personalizado (IA): «Hola Marta: Muchas gracias por contactar con Reformas Barcelona…».
5. **Descripción de los trabajos** (IA): lista de los trabajos según lo que pidió el cliente, los extras y la calidad.
6. **Tabla de partidas:** concepto, cantidad, precio unitario e importe, seguida del subtotal, el IVA y el total (el total en terracota).
7. **Plazo estimado.**
8. **Condiciones.**
9. **Firma:** «Un saludo, Jordi Ferrer, Gerente · Reformas Barcelona».

Formato de números: separador de miles con punto y decimales con coma (`8.094,90 €`).

## Extras opcionales

No son obligatorios. Se puede elegir cualquiera o proponer otros:

- **Enviarlo por correo:** que el cliente reciba también el presupuesto en su email.
- **Descargarlo en PDF:** un botón para guardar el presupuesto con la imagen de la empresa.
- **Guardar cada solicitud:** apuntar cada presupuesto en una hoja de Google para el gerente.
- **Varias estancias:** pedir, por ejemplo, baño y cocina en una misma solicitud.
- **Si algo falla:** mostrar al cliente un mensaje de error claro.
- **Cualquier otra idea** que la empresa o sus clientes puedan valorar.

## Puesta en marcha (gratis)

Todo el proyecto se puede hacer sin pagar nada. Si algún servicio pide tarjeta o un pago, para y consulta con NU Automatiza, que tienen una alternativa.

### A · n8n Cloud (prueba gratuita de 14 días, sin tarjeta)

1. Regístrate en [app.n8n.cloud/register](https://app.n8n.cloud/register) con tu email o tu cuenta de Google.
2. Elige la prueba gratuita de 14 días.
3. Ponle nombre a tu espacio (será `tunombre.app.n8n.cloud`).
4. Crea un workflow nuevo que empiece con un nodo **Webhook**.

Alternativa: instalar n8n en local (`npx n8n` o Docker). En ese caso la web solo funciona en tu equipo y habrá que enseñarla compartiendo pantalla, por eso se recomienda n8n Cloud.

### B · IA

- **Opción 1, créditos gratis de n8n:** acepta el aviso de «free AI credits» en n8n Cloud y, en el nodo de OpenAI, elige esa credencial y un modelo pequeño (por ejemplo, `gpt-4.1-mini`). No necesitas cuenta de OpenAI.
- **Opción 2, Gemini gratis:** crea una clave en [aistudio.google.com/apikey](https://aistudio.google.com/apikey) y úsala en el nodo de Google Gemini con un modelo Flash. En el plan gratuito, Google puede usar los datos enviados para mejorar sus modelos. Aquí no importa porque los datos son inventados.

### C · Publicar la web

| Servicio | Cómo |
|---|---|
| **Vercel** (recomendado) | Sube la web a GitHub y, en Vercel, elige *Add New → Project*, importa el repositorio y pulsa *Deploy*. Te da un enlace `tu-proyecto.vercel.app`. |
| Netlify | Arrastra la carpeta de la web a [app.netlify.com/drop](https://app.netlify.com/drop). |
| GitHub Pages | En el repositorio: *Settings → Pages*, elige la rama. |

## Problemas habituales

| Problema | Solución |
|---|---|
| La web solo llega a n8n mientras pruebo | La *Test URL* solo funciona cuando n8n está escuchando una prueba. Activa el workflow y usa la **Production URL** en la web. |
| Error de CORS en la consola | En el nodo Webhook, en *Options → Allowed Origins (CORS)*, pon la URL de tu web (o `*` mientras pruebas). |
| La web no recibe la respuesta | En el nodo Webhook, en *Respond*, elige *Using 'Respond to Webhook' Node* y añade ese nodo al final del flujo. |
| La IA cambia o inventa precios | Calcula los importes en el flujo antes de llamar a la IA, pídele solo los textos y pinta la tabla en la web con los números del flujo. |
| Se acaban los créditos de IA | Cambia a Gemini (opción 2). |
| ¿Otra herramienta en vez de n8n? | Se prefiere n8n, ya que aprender a usarlo forma parte del ejercicio. Para la web se puede usar cualquier tecnología. |

## Entrega y criterios de evaluación

- **Tiempo estimado:** 2–3 horas.
- **No hay que entregar nada antes:** el trabajo se presenta en una reunión de 1 hora. Si se quiere, se puede enviar antes el enlace a la web.

**Cómo será la reunión**

1. Enseñas la web funcionando (compartiendo pantalla).
2. Enseñas el flujo de n8n por dentro y explicas cómo lo has pensado.
3. Unas últimas preguntas sobre el caso y sobre ti.
4. Tus preguntas sobre NU Automatiza y las prácticas.

**Qué se valora**

- ✅ Que funcione de principio a fin, del formulario al presupuesto, sin pasos a mano.
- ✅ Que se vea bien y sea fácil de usar para un cliente que no es técnico.
- ✅ Que el flujo tenga sentido: claro, ordenado y con la IA donde aporta.
- ✅ Tu implicación: los detalles y lo que añadas por tu cuenta.
- ✅ Cómo lo explicas: que se entienda qué has hecho y por qué.

Los datos de contacto y el enlace para reservar la reunión están en la última página de [`caso-practico-nu-automatiza.pdf`](Contexto/caso-practico-nu-automatiza.pdf).

## Material de referencia

| Archivo | Para qué sirve |
|---|---|
| [`Contexto/caso-practico-nu-automatiza.pdf`](Contexto/caso-practico-nu-automatiza.pdf) | El enunciado: qué construir y cómo hacerlo gratis. |
| [`Contexto/reformas-barcelona-datos.xlsx`](Contexto/reformas-barcelona-datos.xlsx) | Datos de la empresa: tarifas, extras, plazos, condiciones, colores y un ejemplo de cálculo. |
| [`Contexto/reformas-barcelona-presupuesto-ejemplo.pdf`](Contexto/reformas-barcelona-presupuesto-ejemplo.pdf) | Un presupuesto real hecho a mano. Es el resultado que tiene que salir. |
| `reformas-barcelona-logo` (.svg y .png) | El logo en color y en blanco. Lo menciona el enunciado, pero **todavía no está en el repositorio**. |

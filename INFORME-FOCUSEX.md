# Informe general de FOCUSEX

## Alcance

FOCUSEX es una aplicación web personal de productividad construida con HTML, CSS y JavaScript vanilla. No utiliza framework ni dependencias de ejecución. La interfaz y los datos se ejecutan en el navegador; el estado persistente se almacena en `localStorage`.

Este informe describe las funciones implementadas en el código actual y señala las limitaciones encontradas. No reemplaza ni duplica los archivos fuente:

- [Focus.html](./Focus.html): documento, estructura, navegación, pantallas, formularios y controles.
- [App.js](./App.js): almacenamiento, reglas, operaciones, cálculos, renderizados y eventos de interfaz.
- [Style.css](./Style.css): identidad visual Black Diamond, componentes, animaciones y reglas responsive.

### Supabase

La aplicación admite cuentas por correo y contraseña, aislamiento de datos por usuario mediante RLS, sincronización de hábitos/tareas y persistencia de progreso global. La configuración pública del proyecto está en `src/config/supabase-config.js`. Antes de usar la integración, ejecuta [`supabase-schema.sql`](./supabase-schema.sql) en el SQL Editor de Supabase y habilita Email en Authentication. La clave `sb_publishable_...` puede usarse en el navegador; nunca incluyas una clave secreta.

El proyecto contiene aproximadamente 825 líneas de HTML, 3.288 líneas de JavaScript y 1.798 líneas de CSS. Las cifras cambian al editar los archivos.

## Resumen ejecutivo

La aplicación reúne seis secciones: Dashboard, Hábitos, Tareas, Agenda, Analytics y Logros. Permite gestionar hábitos y tareas, registrar completaciones, otorgar y retirar XP asociado, calcular progreso y rachas, consultar un calendario mensual y desbloquear logros. Analytics calcula indicadores y gráficos a partir de los historiales fuente, sin guardar un segundo conjunto de estadísticas.

La interfaz usa una paleta monocromática oscura, tipografía Inter, paneles negros, bordes grises y acentos claros. En pantallas estrechas, la navegación se convierte en una barra superior desplazable y las grillas se reorganizan.

## Mapa de archivos y código

### `Focus.html`

Define el punto de entrada de la aplicación:

1. Metadatos, título, viewport y carga de la tipografía Inter.
2. Sidebar con acceso a las seis secciones y tarjetas compactas de racha y XP.
3. Barra superior con título, fecha y avatar.
4. Una sección HTML por área funcional.
5. Modal y formulario reutilizable para crear y editar tareas o hábitos.
6. Carga de `App.js`.

Los botones de navegación utilizan `data-section`; JavaScript activa la pantalla correspondiente sin navegar ni recargar el documento.

### `App.js`

El archivo se organiza por responsabilidades:

| Bloque | Responsabilidad |
|---|---|
| Datos predeterminados y almacenamiento | Define `STORAGE_KEY`, los datos iniciales y la carga/normalización/guardado en `localStorage`. |
| Fechas e historial | Genera claves diarias y semanales, migra historiales antiguos y registra completaciones. |
| Reglas de hábitos y tareas | Calcula vencimientos, XP, rachas, cumplimiento y límites de frecuencia semanal. |
| Progreso, nivel y rango | Calcula progreso diario, nivel según XP y rango actual. |
| Navegación y modal | Cambia de sección y configura el formulario común de altas y ediciones. |
| Operaciones | Crea, edita, completa, descompleta y elimina tareas o hábitos. |
| Renderizados de pantalla | Actualiza Dashboard, Hábitos, Tareas, Agenda, Analytics y Logros. |
| Analytics | Construye series por fecha, compara periodos y dibuja la visualización SVG y el heatmap. |
| Seguridad de salida | Escapa texto dinámico antes de insertarlo en plantillas HTML. |
| Inicialización | Ejecuta el render inicial y programa una actualización al cambiar de día. |

Funciones destacadas incluyen `loadData`, `saveData`, `normalizeHabit`, `normalizeTask`, `migrateTaskHistory`, `getProgress`, `getLevel`, `getRank`, `calculateStreak`, `calculateBestStreak`, `calculateHabitStreak`, `calculateHabitCompletionRate`, `renderAll` y `renderAnalytics`.

### `Style.css`

Define variables de color y radio en `:root`, estilos de sidebar, navegación, paneles, tarjetas, listas, calendario, gráficas, heatmap, formulario y logros. Incluye animaciones para el cambio de sección y actualización de valores, además de reglas `prefers-reduced-motion` y breakpoints alrededor de 1100, 900 y 750 píxeles.

## Funcionalidades por sección

### Dashboard

- Muestra el progreso de hoy y su barra visual.
- Muestra racha actual, XP total, nivel y rango.
- Muestra el avance hacia el siguiente rango.
- Incluye un gráfico del historial de progreso con selector de 7, 14 o 30 días.
- Presenta una lista resumida de hábitos y tareas pendientes.
- Permite abrir el modal de alta rápida de hábito.
- La racha diaria se basa en días consecutivos cuyo progreso guardado es al menos 50%.
- El nivel aumenta cada 1.000 XP. Los rangos usan umbrales fijos desde NOVICE hasta FOCUSEX.

### Hábitos

- Crear hábitos diarios o semanales.
- Configurar objetivo semanal, XP, descripción y objetivo numérico opcional.
- Completar/descompletar el hábito del día; un hábito semanal no se puede marcar si ya alcanzó su objetivo semanal.
- Editar y eliminar hábitos.
- Mostrar hábitos de hoy, cumplimiento, racha individual y un historial visual de 14 días.
- Mostrar resumen e historial diario de los últimos 14 días.
- El cumplimiento histórico de hábitos diarios se calcula desde `createdOn`. En hábitos semanales se calcula por semanas que alcanzaron el objetivo.

### Tareas

- Crear, editar, completar/descompletar y eliminar tareas.
- Configurar XP, prioridad baja/media/alta, descripción y fecha de vencimiento.
- Filtrar todas, pendientes, completadas, por prioridad o vencidas.
- Ordenar pendientes por prioridad y fecha límite.
- Mostrar resumen, tareas vencidas, racha de tareas y progreso.
- Al completar, registrar fecha, XP e historial; al descompletar, revertir la XP de la finalización.

### Agenda

- Calendario mensual con navegación entre meses y acceso a hoy.
- Selección de día y listado de hábitos completados y tareas programadas para esa fecha.
- Una tarea aparece en la Agenda por fecha de vencimiento; se indica si está pendiente o completada.
- Las marcas de calendario señalan tareas programadas o hábitos completados; programar una tarea no la completa.

### Analytics

- Periodos: 7 días, 30 días, 90 días y todo el tiempo.
- KPIs de productividad, tareas completadas en el periodo, racha actual, mejor racha, XP del periodo, XP total y cumplimiento de hábitos.
- Resumen de tareas: tareas activas, completaciones del periodo, pendientes actuales, tasa calculada para tareas con historial dentro del periodo, vencidas actuales y XP de tarea del periodo.
- Desglose por prioridad en formato completadas / tareas activas.
- Resumen de hábitos: activos, completaciones, cumplimiento, XP y acceso a las rachas individuales.
- Ranking de hábitos por porcentaje de consistencia; los empates se ordenan por nombre. Muestra completaciones, XP y racha actual/mejor por hábito.
- Gráfica SVG con selector de Actividad, XP, Tareas o Hábitos; presenta escala y etiquetas temporales y muestra detalles al pasar sobre puntos.
- Heatmap de actividad diaria que sigue el periodo seleccionado.
- Mejores días, ordenados por actividad completada; empates por fecha.
- Tendencia entre primera y segunda mitad, comparando la media de actividades por día. Usa los estados positiva, estable, negativa o datos insuficientes.
- Comparación contra el intervalo anterior de igual duración para tareas, hábitos, XP y actividad. Para Todo el tiempo se informa que no hay intervalo previo equivalente.
- Mensajes vacíos y valores seguros para reducir resultados engañosos cuando falta historial.

#### Fórmulas de Analytics

- **Actividad diaria** = tareas completadas ese día + hábitos completados ese día.
- **Tendencia** = comparación entre la media diaria de actividad en la primera y segunda mitad del periodo. Los cambios por encima de +5% se clasifican como positivos; por debajo de -5% como negativos; el resto, estables. Si no hay actividad suficiente, se informa explícitamente.
- **Productividad** = tasa de finalización de tareas × 40% + cumplimiento de hábitos × 40% + proporción de días activos × 20%. Si una categoría no tiene datos, sus pesos se normalizan entre las categorías disponibles. Sin datos utilizables, se muestra “—”.
- **Comparación porcentual** = `(actual - anterior) / anterior × 100`. Si el valor anterior es cero, se indica “Nuevo” con el incremento absoluto o “0% · sin cambio”.
- El XP por día suma XP de historiales de tareas y de los registros de completación de hábitos.

### Logros

- Diez logros definidos en el código, incluyendo primera actividad, rachas, umbrales de XP y objetivos de tareas.
- Muestra progreso, desbloqueos y XP asociado.
- Las recompensas se acreditan una sola vez y se persiste el desbloqueo en `achievements`.
- Se conserva el conjunto de logros en el estado guardado, junto con la recompensa correspondiente.

## Modelo de datos persistente

La clave principal de almacenamiento es `focusex_data`.

| Campo | Contenido |
|---|---|
| `habits` | Hábitos, frecuencia, objetivo semanal, fecha de creación y mapa `completions` indexado por fecha. |
| `tasks` | Tareas, XP, prioridad, vencimiento, estado y fechas de completación. |
| `taskHistory` | Completaciones de tareas por fecha, con identificador y XP registrado. |
| `history` | Progreso agregado diario utilizado, entre otras cosas, por Dashboard y rachas generales. |
| `totalXP` | XP total actual; puede incluir XP de tareas, hábitos y recompensas de logros. |
| `streak`, `bestStreak` | Valores derivados/almacenados para la racha general de progreso. |
| `achievements` | Indicadores persistidos de logros desbloqueados. |
| `createdAt` | Fecha inicial del registro de usuario. |

Analytics no persiste sus propias estadísticas; vuelve a calcularlas a partir de tareas, hábitos e historiales.

## Integración entre sistemas

- Completar una tarea actualiza su estado, fecha, historial y XP, luego guarda y renderiza la aplicación.
- Completar un hábito registra su XP y la fecha, guarda y renderiza la aplicación.
- Descompletar revierte el XP del elemento y elimina la entrada correspondiente del historial.
- Cambios de tareas y hábitos se reflejan en Analytics porque `renderAll()` vuelve a calcular las métricas.
- Logros se sincronizan después de guardar el progreso y pueden conceder XP.
- La Agenda usa fechas de tareas y completaciones de hábitos; Analytics solo considera las completaciones registradas, no eventos planificados.

## Diseño y responsive

- Identidad Black Diamond monocromática con fondos casi negros, tarjetas oscuras, texto claro y bordes grises.
- Tipografía Inter; se solicita desde Google Fonts. La app no carga frameworks ni librerías JavaScript externas.
- Sidebar fija en escritorio y navegación horizontal desplazable en móvil.
- Las grillas de Analytics se reorganizan en breakpoints; los controles de gráfica se adaptan al ancho móvil.
- Se detectó que, en el navegador usado para la validación, los anchos de viewport se reportaron como 1265, 1009, 753 y 375 px para solicitudes de 1280, 1024, 768 y 390 px, respectivamente, por el área de contenido del navegador.

## Seguridad y robustez observables

- Texto dinámico para nombres y descripciones se escapa con `escapeHTML` antes de insertarse en plantillas.
- Se normalizan hábitos y tareas al cargar y se migra `taskHistory` desde registros antiguos.
- Se validan valores numéricos en el formulario y fechas de vencimiento válidas.
- Se limita la carga del gráfico a un marcador cada cierto número de puntos para periodos históricos grandes.

## Limitaciones actuales

1. **No hay eventos en Agenda.** El modelo guardado, la interfaz y las operaciones actuales no contienen un sistema de creación o completación de eventos. Analytics no los incluye ni los inventa.
2. **No existe historial de prioridades.** El desglose por prioridad usa la prioridad actual de cada tarea activa; un cambio de prioridad no actualiza retrospectivamente la categoría histórica.
3. **Las tareas eliminadas no están disponibles para todos los desgloses históricos.** Aunque algunos registros por fecha puedan conservarse, ya no hay datos de tarea suficientes para reconstruir nombre o prioridad.
4. **Las tareas vencidas describen el estado actual.** No existe un historial de cuándo una tarea quedó vencida o dejó de estarlo.
5. **El XP total incluye recompensas de logros.** El historial por día separa XP de tarea y hábito; el modelo no atribuye de forma diaria todas las recompensas de logros.
6. **Persistencia local.** Los datos quedan en el almacenamiento del navegador y no se sincronizan entre dispositivos ni usuarios.
7. **Carga de tipografía.** Inter se solicita a Google Fonts; sin red puede aplicarse una fuente alternativa del sistema.
8. No se encontró una suite automatizada ni un manifiesto de dependencias/build en el directorio revisado. La validación documentada se hizo en navegador y con diagnósticos de archivo.

## Validaciones funcionales documentadas

En el navegador se probaron:

- Cambio de periodo entre 7, 30, 90 días y Todo el tiempo.
- Cambio de métrica del gráfico a Actividad, XP, Tareas y Hábitos.
- Estado sin historial y mensajes de insuficiencia de datos.
- Completar y descompletar tareas y hábitos; la cifra de actividad y XP se actualizó y revirtió.
- Alta, edición y eliminación de tareas y hábitos.
- Filtros de tareas: todas, pendientes, completadas, prioridades y vencidas.
- Persistencia tras recargar y recálculo de Analytics desde el estado almacenado.
- Navegación entre las seis secciones.
- Agenda mensual y selección de hoy.
- Persistencia visual de Logros tras recargar.
- Responsive en 1280, 1024, 768 y 390 px; no se observó scroll horizontal en esas pruebas.
- En el pase final no hubo errores `pageerror` ni errores de consola en los flujos recorridos.

No se pudo probar “crear evento” ni “completar evento”: esas acciones no existen en la aplicación actual.

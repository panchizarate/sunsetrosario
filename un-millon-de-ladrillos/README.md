# Un Millón de Ladrillos

Juego incremental de demolición en **primera persona**. Un predio con una fábrica abandonada: garita, galpón, chimenea, nave, fábrica, una torre de 64 m y el muro perimetral. En total son **exactamente 1.000.000 de ladrillos**, cada uno individual y rompible.

Rompés ladrillos, los escombros caen con física, los juntás con la carretilla y los llevás al volquete. Ahí cobrás y comprás mejoras. Cumpliendo objetivos se desbloquean herramientas: martillo → maza → martillo neumático → bola de demolición (cuelga de la grúa) → explosivos, más aspiradora de escombros, obreros y robots demoledores.

**Derrumbes:** si cortás casi toda una hilada de una pared, todo lo que está arriba se viene abajo.

**Nada se pierde:** ladrillos en pie + escombros en el piso + carretilla + depositados = 1.000.000, siempre.

## Cómo funciona por dentro

- **Paredes "por píxel"**: cada pared es una sola caja. Un shader recorre la grilla de ladrillos (DDA) contra una textura que guarda cuántas capas se rompieron de cada celda. Así hay un millón de ladrillos reales con relieve, mortero, bisel y profundidad, con el costo de dibujar ~30 cajas. La luz del sol entra por ventanas y agujeros (material de sombras propio).
- **Raycast idéntico en CPU** (`bricks.ts`) para saber qué ladrillo golpeás, colisiones que respetan los agujeros (podés pasar por los que abras) y derrumbes por hilada cortada.
- **Escombros** con física simple (`debris.ts`): ladrillos sueltos y montículos de tamaño real. Los montículos valen muchos ladrillos.
- **Gráficos**: cielo atmosférico + iluminación por entorno (PBR), nubes procedurales, sombras suaves, polvo volumétrico con billboards, astillas, destellos y ondas de explosión, bloom, viñeta y corrección de color.
- **Audio 100% procedural** (`audio.ts`): golpes, martillo neumático, derrumbes, explosiones, pasos sobre grava, viento y música generativa que suma capas a medida que avanza la demolición.

## Controles

- **PC:** WASD caminar · mouse mirar (clic para capturar el puntero) · clic golpear · 1-5 o Q herramientas · E mejoras · clic derecho o F detonar · Shift correr · Espacio saltar.
- **Celular:** mitad izquierda = caminar, mitad derecha = mirar, botón amarillo = golpear.

## Ejecutar

```bash
cd un-millon-de-ladrillos
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ estático
```

## Parámetros de prueba (URL)

`?autoplay` saltea el título · `?levels=5` todo desbloqueado en nivel 5 · `?money=N` · `?obj=N` · `?px=..&pz=..&yaw=..` posición inicial · `?quality=0|1|2` · `?timescale=30&norender` simulación acelerada para bots.

## Estado

Probado con un bot que juega solo (acelerado, sin dibujar): derribó todos los edificios y depositó 885.000 ladrillos en unos 105 minutos de juego, sin errores. El muro perimetral (124.416 ladrillos a lo largo de 400 m) es la parte final y la más larga. Falta probar el rendimiento en celulares reales.

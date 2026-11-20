# Cotizador 3D — reglas del proyecto

## Idioma
- Todo en español rioplatense: textos de la web, nombres en el código, comentarios, mensajes de commit y documentación.
- Usar voseo en la interfaz ("elegí", "arrastrá", "probá").

## Diseño
- Minimalista y sobrio: fondo claro, una sola tipografía y un solo color de acento.
- Tiene que verse bien en el celular primero (mobile first), sin scroll horizontal.
- Los gráficos usan tonos del color de acento, no paletas nuevas.

## Privacidad
- Nunca poner datos personales de nadie en el código, el README ni la web (nombres, mails, usuarios, números de serie de impresoras, etc.).
- No mencionar autores del proyecto.
- La carpeta `ejemplos-privados/` está en el `.gitignore` y nunca se sube: los archivos `.3mf` pueden tener datos de la impresora.
- Los archivos del usuario se procesan sólo en el navegador; no se envían a ningún servidor.

## Técnica
- Sitio estático con Vite, sin backend. La lectura de archivos corre en un Web Worker.
- Pruebas del lector: `npm test` (usa `pruebas/` y, si existe, `ejemplos-privados/`).
- Deploy a GitHub Pages con GitHub Actions al hacer push a `main`.

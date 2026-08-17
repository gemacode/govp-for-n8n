# Changelog

## 0.2.1 — 2026-08-17

- trigger firmado validado nativamente en n8n 2.34.6 con callback HTTPS;
- caché acotada por proceso para rechazar replay inmediato, complementaria al
  historial estático del workflow y al almacén duradero recomendado;
- aceptación reproducible de alta, entrega, ejecución y rechazo `409`.

## 0.2.0 — 2026-08-17

- Trigger nativo que registra y elimina suscripciones de GOVP Exchange.
- Verificación ECDSA contra el registro de claves y rechazo de eventos repetidos.

## 0.1.1 — 2026-08-16

- Compile the community node as CommonJS for native n8n loading.
- Add a reproducible native acceptance fixture for installation, execution and idempotent replay.

## 0.1.0 - 2026-08-16

- credencial GOVP Exchange con token protegido;
- operaciones Issue, Verify y Revoke;
- idempotencia, evidencia validada y HTTPS obligatorio;
- soporte `Continue On Fail` y uso como tool de n8n.

# GOVP for n8n

Nodo comunitario open source para fabricar, comprobar y revocar GOVP desde un
workflow n8n sin escribir código.

> Estado `0.1.0`: candidato técnico. El paquete y su contrato están probados,
> pero falta instalarlo y ejecutar un flujo de aceptación en una instancia n8n
> independiente antes de marcar validación nativa.

## Operaciones

- **Issue:** fabrica un GOVP con clave de idempotencia estable;
- **Verify:** recupera estado, integridad y razón pública;
- **Revoke:** revoca un GOVP propiedad del conector con una razón explícita.

La credencial guarda la URL de Exchange y el token del conector como campo de
contraseña. El nodo exige HTTPS fuera de simuladores locales y admite
`Continue On Fail` para que el workflow decida cómo manejar una incidencia.

## Instalación del candidato

Descarga el paquete desde Releases e instálalo en una instancia de prueba:

```bash
npm install ./n8n-nodes-govp-0.1.0.tgz
```

La [documentación oficial de n8n](https://docs.n8n.io/integrations/community-nodes/installation-and-management)
explica la instalación de nodos comunitarios. No instales un candidato en
producción antes de completar la aceptación nativa.

## Credentials

1. Crea o recibe una credencial de conector `n8n` en GOVP Exchange.
2. Añade `GOVP Exchange API` en n8n.
3. Introduce la URL de Exchange y el token; n8n prueba `/connectors/me`.
4. Limita quién puede usar y editar esa credencial dentro del proyecto n8n.

No incluyas el token en parámetros, expresiones, logs ni exportaciones del
workflow.

## Idempotencia

El valor predeterminado distingue ejecución e ítem, pero un flujo reintentable
debe usar una referencia de negocio estable, por ejemplo:

```text
shipment:{{$json.deliveryId}}
```

Así, repetir el workflow no fabrica un segundo GOVP para la misma operación.

## Desarrollo

```bash
npm install
npm run check
npm pack
```

El paquete sigue los ficheros base y de credenciales documentados por n8n y
publica únicamente `dist`, README y licencia.

## Licencia

Apache-2.0. GOVP for n8n no está afiliado ni certificado por n8n GmbH.

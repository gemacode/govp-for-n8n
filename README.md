# GOVP for n8n

Nodo comunitario open source para fabricar, comprobar y revocar GOVP desde un
workflow n8n sin escribir código.

> Estado `0.2.0`: listo para piloto. El nodo de acciones se ha instalado y ejecutado
> en n8n 2.34.6; la aceptación nativa comprueba emisión e idempotencia con dos
> ejecuciones consecutivas.

## Operaciones

- **Issue:** fabrica un GOVP con clave de idempotencia estable;
- **Verify:** recupera estado, integridad y razón pública;
- **Revoke:** revoca un GOVP propiedad del conector con una razón explícita.
- **GOVP Trigger:** activa el workflow con eventos firmados de emisión,
  comprobación, revocación o sustitución.

La credencial guarda la URL de Exchange y el token del conector como campo de
contraseña. El nodo exige HTTPS fuera de simuladores locales y admite
`Continue On Fail` para que el workflow decida cómo manejar una incidencia.

## Instalación

Descarga el paquete desde Releases e instálalo en una instancia de prueba:

```bash
npm install ./n8n-nodes-govp-0.2.0.tgz
```

La [documentación oficial de n8n](https://docs.n8n.io/integrations/community-nodes/installation-and-management)
explica la instalación de nodos comunitarios. Completa primero un piloto con
credenciales y datos no productivos de tu organización.

## Credentials

1. Crea o recibe una credencial de conector `n8n` en GOVP Exchange.
2. Añade `GOVP Exchange API` en n8n.
3. Introduce la URL de Exchange y el token; n8n prueba `/connectors/me`.
4. Limita quién puede usar y editar esa credencial dentro del proyecto n8n.

No incluyas el token en parámetros, expresiones, logs ni exportaciones del
workflow.

Al activar un `GOVP Trigger`, n8n registra su URL HTTPS en Exchange. Cada
notificación se compara con la clave pública activa o retirada publicada por
Exchange, se valida criptográficamente y se rechaza si está caducada o ya fue
vista por el nodo. En producción, el workflow debe conservar además
`event.id` en un almacén con unicidad duradera para garantizar replay atómico.

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

La aceptación nativa requiere Docker, Node.js y OpenSSL. Genera primero el
paquete y ejecuta:

```bash
bash tests/native/run.sh
```

La prueba levanta un Exchange HTTPS local con certificado efímero, instala el
paquete en el runtime oficial de n8n y exige una primera emisión seguida de una
repetición idempotente. No usa secretos ni servicios de producción.

## Licencia

Apache-2.0. GOVP for n8n no está afiliado ni certificado por n8n GmbH.

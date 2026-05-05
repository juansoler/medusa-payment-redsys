/**
 * Human-readable Spanish error messages for REDSYS response codes.
 */
export function getErrorMessage(code: number | string): string {
  const codeStr = String(code)
  const errorMessages: Record<string, string> = {
    "101": "Tarjeta caducada o con límite excedido",
    "102": "Tarjeta en sospecha de fraude",
    "104": "Operación no permitida para esta tarjeta",
    "106": "Tarjeta caducada",
    "107": "Operación no permitida para este comercio",
    "109": "Comercio no operativo temporalmente",
    "110": "Importe excede el límite permitido",
    "114": "Tipo de operación no permitida",
    "116": "Saldo insuficiente",
    "118": "Tarjeta no registrada",
    "129": "Código de seguridad (CVV2) incorrecto",
    "180": "Tarjeta no válida",
    "190": "Denegación sin especificar",
    "191": "Fecha de caducidad incorrecta",
    "195": "Requiere autenticación SCA",
    "202": "Tarjeta en sospecha de fraude con denegación",
    "904": "Comercio no registrado",
    "909": "Error de sistema",
    "913": "Pedido repetido",
    "944": "Sesión incorrecta",
    "950": "Operación de devolución no permitida",
    "9064": "Número de tarjeta incorrecto",
    "9078": "Tipo de operación no permitida",
    "9093": "Tarjeta no existente",
    "9094": "Servicio no disponible para esta tarjeta",
    "9104": "Comercio no operativo",
    "9218": "Operación no permitida",
    "9253": "Tarjeta bloqueada",
    "9256": "Tarjeta no permite operaciones de preautorización",
    "9257": "Tarjeta no permite operaciones de devolución",
    "9261": "Límite de reintentos de pago superado",
    "9912": "Emisor no disponible",
    "9915": "Cancelación automática por timeout",
    "9928": "Anulación de autorización no permitida",
    "9998": "Operación no permitida (AVS)",
    "9999": "Autenticación requerida",
  }
  return errorMessages[codeStr] || `Transacción denegada (código: ${codeStr})`
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN: crear-pago
// Qué hace: Cuando un cliente da "Pagar", genera un link de pago
//           de Mercado Pago con el total del carrito
// ═══════════════════════════════════════════════════════════════

exports.handler = async (event) => {
  // Solo aceptar POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Método no permitido' };
  }

  // CORS headers (permite que tu página le hable a esta función)
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  try {
    const { pedido_id, items, total, email, nombre } = JSON.parse(event.body);

    // Validar datos mínimos
    if (!pedido_id || !items || !total) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Datos incompletos' }) };
    }

    // Leer el Access Token de Mercado Pago (variable de entorno)
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    if (!MP_ACCESS_TOKEN) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'MP_ACCESS_TOKEN no configurado' }) };
    }

    // Construir los items en formato Mercado Pago
    const mpItems = items.map(it => ({
      title: `${it.name} - Talla ${it.size} - ${it.color}`,
      quantity: it.qty,
      unit_price: it.price,
      currency_id: 'COP'
    }));

    // URL de tu sitio (para el retorno)
    const SITE_URL = process.env.SITE_URL || 'https://zapatosya.com';

    // Crear preferencia de pago
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: mpItems,
        payer: { email: email || undefined, name: nombre || undefined },
        external_reference: pedido_id, // ID del pedido en Supabase
        back_urls: {
          success: `${SITE_URL}/?pago=exitoso`,
          pending: `${SITE_URL}/?pago=pendiente`,
          failure: `${SITE_URL}/?pago=fallido`
        },
        auto_return: 'approved',
        notification_url: `${SITE_URL}/.netlify/functions/webhook-pago`,
        statement_descriptor: 'ZAPATOSYA'
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Error MP:', data);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Error creando preferencia', detail: data }) };
    }

    // Devolver el link de pago al frontend
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        init_point: data.init_point, // URL para producción
        sandbox_init_point: data.sandbox_init_point, // URL para pruebas
        preference_id: data.id
      })
    };

  } catch (err) {
    console.error('Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN: webhook-pago
// Qué hace: Mercado Pago llama a esta función cuando alguien paga
//           o cambia el estado de un pago. Actualiza el pedido
//           en Supabase automáticamente.
// ═══════════════════════════════════════════════════════════════

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    // Mercado Pago envía notificaciones por POST
    if (event.httpMethod !== 'POST') {
      return { statusCode: 200, headers, body: 'OK' };
    }

    const body = JSON.parse(event.body || '{}');
    console.log('Webhook recibido:', JSON.stringify(body));

    // Solo nos interesan notificaciones de tipo "payment"
    if (body.type !== 'payment') {
      return { statusCode: 200, headers, body: JSON.stringify({ ignored: true }) };
    }

    const paymentId = body.data?.id;
    if (!paymentId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Sin payment id' }) };
    }

    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!MP_ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Variables de entorno faltan' }) };
    }

    // Consultar el pago a Mercado Pago
    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const payment = await paymentRes.json();

    if (!paymentRes.ok) {
      console.error('Error consultando pago:', payment);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Error consultando pago MP' }) };
    }

    // external_reference es el ID del pedido en Supabase
    const pedidoId = payment.external_reference;
    const status = payment.status; // approved, pending, rejected, etc

    // Mapear estado de MP a estado de nuestro pedido
    let nuevoEstado;
    let metodoPago = payment.payment_method_id || 'mercadopago';
    switch (status) {
      case 'approved':
        nuevoEstado = 'confirmado';
        break;
      case 'pending':
      case 'in_process':
        nuevoEstado = 'pendiente';
        break;
      case 'rejected':
      case 'cancelled':
        nuevoEstado = 'cancelado';
        break;
      default:
        nuevoEstado = 'pendiente';
    }

    // Actualizar el pedido en Supabase
    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        estado: nuevoEstado,
        metodo_pago: metodoPago
      })
    });

    if (!updateRes.ok) {
      const errTxt = await updateRes.text();
      console.error('Error actualizando pedido:', errTxt);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Error actualizando pedido', detail: errTxt }) };
    }

    console.log(`Pedido ${pedidoId} actualizado a: ${nuevoEstado}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, pedido_id: pedidoId, estado: nuevoEstado })
    };

  } catch (err) {
    console.error('Error webhook:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

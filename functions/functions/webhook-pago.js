// ═══════════════════════════════════════════════════════════════
// Cloudflare Pages Function: webhook-pago
// Path: /functions/webhook-pago.js
// Endpoint: https://zapatosya.com/webhook-pago
// ═══════════════════════════════════════════════════════════════

export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const body = await request.json().catch(() => ({}));
    console.log('Webhook recibido:', JSON.stringify(body));

    if (body.type !== 'payment') {
      return new Response(JSON.stringify({ ignored: true }), { status: 200, headers });
    }

    const paymentId = body.data?.id;
    if (!paymentId) {
      return new Response(JSON.stringify({ error: 'Sin payment id' }), { status: 400, headers });
    }

    const MP_ACCESS_TOKEN = env.MP_ACCESS_TOKEN;
    const SUPABASE_URL = env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

    if (!MP_ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return new Response(JSON.stringify({ error: 'Variables de entorno faltan' }), { status: 500, headers });
    }

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const payment = await paymentRes.json();

    if (!paymentRes.ok) {
      console.error('Error consultando pago:', payment);
      return new Response(JSON.stringify({ error: 'Error consultando pago MP' }), { status: 500, headers });
    }

    const pedidoId = payment.external_reference;
    const status = payment.status;
    const metodoPago = payment.payment_method_id || 'mercadopago';

    let nuevoEstado;
    switch (status) {
      case 'approved': nuevoEstado = 'confirmado'; break;
      case 'pending':
      case 'in_process': nuevoEstado = 'pendiente'; break;
      case 'rejected':
      case 'cancelled': nuevoEstado = 'cancelado'; break;
      default: nuevoEstado = 'pendiente';
    }

    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ estado: nuevoEstado, metodo_pago: metodoPago })
    });

    if (!updateRes.ok) {
      const errTxt = await updateRes.text();
      console.error('Error actualizando pedido:', errTxt);
      return new Response(JSON.stringify({ error: 'Error actualizando pedido' }), { status: 500, headers });
    }

    console.log(`Pedido ${pedidoId} actualizado a: ${nuevoEstado}`);
    return new Response(JSON.stringify({ ok: true, pedido_id: pedidoId, estado: nuevoEstado }), { status: 200, headers });

  } catch (err) {
    console.error('Error webhook:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

// Aceptar también GET para verificación de Mercado Pago
export async function onRequestGet() {
  return new Response('webhook-pago OK', { status: 200 });
}

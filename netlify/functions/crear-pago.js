// ═══════════════════════════════════════════════════════════════
// Cloudflare Pages Function: crear-pago
// Path: /functions/crear-pago.js
// Endpoint: https://zapatosya.com/crear-pago
// ═══════════════════════════════════════════════════════════════

export async function onRequestPost(context) {
  const { request, env } = context;
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  try {
    const body = await request.json();
    const { pedido_id, items, total, email, nombre } = body;
    
    console.log('crear-pago iniciado, pedido:', pedido_id, 'total:', total);

    if (!pedido_id || !items || !total) {
      return new Response(JSON.stringify({ error: 'Datos incompletos' }), { status: 400, headers });
    }

    const MP_ACCESS_TOKEN = env.MP_ACCESS_TOKEN;
    if (!MP_ACCESS_TOKEN) {
      return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN no configurado' }), { status: 500, headers });
    }

    const mpItems = items.map(it => ({
      title: `${it.name} - Talla ${it.size} - ${it.color}`,
      quantity: it.qty,
      unit_price: it.price,
      currency_id: 'COP'
    }));

    const SITE_URL = env.SITE_URL || 'https://zapatosya.com';

    const bodyMP = {
      items: mpItems,
      external_reference: pedido_id,
      back_urls: {
        success: `${SITE_URL}/?pago=exitoso`,
        pending: `${SITE_URL}/?pago=pendiente`,
        failure: `${SITE_URL}/?pago=fallido`
      },
      auto_return: 'approved',
      notification_url: `${SITE_URL}/webhook-pago`,
      statement_descriptor: 'ZAPATOSYA'
    };

    if (email) {
      bodyMP.payer = { email: email };
      if (nombre) bodyMP.payer.name = nombre;
    }

    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyMP)
    });

    const data = await response.json();
    console.log('MP status:', response.status);

    if (!response.ok) {
      console.error('Error MP:', JSON.stringify(data));
      return new Response(JSON.stringify({ 
        error: 'Error Mercado Pago',
        mp_status: response.status,
        mp_message: data.message || 'Sin mensaje',
        mp_detail: data
      }), { status: 500, headers });
    }

    console.log('Pago creado OK:', data.id);
    return new Response(JSON.stringify({
      init_point: data.init_point,
      sandbox_init_point: data.sandbox_init_point,
      preference_id: data.id
    }), { status: 200, headers });

  } catch (err) {
    console.error('Error catch:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

// Manejar preflight CORS
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN: crear-pago (versión mejorada con logs detallados)
// ═══════════════════════════════════════════════════════════════

exports.handler = async (event) => {
  console.log('=== crear-pago INICIADO ===');
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Método no permitido' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  try {
    const { pedido_id, items, total, email, nombre } = JSON.parse(event.body);
    console.log('Datos recibidos:', { pedido_id, total, email, items_count: items?.length });

    if (!pedido_id || !items || !total) {
      console.error('FALTAN DATOS');
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Datos incompletos' }) };
    }

    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    if (!MP_ACCESS_TOKEN) {
      console.error('NO HAY TOKEN');
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'MP_ACCESS_TOKEN no configurado' }) };
    }
    
    console.log('Token OK, primeros chars:', MP_ACCESS_TOKEN.substring(0, 15) + '...');

    const mpItems = items.map(it => ({
      title: `${it.name} - Talla ${it.size} - ${it.color}`,
      quantity: it.qty,
      unit_price: it.price,
      currency_id: 'COP'
    }));

    const SITE_URL = process.env.SITE_URL || 'https://zapatosya.com';
    
    const bodyMP = {
      items: mpItems,
      external_reference: pedido_id,
      back_urls: {
        success: `${SITE_URL}/?pago=exitoso`,
        pending: `${SITE_URL}/?pago=pendiente`,
        failure: `${SITE_URL}/?pago=fallido`
      },
      auto_return: 'approved',
      notification_url: `${SITE_URL}/.netlify/functions/webhook-pago`,
      statement_descriptor: 'ZAPATOSYA'
    };
    
    if (email) {
      bodyMP.payer = { email: email };
      if (nombre) bodyMP.payer.name = nombre;
    }
    
    console.log('Enviando a MP...');

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
      console.error('=== ERROR MP ===');
      console.error('Status:', response.status);
      console.error('Response:', JSON.stringify(data));
      return { 
        statusCode: 500, 
        headers, 
        body: JSON.stringify({ 
          error: 'Error Mercado Pago', 
          mp_status: response.status,
          mp_message: data.message || data.error || 'Sin mensaje',
          mp_detail: data
        }) 
      };
    }

    console.log('=== PAGO CREADO OK ===');
    console.log('Preference ID:', data.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        init_point: data.init_point,
        sandbox_init_point: data.sandbox_init_point,
        preference_id: data.id
      })
    };

  } catch (err) {
    console.error('=== ERROR CATCH ===');
    console.error(err.message);
    console.error(err.stack);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// ═══════════════════════════════════════════════════════════════
// Cloudflare Pages Function: webhook-pago
// Path: /functions/webhook-pago.js
// Endpoint: https://zapatosya.com/webhook-pago
// ═══════════════════════════════════════════════════════════════

// ─── Helper: Enviar notificación de PAGO a Telegram ────────────
async function notificarPagoTelegram(env, pedido, payment, nuevoEstado) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('Telegram no configurado');
    return;
  }
  try {
    // Elegir emoji e ícono según el estado
    let titulo, emoji;
    if (nuevoEstado === 'confirmado') {
      titulo = 'PAGO CONFIRMADO ✅';
      emoji = '🎉';
    } else if (nuevoEstado === 'cancelado') {
      titulo = 'PAGO RECHAZADO ❌';
      emoji = '⚠️';
    } else {
      titulo = 'PAGO PENDIENTE ⏳';
      emoji = '🕐';
    }

    const pedidoId = pedido?.id || payment?.external_reference || 'desconocido';
    const total = pedido?.total || payment?.transaction_amount || 0;
    const nombre = pedido?.nombre_cliente || '';
    const telefono = pedido?.telefono || '';
    const direccion = pedido?.direccion_completa || '';
    const metodoPago = payment?.payment_method_id || 'mercadopago';
    const items = pedido?.items || [];

    let msg = `${emoji} *${titulo}*\n`;
    msg += `🧾 Pedido: \`#${String(pedidoId).slice(0,8)}\`\n\n`;
    
    if (nombre) msg += `👤 *Cliente:* ${nombre}\n`;
    if (telefono) msg += `📱 *Teléfono:* ${telefono}\n`;
    if (direccion) msg += `📍 *Dirección:* ${direccion}\n`;
    
    msg += `\n💳 *Método:* ${metodoPago}\n`;
    msg += `💰 *Monto:* $${Number(total).toLocaleString('es-CO')}\n`;
    
    if (items.length) {
      msg += `\n🛍 *Productos:*\n`;
      items.forEach(it => {
        msg += `• ${it.name || 'Producto'}`;
        const detalles = [];
        if (it.size) detalles.push(`Talla ${it.size}`);
        if (it.color) detalles.push(it.color);
        if (detalles.length) msg += ` (${detalles.join(', ')})`;
        msg += ` x${it.qty || 1}\n`;
      });
    }
    
    if (nuevoEstado === 'confirmado') {
      msg += `\n📦 *Acción:* Preparar envío`;
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
    if (!res.ok) console.error('Telegram error:', res.status, await res.text());
    else console.log('Telegram pago OK ✓');
  } catch (e) {
    console.error('Error Telegram pago:', e.message);
  }
}

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

    // 1) Consultar detalles del pago en MP
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

    // 2) Mapear estado de MP al estado interno
    let nuevoEstado;
    switch (status) {
      case 'approved': nuevoEstado = 'confirmado'; break;
      case 'pending':
      case 'in_process': nuevoEstado = 'pendiente'; break;
      case 'rejected':
      case 'cancelled': nuevoEstado = 'cancelado'; break;
      default: nuevoEstado = 'pendiente';
    }

    // 3) Obtener el pedido completo (para poder notificar con datos)
    let pedido = null;
    try {
      const pedRes = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}&select=*`, {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      });
      if (pedRes.ok) {
        const rows = await pedRes.json();
        pedido = rows[0] || null;
      }
    } catch (e) {
      console.warn('No se pudo obtener pedido:', e.message);
    }

    // 4) Actualizar el pedido en Supabase
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

    // 5) 🔔 Notificación a Telegram (no bloqueante)
    context.waitUntil(notificarPagoTelegram(env, pedido, payment, nuevoEstado));

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

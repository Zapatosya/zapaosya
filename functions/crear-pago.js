// ═══════════════════════════════════════════════════════════════
// Cloudflare Pages Function: crear-pago
// Path: /functions/crear-pago.js
// Endpoint: https://zapatosya.com/crear-pago
// Soporta: Pago completo y Contraentrega (solo cobra envío)
//
// 🔒 SEGURIDAD: Los precios SE RECALCULAN desde Supabase para evitar
// que el cliente manipule el carrito en su navegador (cart[0].price=1)
// ═══════════════════════════════════════════════════════════════

function fmtCop(n){
  return '$' + (Number(n)||0).toLocaleString('es-CO');
}

// ─── Helper: Enviar notificación a Telegram ────────────────────
async function notificarTelegram(env, datos) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('Telegram no configurado');
    return;
  }
  try {
    const { pedido_id, items_originales, total_productos, total_envio, total_general, email, nombre, telefono, direccion, metodo_pago, saldo_pendiente } = datos;
    
    const esContraentrega = metodo_pago === 'contraentrega';
    
    let msg = `*NUEVO PEDIDO* \`#${String(pedido_id).slice(0,8)}\`\n`;
    if (esContraentrega) {
      msg += `*Método:* CONTRAENTREGA\n`;
      msg += `_Esperando pago del envío_\n\n`;
    } else {
      msg += `*Método:* Pago completo por MP\n`;
      msg += `_Esperando pago en Mercado Pago_\n\n`;
    }
    
    if (nombre) msg += `*Cliente:* ${nombre}\n`;
    if (telefono) msg += `*Teléfono:* ${telefono}\n`;
    if (email) msg += `*Email:* ${email}\n`;
    if (direccion) msg += `*Dirección:* ${direccion}\n`;
    
    msg += `\n*Productos:*\n`;
    (items_originales || []).forEach(it => {
      const sub = (it.price || 0) * (it.qty || 1);
      msg += `- ${it.name || 'Producto'}`;
      const detalles = [];
      if (it.size) detalles.push(`Talla ${it.size}`);
      if (it.color) detalles.push(it.color);
      if (detalles.length) msg += ` (${detalles.join(', ')})`;
      msg += ` x${it.qty || 1} — ${fmtCop(sub)}\n`;
    });
    
    msg += `\nSubtotal productos: ${fmtCop(total_productos)}`;
    msg += `\nEnvío: ${total_envio > 0 ? fmtCop(total_envio) : 'GRATIS'}`;
    msg += `\n━━━━━━━━━━━━━━`;
    
    if (esContraentrega) {
      msg += `\n*Paga ahora (envío):* ${fmtCop(total_envio)}`;
      msg += `\n*Cobrar al entregar:* ${fmtCop(saldo_pendiente || total_productos)}`;
      msg += `\nTotal general: ${fmtCop(total_general)}`;
      msg += `\n\n*IMPORTANTE:* Solo despachar cuando se confirme el pago del envío.`;
    } else {
      msg += `\n*TOTAL: ${fmtCop(total_general)}*`;
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
    else console.log('Telegram OK');
  } catch (e) {
    console.error('Error Telegram:', e.message);
  }
}

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
    const { 
      pedido_id, 
      items, 
      email, 
      nombre, 
      telefono, 
      direccion,
      metodo_pago,
      saldo_pendiente
    } = body;
    
    // ⚠️ NOTA: ya NO usamos el "total" del cliente, lo recalculamos abajo

    if (!pedido_id || !Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'Datos incompletos' }), { status: 400, headers });
    }

    const MP_ACCESS_TOKEN = env.MP_ACCESS_TOKEN;
    const SUPABASE_URL = env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

    if (!MP_ACCESS_TOKEN) {
      return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN no configurado' }), { status: 500, headers });
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return new Response(JSON.stringify({ error: 'SUPABASE no configurado' }), { status: 500, headers });
    }

    // ═══════════════════════════════════════════════════════════
    // 🔒 RECÁLCULO DE PRECIOS DESDE LA BD (anti-manipulación)
    // ═══════════════════════════════════════════════════════════
    const mpItems = [];
    let subtotalReal = 0;
    let envioReal = 0;
    const itemsValidados = [];

    for (const it of items) {
      // ─── Item de envío: viene como { name: "Envío X días", price: N }
      // No tiene "id" porque no es un producto. Lo dejamos pasar pero
      // limitamos el monto a un rango razonable (0 a 100.000 COP).
      if (it.name && String(it.name).startsWith('Envío')) {
        const envio = Math.max(0, Math.min(100000, Math.floor(Number(it.price) || 0)));
        envioReal += envio;
        if (envio > 0) {
          mpItems.push({
            title: String(it.name).slice(0, 100),
            quantity: 1,
            unit_price: envio,
            currency_id: 'COP'
          });
        }
        itemsValidados.push({ ...it, price: envio });
        continue;
      }

      // ─── Producto real: validar contra la tabla productos
      if (!it.id) {
        return new Response(JSON.stringify({ 
          error: `Item sin id: ${it.name || 'desconocido'}` 
        }), { status: 400, headers });
      }

      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/productos?id=eq.${encodeURIComponent(it.id)}&select=id,nombre,precio,activo`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
          }
        }
      );

      if (!r.ok) {
        console.error('Error consultando producto:', it.id, r.status);
        return new Response(JSON.stringify({ 
          error: 'Error validando productos' 
        }), { status: 500, headers });
      }

      const rows = await r.json();
      const prodReal = rows[0];

      if (!prodReal) {
        return new Response(JSON.stringify({ 
          error: `Producto no encontrado: ${it.id}` 
        }), { status: 400, headers });
      }
      if (!prodReal.activo) {
        return new Response(JSON.stringify({ 
          error: `Producto no disponible: ${prodReal.nombre}` 
        }), { status: 400, headers });
      }

      // Limitar cantidad a un rango sensato (1-20 por línea)
      const qty = Math.max(1, Math.min(20, parseInt(it.qty) || 1));
      const precioReal = Math.max(0, Math.floor(Number(prodReal.precio) || 0));

      if (precioReal <= 0) {
        return new Response(JSON.stringify({ 
          error: `Precio inválido para: ${prodReal.nombre}` 
        }), { status: 400, headers });
      }

      subtotalReal += precioReal * qty;

      // Construir título descriptivo (lo que ve el cliente en MP)
      let title = prodReal.nombre;
      if (it.size) title += ` - Talla ${String(it.size).slice(0, 10)}`;
      if (it.color) title += ` - ${String(it.color).slice(0, 30)}`;

      mpItems.push({
        title: title.slice(0, 200),
        quantity: qty,
        unit_price: precioReal,
        currency_id: 'COP'
      });

      // Guardar item validado para Telegram y para actualizar el pedido
      itemsValidados.push({
        ...it,
        id: prodReal.id,
        name: prodReal.nombre,
        price: precioReal,
        qty: qty
      });
    }

    const totalReal = subtotalReal + envioReal;

    // ═══════════════════════════════════════════════════════════
    // 🔒 ACTUALIZAR EL PEDIDO EN LA BD CON LOS TOTALES REALES
    // (importante porque el cliente lo creó con valores manipulables)
    // ═══════════════════════════════════════════════════════════
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${encodeURIComponent(pedido_id)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          subtotal: subtotalReal,
          envio: envioReal,
          total: totalReal,
          items: itemsValidados
        })
      });
    } catch (e) {
      console.warn('No se pudo actualizar totales del pedido:', e.message);
    }

    console.log('crear-pago:', pedido_id, 'total real:', totalReal, 'método:', metodo_pago);

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
      statement_descriptor: 'ZAPATOSYA',
      metadata: {
        metodo_pago: metodo_pago || 'completo',
        saldo_pendiente: saldo_pendiente || 0
      }
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

    // ─── Notificar a Telegram con datos REALES ───
    context.waitUntil(notificarTelegram(env, {
      pedido_id,
      items_originales: itemsValidados,
      total_productos: subtotalReal,
      total_envio: envioReal,
      total_general: totalReal,
      email,
      nombre,
      telefono,
      direccion,
      metodo_pago,
      saldo_pendiente
    }));

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

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
  });
}

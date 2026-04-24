// ═══════════════════════════════════════════════════════════════
// Cloudflare Pages Function: recordatorio-pago
// Path: /functions/recordatorio-pago.js
// Endpoint: https://zapatosya.com/recordatorio-pago
// 
// Busca pedidos con >5h en estado "esperando pago" y manda recordatorio
// por Telegram con link directo a WhatsApp para contactar al cliente.
// ═══════════════════════════════════════════════════════════════

function fmtCop(n){
  return '$' + (Number(n)||0).toLocaleString('es-CO');
}

function horasTranscurridas(fecha){
  const ms = Date.now() - new Date(fecha).getTime();
  return Math.floor(ms / (60*60*1000));
}

async function enviarRecordatorio(env, pedido) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  
  try {
    const horas = horasTranscurridas(pedido.creado_en);
    const nombre = pedido.nombre_cliente || 'Cliente';
    const telefono = pedido.telefono || '';
    const email = pedido.email || '';
    const total = pedido.total || 0;
    const items = (pedido.items||[]).map(it => `${it.name} (T${it.size||'-'}, ${it.color||'-'}) x${it.qty}`).join(', ');
    
    // Normalizar teléfono para WhatsApp (quitar espacios, +, etc.)
    let telLimpio = telefono.replace(/\D/g, '');
    if (telLimpio.length === 10) telLimpio = '57' + telLimpio; // Agregar código país si falta
    
    // Mensaje sugerido para enviar al cliente
    const msgCliente = `Hola ${nombre.split(' ')[0]}! Te contactamos de ZapatosYa. Vimos que iniciaste un pedido por ${fmtCop(total)} pero no se completó el pago. ¿Tuviste algún inconveniente? Podemos ayudarte con gusto.`;
    const waLink = telLimpio ? `https://wa.me/${telLimpio}?text=${encodeURIComponent(msgCliente)}` : '';
    
    let msg = `*RECORDATORIO DE PAGO*\n`;
    msg += `Pedido: \`#${String(pedido.id).slice(0,8)}\`\n`;
    msg += `Hace *${horas} horas* sin pagar\n\n`;
    msg += `*Cliente:* ${nombre}\n`;
    if (telefono) msg += `*Teléfono:* ${telefono}\n`;
    if (email) msg += `*Email:* ${email}\n`;
    msg += `*Productos:* ${items}\n`;
    msg += `*Total:* ${fmtCop(total)}\n`;
    if (waLink) msg += `\n[Contactar por WhatsApp](${waLink})`;
    
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
    
    return res.ok;
  } catch(e) {
    console.error('Error recordatorio:', e.message);
    return false;
  }
}

export async function onRequestPost(context) {
  const { env } = context;
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const SUPABASE_URL = env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return new Response(JSON.stringify({ error: 'Variables de entorno faltan' }), { status: 500, headers });
    }
    
    // Obtener pedidos esperando pago, con más de 5h y que no han sido recordados
    // Y que no sean contraentrega (esos son especiales, no aplica el recordatorio de pago)
    const fiveHoursAgo = new Date(Date.now() - 5*60*60*1000).toISOString();
    
    const url = `${SUPABASE_URL}/rest/v1/pedidos?pago_estado=eq.esperando&recordatorio_enviado=eq.false&creado_en=lt.${fiveHoursAgo}&metodo_pago=neq.contraentrega&select=*`;
    
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });
    
    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Error consultando Supabase' }), { status: 500, headers });
    }
    
    const pedidos = await res.json();
    
    if (!pedidos || pedidos.length === 0) {
      return new Response(JSON.stringify({ ok: true, encontrados: 0 }), { status: 200, headers });
    }
    
    let enviados = 0;
    for (const pedido of pedidos) {
      const ok = await enviarRecordatorio(env, pedido);
      if (ok) {
        // Marcar como recordatorio enviado
        await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ recordatorio_enviado: true })
        });
        enviados++;
      }
    }
    
    return new Response(JSON.stringify({ 
      ok: true, 
      encontrados: pedidos.length,
      enviados: enviados 
    }), { status: 200, headers });
    
  } catch (err) {
    console.error('Error recordatorio:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

export async function onRequestGet() {
  return new Response('recordatorio-pago OK', { status: 200 });
}

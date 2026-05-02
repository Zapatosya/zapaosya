// Cloudflare Pages Function: /notif-resena
// Notifica al admin por Telegram cuando llega una nueva reseña pendiente de aprobación.
//
// Variables de entorno necesarias en Cloudflare Pages:
//   TELEGRAM_BOT_TOKEN  → token del bot (mismo que ya usas para pedidos)
//   TELEGRAM_CHAT_ID    → tu chat ID de Telegram (mismo que ya usas)
//   ADMIN_PANEL_URL     → opcional, URL de tu panel admin (ej: https://zapatosya.com/?admin=1)

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const {
      resena_id,
      producto_nombre,
      producto_id,
      nombre_cliente,
      email,
      rating,
      comentario,
      fotos,
      fecha
    } = data;

    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      console.error('Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID');
      return jsonResponse({ ok: false, error: 'Telegram no configurado' }, 500);
    }

    // Construir mensaje
    const stars = '⭐'.repeat(rating || 0) + '☆'.repeat(5 - (rating || 0));
    const fechaFmt = new Date(fecha || Date.now()).toLocaleString('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Bogota'
    });
    const numFotos = Array.isArray(fotos) ? fotos.length : 0;

    let mensaje = `🆕 *Nueva reseña pendiente de aprobación*\n\n`;
    mensaje += `📦 *Producto:* ${escapeMd(producto_nombre || 'Producto')}\n`;
    mensaje += `👤 *Cliente:* ${escapeMd(nombre_cliente || 'Anónimo')}`;
    if (email) mensaje += ` (${escapeMd(email)})`;
    mensaje += `\n${stars} *${rating || 0}/5*\n`;
    mensaje += `🕐 ${escapeMd(fechaFmt)}\n`;
    if (numFotos > 0) mensaje += `📷 ${numFotos} foto(s) adjunta(s)\n`;
    mensaje += `\n💬 *Comentario:*\n`;
    mensaje += comentario ? `_${escapeMd(comentario.slice(0, 500))}_` : '_(sin comentario)_';
    mensaje += `\n\n👉 Revisar y aprobar en el panel admin`;
    if (env.ADMIN_PANEL_URL) {
      mensaje += `\n${env.ADMIN_PANEL_URL}`;
    }

    // Enviar mensaje principal
    const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const tgRes = await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: mensaje,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });

    if (!tgRes.ok) {
      const errBody = await tgRes.text();
      console.error('Error Telegram sendMessage:', errBody);
      return jsonResponse({ ok: false, error: 'Telegram error', detail: errBody }, 500);
    }

    // Si hay fotos, enviarlas como mediaGroup (máximo 10 por grupo, nosotros tenemos máx 3)
    if (numFotos > 0) {
      const media = fotos.slice(0, 10).map((url, i) => ({
        type: 'photo',
        media: url,
        caption: i === 0 ? `📷 Fotos de la reseña #${String(resena_id || '').slice(0, 8)}` : undefined
      }));

      const mediaUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMediaGroup`;
      const mediaRes = await fetch(mediaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          media: media
        })
      });

      if (!mediaRes.ok) {
        const errBody = await mediaRes.text();
        console.warn('Error enviando fotos a Telegram:', errBody);
        // No fallamos toda la notificación si fallan las fotos
      }
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('Error en /notif-resena:', err);
    return jsonResponse({ ok: false, error: err.message || 'Error interno' }, 500);
  }
}

// Maneja CORS / preflight si hace falta
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// Escapa caracteres especiales de Markdown legacy de Telegram
function escapeMd(text) {
  if (!text) return '';
  return String(text).replace(/([_*`\[\]])/g, '\\$1');
}

// ═══════════════════════════════════════════════════════════════
// Cloudflare Pages Function: recibo
// Path: /functions/recibo.js
// Endpoint: https://zapatosya.com/recibo?id=PEDIDO_ID
// 
// Genera una página HTML de recibo profesional para imprimir/PDF.
// Solo accesible si conoces el ID exacto (no es búsqueda pública).
// ═══════════════════════════════════════════════════════════════

function fmtCop(n){
  return '$' + (Number(n)||0).toLocaleString('es-CO');
}

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function pageError(msg) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Recibo no encontrado</title>
<style>body{font-family:system-ui,sans-serif;padding:40px;text-align:center;color:#333}h1{color:#E63946}</style>
</head><body><h1>Recibo no encontrado</h1><p>${escapeHtml(msg)}</p></body></html>`;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pedidoId = url.searchParams.get('id');
  
  if (!pedidoId) {
    return new Response(pageError('Falta el parámetro id'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
  
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(pageError('Configuración faltante'), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
  
  // Traer pedido
  let pedido = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${encodeURIComponent(pedidoId)}&select=*`, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });
    if (res.ok) {
      const rows = await res.json();
      pedido = rows[0] || null;
    }
  } catch (e) {
    console.error('Error obteniendo pedido:', e.message);
  }
  
  if (!pedido) {
    return new Response(pageError('No se encontró el pedido especificado'), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
  
  const fecha = new Date(pedido.creado_en).toLocaleString('es-CO', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  
  const items = (pedido.items || []).map(it => {
    const sub = (it.price || 0) * (it.qty || 1);
    return `<tr>
      <td>
        <strong>${escapeHtml(it.name)}</strong><br>
        <span style="color:#666;font-size:.85rem">Talla ${escapeHtml(it.size||'-')} · ${escapeHtml(it.color||'-')}</span>
      </td>
      <td style="text-align:center">${it.qty || 1}</td>
      <td style="text-align:right">${fmtCop(it.price)}</td>
      <td style="text-align:right"><strong>${fmtCop(sub)}</strong></td>
    </tr>`;
  }).join('');
  
  const esContraentrega = pedido.metodo_pago === 'contraentrega';
  const pagoEstado = pedido.pago_estado || 'esperando';
  
  let estadoBadge;
  let estadoColor;
  if (esContraentrega) {
    estadoBadge = 'CONTRAENTREGA';
    estadoColor = '#2563eb';
  } else if (pagoEstado === 'confirmado') {
    estadoBadge = 'PAGADO';
    estadoColor = '#16a34a';
  } else if (pagoEstado === 'rechazado') {
    estadoBadge = 'RECHAZADO';
    estadoColor = '#dc2626';
  } else if (pagoEstado === 'devuelto') {
    estadoBadge = 'DEVUELTO';
    estadoColor = '#7c3aed';
  } else {
    estadoBadge = 'PENDIENTE';
    estadoColor = '#f59e0b';
  }
  
  const idCorto = String(pedido.id).slice(0, 8).toUpperCase();
  
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Recibo #${idCorto} - ZapatosYa</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Helvetica Neue',Arial,sans-serif;background:#f5f5f5;color:#222;padding:30px 20px;line-height:1.5}
.recibo{max-width:780px;margin:0 auto;background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.08);overflow:hidden}

.recibo-header{background:linear-gradient(135deg,#E63946 0%,#c1272f 100%);color:#fff;padding:32px 40px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:20px}
.brand{font-size:1.8rem;font-weight:800;letter-spacing:-.5px}
.brand-tag{font-size:.78rem;opacity:.9;letter-spacing:2px;margin-top:2px}
.recibo-meta{text-align:right}
.recibo-num{font-size:.78rem;opacity:.8;letter-spacing:1px}
.recibo-id{font-size:1.4rem;font-weight:700;margin-top:2px}
.recibo-fecha{font-size:.82rem;opacity:.9;margin-top:6px}

.estado-bar{padding:14px 40px;background:${estadoColor};color:#fff;text-align:center;font-weight:800;letter-spacing:2px;font-size:.9rem}

.recibo-body{padding:30px 40px}
.section{margin-bottom:26px}
.section-title{font-size:.74rem;text-transform:uppercase;letter-spacing:1.5px;color:#888;font-weight:700;margin-bottom:8px}

.cliente-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.cliente-info p{font-size:.94rem;margin-bottom:3px}
.cliente-info strong{font-weight:600}

table{width:100%;border-collapse:collapse;margin-top:8px}
table th{background:#f9f9f9;text-align:left;padding:10px 14px;font-size:.74rem;text-transform:uppercase;color:#666;font-weight:700;letter-spacing:.5px;border-bottom:2px solid #ececec}
table th:nth-child(2){text-align:center}
table th:nth-child(3),table th:nth-child(4){text-align:right}
table td{padding:14px;border-bottom:1px solid #eee;font-size:.92rem}

.totales{margin-top:20px;border-top:2px solid #222;padding-top:14px}
.tot-row{display:flex;justify-content:space-between;padding:6px 0;font-size:.95rem}
.tot-row strong{font-weight:600}
.tot-final{display:flex;justify-content:space-between;padding:14px 0 4px;border-top:1px solid #ddd;margin-top:8px;font-size:1.2rem;font-weight:800;color:#E63946}

${esContraentrega ? `
.contra-box{background:#eff6ff;border:2px dashed #2563eb;border-radius:10px;padding:14px 18px;margin-top:18px}
.contra-box-title{font-weight:700;color:#1e40af;margin-bottom:6px;font-size:.9rem}
.contra-box-row{display:flex;justify-content:space-between;font-size:.88rem;padding:3px 0}
.contra-box-row strong{color:#1e40af}
` : ''}

.footer{padding:24px 40px;background:#fafafa;border-top:1px solid #eee;text-align:center;color:#777;font-size:.82rem}
.footer strong{color:#222}
.footer-contact{margin-top:8px}

.no-print{position:fixed;top:20px;right:20px;display:flex;gap:10px;z-index:100}
.btn-action{background:#E63946;color:#fff;padding:12px 22px;border-radius:50px;border:none;font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(230,57,70,.4);font-size:.9rem;font-family:inherit;transition:all .2s}
.btn-action:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(230,57,70,.5)}
.btn-action.secondary{background:#222}

@media (max-width:620px){
  body{padding:14px 8px}
  .recibo-header{padding:22px 22px;flex-direction:column;align-items:flex-start;text-align:left}
  .recibo-meta{text-align:left}
  .recibo-body{padding:20px 22px}
  .cliente-grid{grid-template-columns:1fr;gap:14px}
  .footer{padding:20px}
  .no-print{top:10px;right:10px}
  .btn-action{padding:10px 16px;font-size:.82rem}
  table th,table td{padding:8px 6px;font-size:.82rem}
}

@media print{
  body{background:#fff;padding:0}
  .recibo{box-shadow:none;border-radius:0;max-width:100%}
  .no-print{display:none !important}
  @page{margin:1cm}
}
</style>
</head>
<body>

<div class="no-print">
  <button class="btn-action" onclick="window.print()">Imprimir / Guardar PDF</button>
</div>

<div class="recibo">
  <div class="recibo-header">
    <div>
      <div class="brand">ZapatosYa</div>
      <div class="brand-tag">RÁPIDO Y SEGURO</div>
    </div>
    <div class="recibo-meta">
      <div class="recibo-num">RECIBO N°</div>
      <div class="recibo-id">#${idCorto}</div>
      <div class="recibo-fecha">${escapeHtml(fecha)}</div>
    </div>
  </div>
  
  <div class="estado-bar">${estadoBadge}</div>
  
  <div class="recibo-body">
    <div class="section">
      <div class="section-title">Cliente</div>
      <div class="cliente-grid">
        <div class="cliente-info">
          <p><strong>${escapeHtml(pedido.nombre_cliente || 'Cliente')}</strong></p>
          <p>${escapeHtml(pedido.email || '')}</p>
          <p>${escapeHtml(pedido.telefono || '')}</p>
        </div>
        <div class="cliente-info">
          <p style="color:#888;font-size:.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Dirección de envío</p>
          <p>${escapeHtml(pedido.direccion_completa || '')}</p>
        </div>
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">Detalle de productos</div>
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>Cant.</th>
            <th>Precio</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${items}
        </tbody>
      </table>
    </div>
    
    <div class="totales">
      <div class="tot-row"><span>Subtotal productos</span><strong>${fmtCop(pedido.subtotal||0)}</strong></div>
      <div class="tot-row"><span>Envío</span><strong>${pedido.envio>0?fmtCop(pedido.envio):'GRATIS'}</strong></div>
      <div class="tot-final"><span>TOTAL</span><span>${fmtCop(pedido.total||0)}</span></div>
    </div>
    
    ${esContraentrega ? `
    <div class="contra-box">
      <div class="contra-box-title">PEDIDO CONTRAENTREGA</div>
      <div class="contra-box-row"><span>Pagado por adelantado (envío):</span><strong>${fmtCop(pedido.envio||0)}</strong></div>
      <div class="contra-box-row"><span>A pagar al recibir el paquete:</span><strong>${fmtCop(pedido.subtotal||0)}</strong></div>
    </div>
    ` : ''}
    
    ${pedido.notas ? `
    <div class="section" style="margin-top:18px">
      <div class="section-title">Notas</div>
      <p style="font-size:.92rem;color:#555">${escapeHtml(pedido.notas)}</p>
    </div>
    ` : ''}
  </div>
  
  <div class="footer">
    <p>Gracias por tu compra en <strong>ZapatosYa</strong></p>
    <p class="footer-contact">www.zapatosya.com · WhatsApp: +57 321 297 0591</p>
  </div>
</div>

</body>
</html>`;
  
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

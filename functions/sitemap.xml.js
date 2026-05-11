// Cloudflare Pages Function — Sitemap dinámico
// Ruta: zapatosya.com/sitemap.xml
//
// Cómo funciona:
// 1. Consulta los productos activos en Supabase
// 2. Genera un sitemap.xml con:
//    - Home + páginas legales
//    - Una URL por producto (con su slug)
// 3. Devuelve el XML con headers correctos para que Google lo lea

// Helper: convierte nombre → slug (igual que el frontend)
// "Diesel - Azul" → "diesel-azul"
function slugify(str){
  if(!str) return '';
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function escapeXml(str){
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function onRequest(context) {
  const SITE = 'https://zapatosya.com';
  const SUPABASE_URL = 'https://xcfrlhjcpowyjguxvhdt.supabase.co';
  // Clave pública (publishable) — segura para exponerla
  const SUPABASE_KEY = 'sb_publishable_Fvofm1uMnN2VNzytI_xO7A_1B4ZSVdn';

  // URLs estáticas (siempre presentes)
  const staticUrls = [
    { loc: `${SITE}/`, priority: '1.0', changefreq: 'daily' },
    { loc: `${SITE}/sobre-nosotros.html`, priority: '0.6', changefreq: 'monthly' },
    { loc: `${SITE}/devoluciones.html`, priority: '0.6', changefreq: 'monthly' },
    { loc: `${SITE}/terminos.html`, priority: '0.4', changefreq: 'yearly' },
    { loc: `${SITE}/privacidad.html`, priority: '0.4', changefreq: 'yearly' },
  ];

  // Consultar productos activos de Supabase
  let productos = [];
  let errorMsg = null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/productos?activo=eq.true&select=id,nombre,creado_en,imagenes`;
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Accept': 'application/json',
      },
    });
    if (res.ok) {
      productos = await res.json();
      if (!Array.isArray(productos)) productos = [];
    } else {
      errorMsg = `Supabase ${res.status}`;
    }
  } catch (e) {
    errorMsg = `Fetch error: ${e.message}`;
  }

  // Construir XML
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
  xml += '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n';

  // URLs estáticas
  for (const u of staticUrls) {
    xml += '  <url>\n';
    xml += `    <loc>${escapeXml(u.loc)}</loc>\n`;
    xml += `    <changefreq>${u.changefreq}</changefreq>\n`;
    xml += `    <priority>${u.priority}</priority>\n`;
    xml += '  </url>\n';
  }

  // URLs de productos
  for (const p of productos) {
    const slug = slugify(p.nombre);
    if (!slug) continue;

    const loc = `${SITE}/${slug}`;
    const lastmod = p.creado_en ? new Date(p.creado_en).toISOString().slice(0, 10) : null;

    // Imagen principal del primer color (compat con formato viejo y nuevo)
    let imgUrl = null;
    if (Array.isArray(p.imagenes) && p.imagenes.length > 0) {
      const first = p.imagenes[0];
      if (Array.isArray(first) && first.length > 0) {
        imgUrl = first[0];
      } else if (typeof first === 'string') {
        imgUrl = first;
      }
    }

    xml += '  <url>\n';
    xml += `    <loc>${escapeXml(loc)}</loc>\n`;
    if (lastmod) xml += `    <lastmod>${lastmod}</lastmod>\n`;
    xml += '    <changefreq>weekly</changefreq>\n';
    xml += '    <priority>0.8</priority>\n';
    if (imgUrl) {
      xml += '    <image:image>\n';
      xml += `      <image:loc>${escapeXml(imgUrl)}</image:loc>\n`;
      xml += `      <image:title>${escapeXml(p.nombre)}</image:title>\n`;
      xml += '    </image:image>\n';
    }
    xml += '  </url>\n';
  }

  xml += '</urlset>\n';

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600', // 1 hora de caché
    },
  });
}

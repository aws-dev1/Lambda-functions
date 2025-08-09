// index.js (CommonJS)
const { DynamoDBClient, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

const dynamo = new DynamoDBClient({});
const TABLE = "Events"; // <-- your table name (hardcoded as requested)

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Small helper: format a unix-ish ms timestamp into readable date
function formatDate(ts) {
  try {
    const d = new Date(Number(ts));
    if (isNaN(d)) return ts;
    return d.toLocaleString();
  } catch (e) {
    return ts;
  }
}

function renderClassic(event) {
  const title = escapeHtml(event.title || "Untitled Event");
  const banner = event.bannerUrl || "";
  const date = escapeHtml(event.date || "");
  const description = escapeHtml(event.description || "");
  const organizer = escapeHtml(event.contact?.organizer || "");
  const email = escapeHtml(event.contact?.email || "");
  const whatsapp = escapeHtml(event.contact?.whatsapp || "");
  const agenda = Array.isArray(event.agenda) ? event.agenda : [];
  const speakers = Array.isArray(event.speakers) ? event.speakers : [];
  const partners = Array.isArray(event.partners) ? event.partners : [];
  const videos = Array.isArray(event.videos) ? event.videos : [];

  return `
  <!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
    <style>
      :root{--yellow:#f6d34a;--black:#111;--muted:#666}
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,'Helvetica Neue',Arial;margin:0;background:#fff;color:var(--black);line-height:1.4}
      .hero{background:linear-gradient(180deg,rgba(0,0,0,0.25),transparent), #f8e785;padding:40px 20px;text-align:center}
      .container{max-width:1100px;margin:0 auto;padding:28px}
      .banner{width:100%;height:360px;object-fit:cover;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,0.12)}
      h1{font-size:32px;margin:18px 0 8px}
      .meta{color:var(--muted);font-weight:600}
      nav.topmenu{position:sticky;top:0;z-index:40;background:#fff;padding:10px 0;border-bottom:1px solid #eee}
      nav.topmenu .inner{max-width:1100px;margin:0 auto;display:flex;gap:12px;align-items:center;padding:0 18px}
      nav a{color:var(--black);text-decoration:none;font-weight:600}
      .grid{display:grid;grid-template-columns:2fr 1fr;gap:28px;margin-top:22px}
      .section{background:#fff;padding:18px;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,0.03)}
      .speakers .speaker{display:flex;gap:12px;align-items:center;margin-bottom:12px}
      .speaker img{width:64px;height:64px;border-radius:8px;object-fit:cover}
      .partners img{height:40px;margin-right:12px;object-fit:contain}
      .agenda .item{padding:10px;border-left:3px solid var(--yellow);margin-bottom:10px}
      .videos iframe{width:100%;height:300px;border:0;border-radius:8px}
      .contact a{display:inline-block;margin-right:10px;background:var(--black);color:white;padding:10px 14px;border-radius:8px;text-decoration:none}
      footer{margin-top:40px;padding:20px;text-align:center;color:var(--muted)}
      @media(max-width:900px){ .grid{grid-template-columns:1fr} .banner{height:220px} }
    </style>
  </head>
  <body>
    <nav class="topmenu"><div class="inner">
      <strong>${escapeHtml(title)}</strong>
      <div style="flex:1"></div>
      <a href="#about">About</a>
      <a href="#speakers">Speakers</a>
      <a href="#agenda">Agenda</a>
      <a href="#partners">Partners</a>
      <a href="#videos">Videos</a>
      <a href="#contact">Contact</a>
    </div></nav>

    <header class="hero">
      <div class="container">
        <h1>${title}</h1>
        <div class="meta">${date} • Organized by ${organizer}</div>
        ${banner ? `<img class="banner" src="${escapeHtml(banner)}" alt="${title} banner" />` : ""}
      </div>
    </header>

    <main class="container">
      <div class="grid">
        <div>
          <section id="about" class="section">
            <h2>About</h2>
            <p>${description}</p>
          </section>

          <section id="speakers" class="section speakers" style="margin-top:18px">
            <h2>Speakers</h2>
            ${speakers.length ? speakers.map(s => `
              <div class="speaker">
                ${s.photo ? `<img src="${escapeHtml(s.photo)}" alt="${escapeHtml(s.name)} photo"/>` : ""}
                <div>
                  <div style="font-weight:700">${escapeHtml(s.name)}</div>
                  <div style="color:var(--muted)">${escapeHtml(s.designation)}</div>
                </div>
              </div>
            `).join("") : "<p>No speakers listed</p>"}
          </section>

          <section id="agenda" class="section" style="margin-top:18px">
            <h2>Agenda</h2>
            <div class="agenda">
              ${agenda.length ? agenda.map(a => `
                <div class="item"><strong>${escapeHtml(a.title)}</strong><div style="color:var(--muted)">${escapeHtml(a.time)}</div></div>
              `).join("") : "<p>No agenda items</p>"}
            </div>
          </section>

          <section id="videos" class="section" style="margin-top:18px">
            <h2>Videos</h2>
            <div class="videos">
              ${videos.length ? videos.map(v => `<div style="margin-bottom:12px"><iframe src="${escapeHtml(v)}" allowfullscreen></iframe></div>`).join("") : "<p>No videos</p>"}
            </div>
          </section>
        </div>

        <aside>
          <section id="partners" class="section partners">
            <h3>Partners</h3>
            <div style="display:flex;flex-wrap:wrap;align-items:center">
              ${partners.length ? partners.map(p => `<div style="display:flex;align-items:center;margin:8px 12px 8px 0"><img src="${escapeHtml(p.logo)}" alt="${escapeHtml(p.name)}" /><div style="margin-left:8px;color:var(--muted)">${escapeHtml(p.name)}</div></div>`).join("") : "<p>No partners</p>"}
            </div>
          </section>

          <section id="contact" class="section contact" style="margin-top:18px">
            <h3>Contact</h3>
            <p><strong>${organizer}</strong></p>
            <p>Email: <a href="mailto:${email}">${email}</a></p>
            <p>WhatsApp: <a href="https://wa.me/${whatsapp.replace(/\D/g,'')}" target="_blank">${whatsapp}</a></p>
            <div style="margin-top:10px">
              <a href="mailto:${email}">Email Organizer</a>
              <a href="https://wa.me/${whatsapp.replace(/\D/g,'')}" target="_blank">Message on WhatsApp</a>
            </div>
          </section>
        </aside>
      </div>

      <footer>
        Page generated dynamically. Event ID: ${escapeHtml(event.eventId || "")} • Created: ${formatDate(event.createdAt)}
      </footer>
    </main>
  </body>
  </html>
  `;
}

function renderModern(event) {
  // Simple alternative template. You can extend it with another style.
  return `
  <!doctype html>
  <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(event.title || "Event")}</title>
  <style>
    body{font-family:Inter,system-ui,Arial;background:#0f172a;color:#e6eef8;margin:0}
    .hero{background:${event.bannerUrl ? `url('${escapeHtml(event.bannerUrl)}') center/cover` : '#111'};min-height:320px;display:flex;align-items:center;justify-content:center}
    .hero h1{background:rgba(0,0,0,0.45);padding:16px;border-radius:8px}
    .container{padding:28px;max-width:1000px;margin:0 auto}
    .card{background:#071029;padding:18px;border-radius:12px;margin-bottom:18px}
    a.btn{display:inline-block;padding:8px 12px;background:#06b6d4;color:#001; border-radius:8px;text-decoration:none}
    .grid{display:grid;grid-template-columns:1fr 320px;gap:18px}
    @media(max-width:900px){ .grid{grid-template-columns:1fr} }
  </style>
  </head><body>
    <div class="hero"><h1>${escapeHtml(event.title || "")}</h1></div>
    <div class="container">
      <div class="grid">
        <div>
          <div class="card"><h2>About</h2><p>${escapeHtml(event.description || "")}</p></div>
          <div class="card"><h2>Agenda</h2>${(event.agenda || []).map(a=>`<div><strong>${escapeHtml(a.title)}</strong> — ${escapeHtml(a.time)}</div>`).join("")}</div>
          <div class="card"><h2>Speakers</h2>${(event.speakers||[]).map(s=>`<div style="margin-bottom:10px"><strong>${escapeHtml(s.name)}</strong><div style="color:#9fb2c8">${escapeHtml(s.designation)}</div></div>`).join("")}</div>
        </div>
        <aside>
          <div class="card"><h3>Contact</h3><div>${escapeHtml(event.contact?.organizer||"")}</div><div><a class="btn" href="mailto:${escapeHtml(event.contact?.email||'') }">Email</a></div></div>
          <div class="card"><h3>Partners</h3>${(event.partners||[]).map(p=>`<div><img src="${escapeHtml(p.logo)}" style="height:40px" alt="${escapeHtml(p.name)}"/></div>`).join("")}</div>
        </aside>
      </div>
    </div>
  </body></html>
  `;
}

exports.handler = async (event) => {
  console.log("Lambda#3 incoming event:", JSON.stringify(event));
  try {
    // support: pathParameters.eventId or queryStringParameters.eventId
    const eventId = event?.pathParameters?.eventId || event?.queryStringParameters?.eventId;
    if (!eventId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" },
        body: "Missing eventId (provide path parameter /event/{eventId} or ?eventId=...)"
      };
    }

    // Get item from DynamoDB
    const resp = await dynamo.send(new GetItemCommand({
      TableName: TABLE,
      Key: { eventId: { S: eventId } }
    }));

    if (!resp.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" },
        body: "Event not found"
      };
    }

    const item = unmarshall(resp.Item);

    // Decide which template to render
    const template = (item.template || "classic").toLowerCase();
    let html = "";
    if (template === "modern") {
      html = renderModern(item);
    } else {
      html = renderClassic(item);
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS"
      },
      body: html
    };
  } catch (err) {
    console.error("Error rendering event page:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" },
      body: "Internal server error: " + (err.message || String(err))
    };
  }
};

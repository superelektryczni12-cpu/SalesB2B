const { load } = require('cheerio');

function isPublicWebsite(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (host === 'localhost' || host.endsWith('.local')) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchWebsiteFacts(rawUrl) {
  if (!isPublicWebsite(rawUrl)) return {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    let currentUrl = rawUrl;
    let response;
    for (let redirect = 0; redirect < 5; redirect++) {
      if (!isPublicWebsite(currentUrl)) return {};
      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'SalesB2B/1.3 (+company-research)' },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      if (!location) return {};
      currentUrl = new URL(location, currentUrl).href;
    }
    if (!response?.ok || !String(response.headers.get('content-type')).includes('text/html')) return {};
    const html = (await response.text()).slice(0, 1_500_000);
    const $ = load(html);
    $('script,style,noscript,svg').remove();
    const title = $('title').first().text().trim();
    const description = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim();
    const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 120_000);
    const krs = text.match(/\bKRS(?:\s*(?:nr|numer)?\s*[:#]?\s*)(\d{10})\b/i)?.[1] || '';
    const nip = text.match(/\bNIP(?:\s*[:#]?\s*)(\d{3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}|\d{10})\b/i)?.[1]?.replace(/\D/g, '') || '';
    return { title, description, krs, nip, finalUrl: response.url };
  } catch {
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchKrsFacts(krs) {
  if (!/^\d{10}$/.test(krs)) return {};
  try {
    const response = await fetch(`https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${krs}?rejestr=P&format=json`, {
      headers: { 'User-Agent': 'SalesB2B/1.3' },
    });
    if (!response.ok) return {};
    const json = await response.json();
    const data = json?.odpis?.dane || {};
    const entity = data?.dzial1?.danePodmiotu || {};
    const seat = data?.dzial1?.siedzibaIAdres || {};
    const capital = data?.dzial1?.kapital?.wysokoscKapitaluZakladowego || {};
    const primary = data?.dzial3?.przedmiotDzialalnosci?.przedmiotPrzewazajacejDzialalnosci?.[0] || {};
    return {
      krs,
      legalName: entity.nazwa || '',
      legalForm: entity.formaPrawna || '',
      nip: entity.identyfikatory?.nip || '',
      regon: entity.identyfikatory?.regon || '',
      registeredCity: seat.siedziba?.miejscowosc || '',
      primaryActivity: primary.opis || '',
      primaryPkd: [primary.kodDzial, primary.kodKlasa, primary.kodPodklasa].filter(Boolean).join('.'),
      shareCapital: capital.wartosc || '',
      shareCapitalCurrency: capital.waluta || '',
      sourceUrl: `https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${krs}?rejestr=P&format=json`,
    };
  } catch {
    return {};
  }
}

async function analyzeCompanyWebsite(website) {
  const websiteFacts = await fetchWebsiteFacts(website);
  const krsFacts = websiteFacts.krs ? await fetchKrsFacts(websiteFacts.krs) : {};
  return { website: websiteFacts, krs: krsFacts };
}

module.exports = { analyzeCompanyWebsite, fetchKrsFacts, fetchWebsiteFacts };

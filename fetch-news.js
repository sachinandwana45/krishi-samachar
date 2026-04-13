// ════════════════════════════════════════════════════════
// fetch-news.js — BH Krishi Samachar
// GitHub Actions mein roz subah 6 baje run hoga
// Google News RSS se agriculture news fetch karta hai
// news.json file save karta hai jise index.html padhta hai
// ════════════════════════════════════════════════════════

const https = require('https');
const http = require('http');
const fs = require('fs');
const url = require('url');

// ── Agriculture RSS Feeds (Google News) ──
const RSS_FEEDS = [
  // Hindi agriculture news
  {
    url: 'https://news.google.com/rss/search?q=krishi+kisan+farming+India&hl=hi&gl=IN&ceid=IN:hi',
    lang: 'hi'
  },
  // English agriculture India
  {
    url: 'https://news.google.com/rss/search?q=agriculture+India+farmers+MSP&hl=en&gl=IN&ceid=IN:en',
    lang: 'en'
  },
  // Mandi prices
  {
    url: 'https://news.google.com/rss/search?q=mandi+bhav+fasal+price+India&hl=hi&gl=IN&ceid=IN:hi',
    lang: 'hi'
  },
  // Government schemes for farmers
  {
    url: 'https://news.google.com/rss/search?q=PM-KISAN+kisan+yojana+subsidy&hl=hi&gl=IN&ceid=IN:hi',
    lang: 'hi'
  },
  // Weather for farmers
  {
    url: 'https://news.google.com/rss/search?q=monsoon+kisan+fasal+weather+India&hl=hi&gl=IN&ceid=IN:hi',
    lang: 'hi'
  },
];

// ── HTTP/HTTPS fetch ──
function fetchURL(rawUrl) {
  return new Promise((resolve) => {
    try {
      const parsed = url.parse(rawUrl);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get({
        hostname: parsed.hostname,
        path: parsed.path,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BHKrishiBot/1.0)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        },
        timeout: 10000
      }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchURL(res.headers.location).then(resolve);
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', () => resolve(''));
      req.on('timeout', () => { req.destroy(); resolve(''); });
    } catch(e) {
      resolve('');
    }
  });
}

// ── RSS XML Parser ──
function parseRSS(xmlText, lang) {
  const items = [];

  // Extract <item> blocks
  const itemMatches = xmlText.match(/<item>[\s\S]*?<\/item>/g) || [];

  for (const itemXml of itemMatches) {
    // Title
    let title = '';
    const titleCDATA = itemXml.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/);
    const titlePlain = itemXml.match(/<title>([\s\S]*?)<\/title>/);
    title = (titleCDATA ? titleCDATA[1] : (titlePlain ? titlePlain[1] : '')).trim();
    title = decodeHTMLEntities(title);

    if (!title || title.length < 5) continue;

    // Link
    let link = '';
    const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/);
    if (linkMatch) link = linkMatch[1].trim();
    // Google News ke link ko direct URL se replace karo
    link = cleanGoogleLink(link);

    // Description
    let desc = '';
    const descCDATA = itemXml.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/);
    const descPlain = itemXml.match(/<description>([\s\S]*?)<\/description>/);
    desc = (descCDATA ? descCDATA[1] : (descPlain ? descPlain[1] : '')).trim();
    desc = stripHTML(decodeHTMLEntities(desc)).substring(0, 300);

    // Source
    let source = '';
    const srcMatch = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    if (srcMatch) source = srcMatch[1].trim();
    if (!source) {
      // URL se source nikalo
      try {
        const srcUrl = new URL(link);
        source = srcUrl.hostname.replace('www.', '');
      } catch(e) { source = 'News'; }
    }

    // PubDate
    let pubDate = '';
    const dateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    if (dateMatch) pubDate = dateMatch[1].trim();

    // Image (if available)
    let image = '';
    const imgMatch = itemXml.match(/<media:content[^>]+url="([^"]+)"/);
    const encMatch = itemXml.match(/<enclosure[^>]+url="([^"]+)"/);
    if (imgMatch) image = imgMatch[1];
    else if (encMatch) image = encMatch[1];

    if (title && link) {
      items.push({ title, url: link, description: desc, source, pubDate, image, lang });
    }
  }

  return items;
}

// ── Google News URL ko real URL mein convert karo ──
function cleanGoogleLink(link) {
  if (!link) return '#';
  // Google News redirect URL से actual URL nikalo
  const match = link.match(/url=([^&]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch(e) {}
  }
  return link;
}

// ── HTML entities decode ──
function decodeHTMLEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n)));
}

// ── HTML tags strip karo ──
function stripHTML(str) {
  return str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Agriculture related hai ya nahi check karo ──
function isAgricultureNews(title, desc) {
  const text = (title + ' ' + desc).toLowerCase();
  const agriKeywords = [
    'kisan', 'farmer', 'farming', 'agriculture', 'agri', 'crop', 'fasal',
    'mandi', 'krishi', 'खेती', 'किसान', 'फसल', 'कृषि', 'मंडी', 'बुवाई',
    'msp', 'wheat', 'rice', 'paddy', 'soybean', 'cotton', 'sugarcane',
    'gehu', 'dhan', 'गेहूं', 'धान', 'गन्ना', 'कपास',
    'monsoon', 'rain', 'drought', 'irrigation', 'मानसून', 'बारिश', 'सिंचाई',
    'fertilizer', 'pesticide', 'seed', 'soil', 'खाद', 'बीज', 'मिट्टी',
    'pm-kisan', 'kcc', 'nabard', 'agriculture ministry', 'कृषि मंत्रालय',
    'subsidy', 'yojana', 'scheme', 'सब्सिडी', 'योजना',
    'harvest', 'sowing', 'rabi', 'kharif', 'rabi', 'खरीफ', 'रबी',
    'pest', 'disease', 'locust', 'टिड्डी', 'कीट', 'रोग',
    'export', 'import', 'agmarknet', 'apeda', 'icar'
  ];
  return agriKeywords.some(kw => text.includes(kw));
}

// ── MAIN FUNCTION ──
async function main() {
  console.log('BH Krishi Samachar — News Fetch Start:', new Date().toISOString());

  const allArticles = [];

  // Har RSS feed se news laao
  for (const feed of RSS_FEEDS) {
    console.log('Fetching:', feed.url.substring(0, 60) + '...');
    try {
      const xml = await fetchURL(feed.url);
      if (xml && xml.length > 100) {
        const items = parseRSS(xml, feed.lang);
        console.log(`  Got ${items.length} items`);
        allArticles.push(...items);
      } else {
        console.log('  Empty or error response');
      }
    } catch(e) {
      console.error('  Error:', e.message);
    }

    // Rate limiting — feeds ke beech thoda wait
    await new Promise(r => setTimeout(r, 1000));
  }

  // Agriculture filter + deduplicate
  const seen = new Set();
  const filtered = allArticles
    .filter(a => {
      // Agriculture related hona chahiye
      if (!isAgricultureNews(a.title, a.description)) return false;
      // Duplicate title hata do
      const key = a.title.substring(0, 50).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 15); // Top 15 articles

  console.log(`Total agriculture articles: ${filtered.length}`);

  if (filtered.length === 0) {
    console.log('No articles found — keeping previous news.json if exists');
    // Agar pehle ki news.json hai to use rakho
    if (fs.existsSync('news.json')) {
      const old = JSON.parse(fs.readFileSync('news.json', 'utf8'));
      old.updated = new Date().toISOString();
      old.note = 'Previous articles (no new fetch today)';
      fs.writeFileSync('news.json', JSON.stringify(old, null, 2));
    }
    return;
  }

  // news.json save karo
  const output = {
    updated: new Date().toISOString(),
    count: filtered.length,
    source: 'Google News RSS',
    articles: filtered
  };

  fs.writeFileSync('news.json', JSON.stringify(output, null, 2), 'utf8');
  console.log(`SUCCESS: Saved ${filtered.length} articles to news.json`);
  console.log('Sample:', filtered[0]?.title);
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});

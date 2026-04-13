const https = require('https');
const http = require('http');
const fs = require('fs');

// ── Simple HTTP GET ──
function get(url, ms) {
  ms = ms || 15000;
  return new Promise(function(resolve) {
    try {
      var u = new URL(url);
      var lib = u.protocol === 'https:' ? https : http;
      var req = lib.get({
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/2.0)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        },
        timeout: ms
      }, function(res) {
        // Follow redirects
        if ([301,302,303,307,308].indexOf(res.statusCode) !== -1 && res.headers.location) {
          res.resume();
          var loc = res.headers.location;
          if (!loc.startsWith('http')) loc = u.protocol + '//' + u.hostname + loc;
          return get(loc, ms).then(resolve);
        }
        var d = '';
        res.setEncoding('utf8');
        res.on('data', function(c) { if (d.length < 500000) d += c; });
        res.on('end', function() { resolve(d); });
        res.on('error', function() { resolve(''); });
      });
      req.on('error', function() { resolve(''); });
      req.on('timeout', function() { req.destroy(); resolve(''); });
    } catch(e) { resolve(''); }
  });
}

// ── og:image nikalo ──
async function getImage(url) {
  if (!url || url === '#') return '';
  try {
    var html = await get(url, 7000);
    if (!html) return '';
    var patterns = [
      /property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
      /content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
      /name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
      /content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = html.match(patterns[i]);
      if (m && m[1] && m[1].startsWith('http') && m[1].length > 20) return m[1];
    }
  } catch(e) {}
  return '';
}

// ── RSS Parse ──
function parse(xml, sourceName) {
  var items = [];
  var re = /<item>([\s\S]*?)<\/item>/g;
  var m;
  while ((m = re.exec(xml)) !== null) {
    var x = m[1];

    // Title
    var t1 = x.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/);
    var t2 = x.match(/<title>([^<]+)<\/title>/);
    var title = ((t1 ? t1[1] : (t2 ? t2[1] : '')) || '').trim();
    title = title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
    if (!title || title.length < 5) continue;

    // Link — DIRECT newspaper URL (no Google redirect!)
    var l1 = x.match(/<link>([^<]+)<\/link>/);
    var l2 = x.match(/<guid[^>]*>([^<]+)<\/guid>/);
    var link = (l1 ? l1[1].trim() : '') || (l2 ? l2[1].trim() : '') || '#';

    // Description
    var d1 = x.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/);
    var d2 = x.match(/<description>([^<]+)<\/description>/);
    var desc = ((d1 ? d1[1] : (d2 ? d2[1] : '')) || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    desc = desc.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').trim();
    if (desc.length > 220) desc = desc.substring(0,220)+'...';

    // Media image from RSS
    var im = x.match(/<media:content[^>]+url=["']([^"']+)["']/i)
           || x.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i)
           || x.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image/i);
    var rssImg = (im && im[1] && im[1].startsWith('http')) ? im[1] : '';

    if (title && link && link !== '#') {
      items.push({ title, url: link, description: desc, source: sourceName, rssImg, pubDate: new Date().toISOString() });
    }
  }
  return items;
}

// ── DIRECT Indian Newspaper RSS Feeds ──
// Ye sab REAL URLs hain — koi Google redirect nahi!
var FEEDS = [
  // AajTak
  { url: 'https://feeds.feedburner.com/aajtak/agriculture', name: 'AajTak' },
  // Krishak Jagat
  { url: 'https://krishakjagat.org/feed/', name: 'Krishak Jagat' },
  // Kisan Samadhan
  { url: 'https://kisansamadhan.com/feed/', name: 'Kisan Samadhan' },
  // Gaon Connection
  { url: 'https://www.gaonconnection.com/feed', name: 'Gaon Connection' },
  // Krishi Jagran
  { url: 'https://hindi.krishijagran.com/feed/', name: 'Krishi Jagran' },
  // AgriHunt
  { url: 'https://www.agrihunt.com/feed/', name: 'AgriHunt' },
  // Down to Earth Agriculture
  { url: 'https://www.downtoearth.org.in/rss/agriculture', name: 'Down to Earth' },
  // Farm2Kitchen
  { url: 'https://farm2kitchen.in/feed/', name: 'Farm2Kitchen' },
  // Google News fallback — Hindi agriculture (backup only)
  { url: 'https://news.google.com/rss/search?q=kisan+krishi+mandi&hl=hi&gl=IN&ceid=IN:hi', name: 'Google News HI' },
  { url: 'https://news.google.com/rss/search?q=agriculture+farmer+India&hl=en&gl=IN&ceid=IN:en', name: 'Google News EN' },
];

// ── Agriculture keywords ──
function isAgri(title, desc) {
  var text = (title + ' ' + (desc||'')).toLowerCase();
  var kw = [
    'kisan','farmer','farming','agriculture','agri','crop','fasal','mandi','krishi',
    'खेती','किसान','फसल','कृषि','मंडी','msp','wheat','rice','paddy','soybean',
    'cotton','sugarcane','गेहूं','धान','मानसून','बारिश','fertilizer','pesticide',
    'seed','soil','खाद','बीज','pm-kisan','kcc','nabard','subsidy','yojana',
    'सब्सिडी','योजना','harvest','sowing','rabi','kharif','pest','disease',
    'टिड्डी','कीट','रोग','export','apeda','icar','farm','agmarknet',
    'agricultural','horticulture','dairy','livestock'
  ];
  return kw.some(function(k) { return text.indexOf(k) !== -1; });
}

// ── Google News link se real URL nikalo ──
async function resolveUrl(url) {
  if (!url || !url.includes('news.google.com')) return url;
  try {
    // Google News HTML se real link dhundho
    var html = await get(url, 8000);
    if (!html) return url;
    // Real article links dhundho
    var matches = html.match(/href="(https?:\/\/(?!.*google)[^"]{30,})"/g);
    if (matches) {
      for (var i = 0; i < matches.length; i++) {
        var m = matches[i].match(/href="([^"]+)"/);
        if (!m) continue;
        var candidate = m[1];
        // Google, YouTube, gstatic avoid karo
        if (candidate.includes('google') || candidate.includes('youtube') || 
            candidate.includes('gstatic') || candidate.includes('googleapis')) continue;
        // Real article URL chahiye — kam se kam 40 chars
        if (candidate.length > 40 && candidate.startsWith('http')) return candidate;
      }
    }
  } catch(e) {}
  return url;
}

async function main() {
  console.log('=== BH Krishi Samachar News Fetch ===');
  console.log('Time:', new Date().toISOString());

  var all = [];

  for (var i = 0; i < FEEDS.length; i++) {
    var feed = FEEDS[i];
    console.log('[' + (i+1) + '/' + FEEDS.length + '] Fetching:', feed.name);
    try {
      var xml = await get(feed.url, 15000);
      if (xml && xml.includes('<item>')) {
        var items = parse(xml, feed.name);
        console.log('  Got', items.length, 'items');
        all = all.concat(items);
      } else {
        console.log('  No items or empty');
      }
    } catch(e) {
      console.log('  Error:', e.message);
    }
    await new Promise(function(r) { setTimeout(r, 500); });
  }

  // Deduplicate + filter
  var seen = {};
  var filtered = [];
  for (var j = 0; j < all.length; j++) {
    var a = all[j];
    var key = a.title.substring(0,40).toLowerCase().replace(/\s+/g,'');
    if (seen[key]) continue;
    if (!isAgri(a.title, a.description)) continue;
    seen[key] = true;
    filtered.push(a);
    if (filtered.length >= 20) break;
  }
  console.log('Total agriculture articles:', filtered.length);

  if (filtered.length === 0) {
    console.log('No articles! Saving empty.');
    fs.writeFileSync('news.json', JSON.stringify({updated:new Date().toISOString(),count:0,articles:[]},null,2),'utf8');
    return;
  }

  // Top 15 — resolve Google URLs + get images
  var top = filtered.slice(0, 15);
  var result = [];

  for (var k = 0; k < top.length; k++) {
    var art = top[k];
    console.log('[' + (k+1) + '] ' + art.source + ': ' + art.title.substring(0,40));

    // Google News URL resolve karo
    var finalUrl = art.url;
    if (art.url && art.url.includes('news.google.com')) {
      finalUrl = await resolveUrl(art.url);
      if (finalUrl !== art.url) console.log('  -> Resolved:', finalUrl.substring(0,60));
      else console.log('  -> Could not resolve, keeping Google URL');
    }

    // Image fetch
    var image = art.rssImg || '';
    if (!image && finalUrl && !finalUrl.includes('news.google.com')) {
      image = await getImage(finalUrl);
      if (image) console.log('  -> Image found');
    }

    result.push({
      title: art.title,
      url: finalUrl,
      description: art.description,
      source: art.source,
      image: image,
      pubDate: art.pubDate
    });

    await new Promise(function(r) { setTimeout(r, 400); });
  }

  var output = { updated: new Date().toISOString(), count: result.length, articles: result };
  fs.writeFileSync('news.json', JSON.stringify(output, null, 2), 'utf8');

  var imgCount = result.filter(function(a) { return a.image; }).length;
  var googleCount = result.filter(function(a) { return a.url.includes('news.google.com'); }).length;
  console.log('DONE! Articles:', result.length, '| Images:', imgCount, '| Still Google URLs:', googleCount);
}

main().catch(function(e) {
  console.error('FATAL:', e.message);
  fs.writeFileSync('news.json', JSON.stringify({updated:new Date().toISOString(),count:0,articles:[]},null,2),'utf8');
  process.exit(0);
});

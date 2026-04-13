const https = require('https');
const http = require('http');
const fs = require('fs');

// ── URL Fetch ──
function fetchURL(rawUrl, timeoutMs) {
  timeoutMs = timeoutMs || 12000;
  return new Promise(function(resolve) {
    try {
      var parsed = new URL(rawUrl);
      var lib = parsed.protocol === 'https:' ? https : http;
      var req = lib.get({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121',
          'Accept': 'text/html,application/xhtml+xml,application/xml,*/*',
          'Accept-Language': 'hi-IN,hi;q=0.9,en;q=0.8',
        },
        timeout: timeoutMs
      }, function(res) {
        // Handle redirects — real URL milegi yahan se
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          var loc = res.headers.location;
          if (!loc.startsWith('http')) loc = parsed.protocol + '//' + parsed.hostname + loc;
          res.resume();
          return fetchURL(loc, timeoutMs).then(resolve);
        }
        var data = '';
        res.setEncoding('utf8');
        res.on('data', function(c) { if (data.length < 300000) data += c; });
        res.on('end', function() { resolve({ url: rawUrl, finalUrl: rawUrl, body: data }); });
        res.on('error', function() { resolve({ url: rawUrl, finalUrl: rawUrl, body: '' }); });
      });
      req.on('error', function() { resolve({ url: rawUrl, finalUrl: rawUrl, body: '' }); });
      req.on('timeout', function() { req.destroy(); resolve({ url: rawUrl, finalUrl: rawUrl, body: '' }); });
    } catch(e) { resolve({ url: rawUrl, finalUrl: rawUrl, body: '' }); }
  });
}

// ── Simple fetch (string only) ──
function simpleGet(rawUrl, timeoutMs) {
  timeoutMs = timeoutMs || 15000;
  return new Promise(function(resolve) {
    try {
      var parsed = new URL(rawUrl);
      var lib = parsed.protocol === 'https:' ? https : http;
      var req = lib.get({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121',
          'Accept': 'text/html,*/*'
        },
        timeout: timeoutMs
      }, function(res) {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          var loc = res.headers.location;
          if (!loc.startsWith('http')) loc = parsed.protocol + '//' + parsed.hostname + loc;
          res.resume();
          return simpleGet(loc, timeoutMs).then(resolve);
        }
        var data = '';
        res.setEncoding('utf8');
        res.on('data', function(c) { if (data.length < 400000) data += c; });
        res.on('end', function() { resolve(data); });
        res.on('error', function() { resolve(''); });
      });
      req.on('error', function() { resolve(''); });
      req.on('timeout', function() { req.destroy(); resolve(''); });
    } catch(e) { resolve(''); }
  });
}

// ── Google News URL se Real Article URL nikalo ──
async function resolveGoogleNewsUrl(googleUrl) {
  if (!googleUrl || !googleUrl.includes('news.google.com')) return googleUrl;
  
  try {
    // Google News HTML page fetch karo
    var html = await simpleGet(googleUrl, 10000);
    if (!html) return googleUrl;
    
    // Real URL dhundho — Google News page mein hoti hai
    // Pattern 1: data-url attribute
    var m1 = html.match(/data-url="(https?:\/\/[^"]+)"/);
    if (m1 && m1[1] && !m1[1].includes('google.com')) return m1[1];
    
    // Pattern 2: jslog URL
    var m2 = html.match(/"(https?:\/\/(?!.*google\.com)[^"]{20,}?)"/);
    if (m2 && m2[1]) {
      var candidateUrl = m2[1];
      if (!candidateUrl.includes('google') && candidateUrl.startsWith('http')) return candidateUrl;
    }
    
    // Pattern 3: canonical link
    var m3 = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
    if (m3 && m3[1] && !m3[1].includes('google.com')) return m3[1];
    
    // Pattern 4: og:url
    var m4 = html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i);
    if (m4 && m4[1] && !m4[1].includes('google.com')) return m4[1];

    // Pattern 5: href links se newspaper URL
    var hrefMatches = html.match(/href="(https?:\/\/(?!.*google\.com)[^"]{30,}?)"/g);
    if (hrefMatches) {
      for (var i = 0; i < hrefMatches.length && i < 10; i++) {
        var hrefUrl = hrefMatches[i].match(/href="([^"]+)"/)[1];
        if (hrefUrl && !hrefUrl.includes('google') && !hrefUrl.includes('youtube') && 
            !hrefUrl.includes('gstatic') && hrefUrl.length > 30) {
          return hrefUrl;
        }
      }
    }
  } catch(e) {
    console.log('  URL resolve error:', e.message);
  }
  
  return googleUrl; // Fallback — original URL
}

// ── Article se og:image nikalo ──
async function getImage(articleUrl) {
  if (!articleUrl || articleUrl === '#' || articleUrl.includes('news.google.com')) return '';
  try {
    var html = await simpleGet(articleUrl, 8000);
    if (!html || html.length < 100) return '';
    var patterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var match = html.match(patterns[i]);
      if (match && match[1]) {
        var imgUrl = match[1].trim();
        if (imgUrl.startsWith('http') && imgUrl.length > 15) return imgUrl;
      }
    }
  } catch(e) {}
  return '';
}

// ── RSS Parse ──
function parseRSS(xml) {
  var items = [];
  var re = /<item>([\s\S]*?)<\/item>/g;
  var m;
  while ((m = re.exec(xml)) !== null) {
    var x = m[1];
    var tm = x.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/);
    var tp = x.match(/<title>([^<]{3,})<\/title>/);
    var title = ((tm ? tm[1] : (tp ? tp[1] : '')) || '').trim();
    title = title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
    if (!title || title.length < 5) continue;

    var lm = x.match(/<link>([^<]+)<\/link>/);
    var link = (lm ? lm[1].trim() : '') || '#';

    var dm = x.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/);
    var dp = x.match(/<description>([^<]{5,})<\/description>/);
    var desc = ((dm ? dm[1] : (dp ? dp[1] : '')) || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    desc = desc.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').trim();
    if (desc.length > 220) desc = desc.substring(0, 220) + '...';

    var sm = x.match(/<source[^>]*>([^<]+)<\/source>/);
    var source = sm ? sm[1].trim() : '';
    if (!source) {
      try { source = new URL(link).hostname.replace('www.','').split('.')[0]; } catch(e) { source = 'News'; }
    }

    var imgM = x.match(/<media:content[^>]+url=["']([^"']+)["']/i)
             || x.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
    var rssImage = (imgM && imgM[1] && imgM[1].startsWith('http')) ? imgM[1] : '';

    items.push({ title, url: link, description: desc, source, rssImage, pubDate: new Date().toISOString() });
  }
  return items;
}

// ── Agriculture check ──
function isAgri(title, desc) {
  var text = (title + ' ' + (desc||'')).toLowerCase();
  var kw = [
    'kisan','farmer','farming','agriculture','agri','crop','fasal','mandi','krishi',
    'खेती','किसान','फसल','कृषि','मंडी','msp','wheat','rice','paddy','soybean',
    'cotton','sugarcane','गेहूं','धान','गन्ना','कपास','monsoon','rain','drought',
    'irrigation','मानसून','बारिश','fertilizer','pesticide','seed','soil','खाद',
    'बीज','मिट्टी','pm-kisan','pm kisan','kcc','nabard','subsidy','yojana',
    'सब्सिडी','योजना','harvest','sowing','rabi','kharif','pest','disease','locust',
    'टिड्डी','कीट','रोग','export','apeda','icar','farm','agmarknet',
    'agricultural','horticulture','dairy','livestock','budget kisan'
  ];
  return kw.some(function(k) { return text.indexOf(k) !== -1; });
}

var FEEDS = [
  'https://news.google.com/rss/search?q=kisan+krishi+farming+India&hl=hi&gl=IN&ceid=IN:hi',
  'https://news.google.com/rss/search?q=agriculture+farmers+India+crop&hl=en&gl=IN&ceid=IN:en',
  'https://news.google.com/rss/search?q=MSP+mandi+fasal+India&hl=hi&gl=IN&ceid=IN:hi',
  'https://news.google.com/rss/search?q=PM+kisan+yojana+India&hl=hi&gl=IN&ceid=IN:hi',
  'https://news.google.com/rss/search?q=Indian+farmer+crop+price+news&hl=en&gl=IN&ceid=IN:en',
];

async function main() {
  console.log('=== BH Krishi Samachar ===', new Date().toISOString());

  // Step 1: RSS fetch
  var all = [];
  for (var i = 0; i < FEEDS.length; i++) {
    console.log('Feed', i+1, '/', FEEDS.length);
    try {
      var result = await fetchURL(FEEDS[i], 20000);
      var xml = result.body || '';
      if (xml && xml.includes('<item>')) {
        var items = parseRSS(xml);
        console.log('  Items:', items.length);
        all = all.concat(items);
      } else {
        console.log('  Empty');
      }
    } catch(e) { console.log('  Error:', e.message); }
    await new Promise(function(r) { setTimeout(r, 600); });
  }

  // Step 2: Filter + deduplicate
  var seen = {};
  var filtered = [];
  for (var j = 0; j < all.length; j++) {
    var a = all[j];
    var key = a.title.substring(0,40).toLowerCase().replace(/\s+/g,'');
    if (seen[key]) continue;
    if (!isAgri(a.title, a.description)) continue;
    seen[key] = true;
    filtered.push(a);
    if (filtered.length >= 18) break;
  }
  console.log('Filtered:', filtered.length, 'articles');

  if (filtered.length === 0) {
    fs.writeFileSync('news.json', JSON.stringify({updated:new Date().toISOString(),count:0,articles:[]},null,2),'utf8');
    return;
  }

  // Step 3: Top 15 — Real URLs + Images fetch karo
  var top = filtered.slice(0, 15);
  var result = [];

  for (var k = 0; k < top.length; k++) {
    var art = top[k];
    console.log('[' + (k+1) + '/' + top.length + ']', art.source, '-', art.title.substring(0,35));

    // Google News URL ko real URL mein convert karo
    var realUrl = art.url;
    if (art.url && art.url.includes('news.google.com')) {
      realUrl = await resolveGoogleNewsUrl(art.url);
      if (realUrl !== art.url) {
        console.log('  Resolved:', realUrl.substring(0,50));
      } else {
        console.log('  Could not resolve Google URL');
      }
    }

    // Image fetch karo
    var image = art.rssImage || '';
    if (!image && realUrl && realUrl !== '#' && !realUrl.includes('news.google.com')) {
      image = await getImage(realUrl);
      if (image) console.log('  Image:', image.substring(0,50));
    }

    result.push({
      title: art.title,
      url: realUrl,        // Real article URL — Visit Source yahan jaayega
      description: art.description,
      source: art.source,
      image: image,        // Real article image
      pubDate: art.pubDate
    });

    await new Promise(function(r) { setTimeout(r, 500); });
  }

  // Step 4: Save
  var output = { updated: new Date().toISOString(), count: result.length, articles: result };
  fs.writeFileSync('news.json', JSON.stringify(output, null, 2), 'utf8');

  var imgCount = result.filter(function(a) { return a.image; }).length;
  var resolvedCount = result.filter(function(a) { return !a.url.includes('news.google.com'); }).length;
  console.log('DONE! Articles:', result.length, '| Images:', imgCount, '| Resolved URLs:', resolvedCount);
}

main().catch(function(e) {
  console.error('FATAL:', e.message);
  fs.writeFileSync('news.json', JSON.stringify({updated:new Date().toISOString(),count:0,articles:[]},null,2),'utf8');
  process.exit(0);
});

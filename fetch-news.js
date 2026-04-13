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
      var options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121',
          'Accept': 'text/html,application/xhtml+xml,application/xml,*/*',
          'Accept-Language': 'hi-IN,hi;q=0.9,en;q=0.8',
          'Connection': 'keep-alive'
        },
        timeout: timeoutMs
      };
      var req = lib.get(options, function(res) {
        // Handle redirects
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
          var loc = res.headers.location;
          if (!loc.startsWith('http')) loc = parsed.protocol + '//' + parsed.hostname + loc;
          res.resume();
          return fetchURL(loc, timeoutMs).then(resolve);
        }
        var data = '';
        res.setEncoding('utf8');
        res.on('data', function(c) { if (data.length < 500000) data += c; });
        res.on('end', function() { resolve(data); });
        res.on('error', function() { resolve(''); });
      });
      req.on('error', function() { resolve(''); });
      req.on('timeout', function() { req.destroy(); resolve(''); });
    } catch(e) { resolve(''); }
  });
}

// ── Google News URL ko Real URL mein convert karo ──
function decodeGoogleNewsUrl(url) {
  if (!url) return '';
  if (!url.includes('news.google.com')) return url;

  // Method 1: url= parameter
  var urlParam = url.match(/[?&]url=([^&]+)/);
  if (urlParam) {
    try { return decodeURIComponent(urlParam[1]); } catch(e) {}
  }

  // Method 2: __i/ pattern (Google News article links)
  var articleMatch = url.match(/articles\/([^?]+)/);
  if (articleMatch) {
    // Ye Google ka encoded URL hai — seedha return karo, browser handle karega
    return url;
  }

  return url;
}

// ── Article se og:image nikalo ──
async function getImage(articleUrl) {
  if (!articleUrl || articleUrl === '#' || articleUrl.includes('news.google.com')) return '';
  try {
    var html = await fetchURL(articleUrl, 8000);
    if (!html || html.length < 100) return '';

    // og:image try karo
    var patterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
      /<meta[^>]+name=["']twitter:image:src["'][^>]+content=["']([^"']+)["']/i,
    ];

    for (var i = 0; i < patterns.length; i++) {
      var match = html.match(patterns[i]);
      if (match && match[1]) {
        var imgUrl = match[1].trim();
        if (imgUrl.startsWith('http') && !imgUrl.includes('logo') && !imgUrl.includes('icon')) {
          return imgUrl;
        }
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

    // Title
    var tm = x.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/);
    var tp = x.match(/<title>([^<]*)<\/title>/);
    var title = ((tm ? tm[1] : (tp ? tp[1] : '')) || '').trim();
    title = title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
    if (!title || title.length < 5) continue;

    // Link — Google News ke links decode karo
    var lm = x.match(/<link>([^<]*)<\/link>/);
    var rawLink = lm ? lm[1].trim() : '';
    var link = decodeGoogleNewsUrl(rawLink) || rawLink || '#';

    // Description
    var dm = x.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/);
    var dp = x.match(/<description>([^<]*)<\/description>/);
    var desc = ((dm ? dm[1] : (dp ? dp[1] : '')) || '').replace(/<[^>]*>/g,' ').trim();
    desc = desc.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
    if (desc.length > 200) desc = desc.substring(0, 200) + '...';

    // Source name
    var sm = x.match(/<source[^>]*>([^<]*)<\/source>/);
    var source = sm ? sm[1].trim() : '';
    if (!source) {
      try { source = new URL(link).hostname.replace('www.','').split('.')[0]; } catch(e) { source = 'News'; }
    }

    // RSS mein image check karo
    var imgM = x.match(/<media:content[^>]+url=["']([^"']+)["']/i)
             || x.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i)
             || x.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image/i);
    var rssImage = (imgM && imgM[1] && imgM[1].startsWith('http')) ? imgM[1] : '';

    items.push({ title, url: link, description: desc, source, rssImage, pubDate: new Date().toISOString() });
  }
  return items;
}

// ── Agriculture keywords check ──
function isAgri(title, desc) {
  var text = (title + ' ' + (desc||'')).toLowerCase();
  var kw = [
    'kisan','farmer','farming','agriculture','agri','crop','fasal','mandi','krishi',
    'खेती','किसान','फसल','कृषि','मंडी','msp','wheat','rice','paddy','soybean',
    'cotton','sugarcane','गेहूं','धान','गन्ना','कपास','monsoon','rain','drought',
    'irrigation','मानसून','बारिश','fertilizer','pesticide','seed','soil','खाद',
    'बीज','मिट्टी','pm-kisan','pm kisan','kcc','nabard','subsidy','yojana',
    'सब्सिडी','योजना','harvest','sowing','rabi','kharif','pest','disease','locust',
    'टिड्डी','कीट','रोग','export','apeda','icar','farm law','agmarknet',
    'agricultural','horticulture','dairy','fishery','livestock'
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
      var xml = await fetchURL(FEEDS[i], 20000);
      if (xml && xml.includes('<item>')) {
        var items = parseRSS(xml);
        console.log('  Items:', items.length);
        all = all.concat(items);
      } else {
        console.log('  Empty response');
      }
    } catch(e) { console.log('  Error:', e.message); }
    await new Promise(function(r) { setTimeout(r, 500); });
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
    if (filtered.length >= 20) break;
  }
  console.log('Filtered articles:', filtered.length);

  if (filtered.length === 0) {
    console.log('No articles found!');
    fs.writeFileSync('news.json', JSON.stringify({updated:new Date().toISOString(),count:0,articles:[]},null,2),'utf8');
    return;
  }

  // Step 3: Top 15 ke liye images fetch karo
  var top = filtered.slice(0, 15);
  console.log('Fetching images for', top.length, 'articles...');
  var result = [];

  for (var k = 0; k < top.length; k++) {
    var art = top[k];
    var image = art.rssImage || '';

    // Article URL se image fetch karo (agar Google News URL nahi hai)
    if (!image && art.url && art.url !== '#' && !art.url.includes('news.google.com')) {
      image = await getImage(art.url);
      if (image) console.log('  [', k+1, '] Image found:', art.source);
      else console.log('  [', k+1, '] No image:', art.source);
    } else if (art.url.includes('news.google.com')) {
      console.log('  [', k+1, '] Google News URL - no image fetch:', art.title.substring(0,30));
    }

    result.push({
      title: art.title,
      url: art.url,
      description: art.description,
      source: art.source,
      image: image,
      pubDate: art.pubDate
    });

    await new Promise(function(r) { setTimeout(r, 400); });
  }

  // Step 4: Save
  var output = { updated: new Date().toISOString(), count: result.length, articles: result };
  fs.writeFileSync('news.json', JSON.stringify(output, null, 2), 'utf8');

  var imgCount = result.filter(function(a) { return a.image; }).length;
  console.log('DONE! Articles:', result.length, '| With images:', imgCount);
}

main().catch(function(e) {
  console.error('FATAL:', e.message);
  fs.writeFileSync('news.json', JSON.stringify({updated:new Date().toISOString(),count:0,articles:[]},null,2),'utf8');
  process.exit(0);
});

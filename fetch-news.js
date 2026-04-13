const https = require('https');
const http = require('http');
const fs = require('fs');

// ── URL Fetch karo ──
function fetchURL(rawUrl, timeout) {
  timeout = timeout || 15000;
  return new Promise(function(resolve) {
    try {
      var parsed = new URL(rawUrl);
      var lib = parsed.protocol === 'https:' ? https : http;
      var req = lib.get({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
          'Accept': 'text/html,application/xml,application/rss+xml,*/*',
          'Accept-Language': 'hi-IN,hi;q=0.9,en;q=0.8'
        }
      }, function(res) {
        // Redirect handle karo
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          var loc = res.headers.location;
          if (!loc.startsWith('http')) loc = parsed.protocol + '//' + parsed.hostname + loc;
          return fetchURL(loc, timeout).then(resolve);
        }
        var data = '';
        res.setEncoding('utf8');
        res.on('data', function(c) { data += c; });
        res.on('end', function() { resolve(data); });
      });
      req.on('error', function() { resolve(''); });
      var timer = setTimeout(function() { req.destroy(); resolve(''); }, timeout);
      req.on('close', function() { clearTimeout(timer); });
    } catch(e) { resolve(''); }
  });
}

// ── og:image nikalo article se ──
async function getArticleImage(articleUrl) {
  if (!articleUrl || articleUrl === '#') return '';
  try {
    var html = await fetchURL(articleUrl, 8000);
    if (!html) return '';
    // og:image dhundho
    var ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogMatch && ogMatch[1]) {
      var imgUrl = ogMatch[1].trim();
      if (imgUrl.startsWith('http')) return imgUrl;
    }
    // twitter:image bhi try karo
    var twMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    if (twMatch && twMatch[1]) {
      var twUrl = twMatch[1].trim();
      if (twUrl.startsWith('http')) return twUrl;
    }
  } catch(e) {}
  return '';
}

// ── RSS Parse karo ──
function parseRSS(xml) {
  var items = [];
  var re = /<item>([\s\S]*?)<\/item>/g;
  var m;
  while ((m = re.exec(xml)) !== null) {
    var x = m[1];
    // Title
    var tm = x.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/);
    var tp = x.match(/<title>([\s\S]*?)<\/title>/);
    var title = (tm ? tm[1] : (tp ? tp[1] : '')).trim();
    title = title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');

    // Link
    var lm = x.match(/<link>([\s\S]*?)<\/link>/);
    var link = lm ? lm[1].trim() : '#';
    // Google News redirect fix
    if (link.includes('news.google.com')) {
      var urlMatch = link.match(/url=([^&]+)/);
      if (urlMatch) { try { link = decodeURIComponent(urlMatch[1]); } catch(e) {} }
    }

    // Description
    var dm = x.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/);
    var dp = x.match(/<description>([\s\S]*?)<\/description>/);
    var desc = (dm ? dm[1] : (dp ? dp[1] : '')).replace(/<[^>]*>/g,'').trim();
    desc = desc.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').trim();
    if (desc.length > 250) desc = desc.substring(0, 250) + '...';

    // Source
    var sm = x.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    var source = sm ? sm[1].trim() : '';
    if (!source) {
      try { source = new URL(link).hostname.replace('www.',''); } catch(e) { source = 'News'; }
    }

    // Media image (RSS mein)
    var imgMatch = x.match(/<media:content[^>]+url=["']([^"']+)["']/i)
                 || x.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i)
                 || x.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image/i);
    var rssImage = imgMatch ? imgMatch[1] : '';

    if (title && title.length > 5) {
      items.push({ title, url: link, description: desc, source, rssImage, pubDate: new Date().toISOString() });
    }
  }
  return items;
}

// ── Agriculture check ──
function isAgri(title, desc) {
  var text = (title + ' ' + desc).toLowerCase();
  var keywords = [
    'kisan','farmer','farming','agriculture','agri','crop','fasal','mandi','krishi',
    'खेती','किसान','फसल','कृषि','मंडी','बुवाई','msp','wheat','rice','paddy','soybean',
    'cotton','sugarcane','gehu','dhan','गेहूं','धान','गन्ना','कपास','monsoon','rain',
    'drought','irrigation','मानसून','बारिश','सिंचाई','fertilizer','pesticide','seed',
    'soil','खाद','बीज','मिट्टी','pm-kisan','kcc','nabard','subsidy','yojana','सब्सिडी',
    'योजना','harvest','sowing','rabi','kharif','खरीफ','रबी','pest','disease','locust',
    'टिड्डी','कीट','रोग','export','agmarknet','apeda','icar','budget kisan','farm'
  ];
  return keywords.some(function(kw) { return text.indexOf(kw) !== -1; });
}

// ── RSS Feeds ──
var FEEDS = [
  'https://news.google.com/rss/search?q=kisan+krishi+India+farming&hl=hi&gl=IN&ceid=IN:hi',
  'https://news.google.com/rss/search?q=agriculture+farmers+India+crop&hl=en&gl=IN&ceid=IN:en',
  'https://news.google.com/rss/search?q=MSP+mandi+fasal+price+India&hl=hi&gl=IN&ceid=IN:hi',
  'https://news.google.com/rss/search?q=PM+kisan+yojana+subsidy+India&hl=hi&gl=IN&ceid=IN:hi',
  'https://news.google.com/rss/search?q=Indian+farmer+agriculture+news&hl=en&gl=IN&ceid=IN:en',
];

async function main() {
  console.log('=== BH Krishi Samachar News Fetch ===');
  console.log('Time:', new Date().toISOString());

  var all = [];

  // RSS feeds fetch karo
  for (var i = 0; i < FEEDS.length; i++) {
    console.log('Feed', i+1, 'of', FEEDS.length, '...');
    try {
      var xml = await fetchURL(FEEDS[i], 20000);
      if (xml && xml.indexOf('<item>') !== -1) {
        var items = parseRSS(xml);
        console.log('  Got', items.length, 'items');
        all = all.concat(items);
      } else {
        console.log('  No items or empty response');
      }
    } catch(e) {
      console.log('  Error:', e.message);
    }
    // Rate limiting
    await new Promise(function(r) { setTimeout(r, 800); });
  }

  // Agriculture filter + deduplicate
  var seen = {};
  var filtered = [];
  for (var j = 0; j < all.length; j++) {
    var a = all[j];
    var key = a.title.substring(0, 45).toLowerCase().replace(/\s+/g,'');
    if (seen[key]) continue;
    if (!isAgri(a.title, a.description)) continue;
    seen[key] = true;
    filtered.push(a);
    if (filtered.length >= 18) break;
  }

  console.log('Agriculture articles after filter:', filtered.length);

  if (filtered.length === 0) {
    console.log('No articles! Saving empty JSON.');
    var empty = { updated: new Date().toISOString(), count: 0, articles: [] };
    fs.writeFileSync('news.json', JSON.stringify(empty, null, 2), 'utf8');
    return;
  }

  // Top 15 articles ke liye images fetch karo
  var top15 = filtered.slice(0, 15);
  console.log('Fetching images for', top15.length, 'articles...');

  var withImages = [];
  for (var k = 0; k < top15.length; k++) {
    var article = top15[k];
    var image = article.rssImage || '';

    // Agar RSS mein image nahi thi toh article se og:image nikalo
    if (!image && article.url && article.url !== '#' && !article.url.includes('news.google.com')) {
      try {
        image = await getArticleImage(article.url);
        if (image) console.log('  Image found for:', article.title.substring(0, 40));
      } catch(e) {}
    }

    withImages.push({
      title: article.title,
      url: article.url,
      description: article.description,
      source: article.source,
      image: image,
      pubDate: article.pubDate
    });

    // Thodi delay - servers ke liye
    await new Promise(function(r) { setTimeout(r, 300); });
  }

  // news.json save karo
  var output = {
    updated: new Date().toISOString(),
    count: withImages.length,
    articles: withImages
  };

  fs.writeFileSync('news.json', JSON.stringify(output, null, 2), 'utf8');
  console.log('SUCCESS! Saved', withImages.length, 'articles with images!');
  
  // Sample check
  var withImg = withImages.filter(function(a) { return a.image; }).length;
  console.log('Articles with images:', withImg, 'of', withImages.length);
}

main().catch(function(e) {
  console.error('FATAL ERROR:', e.message);
  var empty = { updated: new Date().toISOString(), count: 0, articles: [] };
  fs.writeFileSync('news.json', JSON.stringify(empty, null, 2), 'utf8');
  process.exit(0);
});

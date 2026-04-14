const https = require('https');
const http = require('http');
const fs = require('fs');

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

// og:image nikalo
async function getImage(url) {
  if (!url || url === '#' || url.includes('news.google.com')) return '';
  try {
    var html = await get(url, 7000);
    if (!html) return '';
    var ps = [
      /property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
      /content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
      /name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
      /content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
    ];
    for (var i = 0; i < ps.length; i++) {
      var m = html.match(ps[i]);
      if (m && m[1] && m[1].startsWith('http') && m[1].length > 20) return m[1];
    }
  } catch(e) {}
  return '';
}

// RSS parse
function parse(xml, sourceName, forceLang) {
  var items = [];
  var re = /<item>([\s\S]*?)<\/item>/g;
  var m;
  while ((m = re.exec(xml)) !== null) {
    var x = m[1];
    var t1 = x.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/);
    var t2 = x.match(/<title>([^<]+)<\/title>/);
    var title = ((t1 ? t1[1] : (t2 ? t2[1] : '')) || '').trim();
    title = title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
    if (!title || title.length < 5) continue;

    var l1 = x.match(/<link>([^<]+)<\/link>/);
    var l2 = x.match(/<guid[^>]*>([^<]+)<\/guid>/);
    var link = (l1 ? l1[1].trim() : '') || (l2 ? l2[1].trim() : '') || '#';

    var d1 = x.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/);
    var d2 = x.match(/<description>([^<]+)<\/description>/);
    var desc = ((d1 ? d1[1] : (d2 ? d2[1] : '')) || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    desc = desc.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').trim();
    if (desc.length > 220) desc = desc.substring(0,220)+'...';

    // Source nikalo — RSS source tag ya title ke end se
    var sm = x.match(/<source[^>]*>([^<]+)<\/source>/);
    var source = sm ? sm[1].trim() : '';
    
    // Google News titles mein newspaper naam hota hai — "News title - Newspaper Name"
    if (!source || source === 'Google News') {
      var titleParts = title.split(' - ');
      if (titleParts.length > 1) {
        var possibleSource = titleParts[titleParts.length - 1].trim();
        // Valid newspaper naam check karo — chota hona chahiye
        if (possibleSource.length > 2 && possibleSource.length < 50) {
          source = possibleSource;
          // Title se source naam remove karo
          title = titleParts.slice(0, -1).join(' - ').trim();
        }
      }
    }
    if (!source) source = sourceName;

    var im = x.match(/<media:content[^>]+url=["']([^"']+)["']/i)
           || x.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
    var rssImg = (im && im[1] && im[1].startsWith('http')) ? im[1] : '';

    // Language detect — forceLang se ya title se
    var lang = forceLang;
    if (!lang) {
      lang = /[\u0900-\u097F]/.test(title) ? 'hi' : 'en';
    }

    if (title && link && link !== '#') {
      items.push({ title, url: link, description: desc, source, rssImg, lang, pubDate: new Date().toISOString() });
    }
  }
  return items;
}

// Agriculture check
function isAgri(title, desc) {
  var text = (title + ' ' + (desc||'')).toLowerCase();
  var kw = [
    'kisan','farmer','farming','agriculture','agri','crop','fasal','mandi','krishi',
    'खेती','किसान','फसल','कृषि','मंडी','msp','wheat','rice','paddy','soybean',
    'cotton','sugarcane','गेहूं','धान','मानसून','बारिश','fertilizer','pesticide',
    'seed','soil','खाद','बीज','pm-kisan','pm kisan','kcc','nabard','subsidy',
    'yojana','सब्सिडी','योजना','harvest','sowing','rabi','kharif','pest',
    'disease','टिड्डी','कीट','रोग','export','apeda','icar','farm','agmarknet',
    'agricultural','horticulture','dairy','livestock','rural','gaon','village farm',
    'crop price','seed price','irrigation','drip','greenhouse','organic farm'
  ];
  return kw.some(function(k) { return text.indexOf(k) !== -1; });
}

// ── HINDI Feeds ──
var HINDI_FEEDS = [
  // Direct Hindi sources
  { url: 'https://krishakjagat.org/feed/', name: 'Krishak Jagat', lang: 'hi' },
  { url: 'https://kisansamadhan.com/feed/', name: 'Kisan Samadhan', lang: 'hi' },
  { url: 'https://www.gaonconnection.com/feed', name: 'Gaon Connection', lang: 'hi' },
  { url: 'https://hindi.krishijagran.com/feed/', name: 'Krishi Jagran', lang: 'hi' },
  // Google News Hindi — alag alag topics se news aayegi
  { url: 'https://news.google.com/rss/search?q=kisan+mandi+fasal+bhav+India&hl=hi&gl=IN&ceid=IN:hi', name: 'Hindi News', lang: 'hi' },
  { url: 'https://news.google.com/rss/search?q=gehu+dhan+sarson+MSP+kharidi&hl=hi&gl=IN&ceid=IN:hi', name: 'Hindi News', lang: 'hi' },
  { url: 'https://news.google.com/rss/search?q=pm+kisan+yojana+kheti+subsidy&hl=hi&gl=IN&ceid=IN:hi', name: 'Hindi News', lang: 'hi' },
  { url: 'https://news.google.com/rss/search?q=krishi+vibhag+kisan+loan+bima&hl=hi&gl=IN&ceid=IN:hi', name: 'Hindi News', lang: 'hi' },
];

// ── ENGLISH Feeds ──  
var ENGLISH_FEEDS = [
  // Direct English sources
  { url: 'https://www.downtoearth.org.in/rss/agriculture', name: 'Down to Earth', lang: 'en' },
  { url: 'https://www.agrihunt.com/feed/', name: 'AgriHunt', lang: 'en' },
  // Google News English — TOI HT ET NDTV ki news aayegi automatically
  { url: 'https://news.google.com/rss/search?q=agriculture+farmer+India+crop&hl=en&gl=IN&ceid=IN:en', name: 'English News', lang: 'en' },
  { url: 'https://news.google.com/rss/search?q=Indian+farmer+MSP+wheat+rice+price&hl=en&gl=IN&ceid=IN:en', name: 'English News', lang: 'en' },
  { url: 'https://news.google.com/rss/search?q=India+agriculture+scheme+subsidy+kisan&hl=en&gl=IN&ceid=IN:en', name: 'English News', lang: 'en' },
  { url: 'https://news.google.com/rss/search?q=farm+crop+harvest+mandi+India+2025&hl=en&gl=IN&ceid=IN:en', name: 'English News', lang: 'en' },
  { url: 'https://news.google.com/rss/search?q=India+agri+budget+irrigation+drip+organic&hl=en&gl=IN&ceid=IN:en', name: 'English News', lang: 'en' },
];

async function fetchAndFilter(feeds) {
  var all = [];
  for (var i = 0; i < feeds.length; i++) {
    var feed = feeds[i];
    console.log('  Fetching:', feed.name, '(' + feed.lang + ')');
    try {
      var xml = await get(feed.url, 15000);
      if (xml && xml.includes('<item>')) {
        var items = parse(xml, feed.name, feed.lang);
        console.log('    Got', items.length, 'items');
        all = all.concat(items);
      } else {
        console.log('    Empty response');
      }
    } catch(e) { console.log('    Error:', e.message); }
    await new Promise(function(r) { setTimeout(r, 400); });
  }

  // Filter agriculture + deduplicate
  var seen = {};
  var filtered = [];
  for (var j = 0; j < all.length; j++) {
    var a = all[j];
    var key = a.title.substring(0,40).toLowerCase().replace(/\s+/g,'');
    if (seen[key]) continue;
    if (!isAgri(a.title, a.description)) continue;
    seen[key] = true;
    filtered.push(a);
    if (filtered.length >= 15) break;
  }
  return filtered;
}

async function fetchImages(articles) {
  var result = [];
  for (var k = 0; k < articles.length; k++) {
    var art = articles[k];
    var image = art.rssImg || '';
    if (!image && art.url && !art.url.includes('news.google.com')) {
      image = await getImage(art.url);
    }
    result.push({
      title: art.title,
      url: art.url,
      description: art.description,
      source: art.source,
      image: image,
      lang: art.lang,
      pubDate: art.pubDate
    });
    await new Promise(function(r) { setTimeout(r, 300); });
  }
  return result;
}

async function main() {
  console.log('=== BH Krishi Samachar ===', new Date().toISOString());

  // Hindi articles fetch karo
  console.log('\n--- HINDI FEEDS ---');
  var hindiRaw = await fetchAndFilter(HINDI_FEEDS);
  console.log('Hindi articles:', hindiRaw.length);

  // English articles fetch karo
  console.log('\n--- ENGLISH FEEDS ---');
  var englishRaw = await fetchAndFilter(ENGLISH_FEEDS);
  console.log('English articles:', englishRaw.length);

  // Images fetch karo
  console.log('\n--- FETCHING IMAGES ---');
  var hindiArticles = await fetchImages(hindiRaw.slice(0, 15));
  var englishArticles = await fetchImages(englishRaw.slice(0, 15));

  // news.json mein dono alag save karo
  var output = {
    updated: new Date().toISOString(),
    count: hindiArticles.length + englishArticles.length,
    // Hindi articles
    hi_articles: hindiArticles,
    // English articles
    en_articles: englishArticles,
    // Default (Hindi) — backward compatibility
    articles: hindiArticles
  };

  fs.writeFileSync('news.json', JSON.stringify(output, null, 2), 'utf8');

  var hiImg = hindiArticles.filter(function(a) { return a.image; }).length;
  var enImg = englishArticles.filter(function(a) { return a.image; }).length;
  console.log('\n=== DONE! ===');
  console.log('Hindi:', hindiArticles.length, '| Images:', hiImg);
  console.log('English:', englishArticles.length, '| Images:', enImg);
}

main().catch(function(e) {
  console.error('FATAL:', e.message);
  fs.writeFileSync('news.json', JSON.stringify({
    updated: new Date().toISOString(), count: 0,
    hi_articles: [], en_articles: [], articles: []
  }, null, 2), 'utf8');
  process.exit(0);
});

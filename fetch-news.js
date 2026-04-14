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

    var sm = x.match(/<source[^>]*>([^<]+)<\/source>/);
    var source = sm ? sm[1].trim() : sourceName;

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
  // Direct Hindi agriculture sources
  { url: 'https://krishakjagat.org/feed/', name: 'Krishak Jagat', lang: 'hi' },
  { url: 'https://kisansamadhan.com/feed/', name: 'Kisan Samadhan', lang: 'hi' },
  { url: 'https://www.gaonconnection.com/feed', name: 'Gaon Connection', lang: 'hi' },
  { url: 'https://hindi.krishijagran.com/feed/', name: 'Krishi Jagran', lang: 'hi' },
  // Google News Hindi — multiple queries for variety
  { url: 'https://news.google.com/rss/search?q=kisan+krishi+mandi+fasal+India&hl=hi&gl=IN&ceid=IN:hi', name: 'Patrika', lang: 'hi' },
  { url: 'https://news.google.com/rss/search?q=MSP+kisan+yojana+subsidy+gehu+dhan&hl=hi&gl=IN&ceid=IN:hi', name: 'Jagran', lang: 'hi' },
  { url: 'https://news.google.com/rss/search?q=kheti+badi+kisan+samachar+aaj&hl=hi&gl=IN&ceid=IN:hi', name: 'Amar Ujala', lang: 'hi' },
  { url: 'https://news.google.com/rss/search?q=krishi+vibhag+kisan+loan+nabard&hl=hi&gl=IN&ceid=IN:hi', name: 'Dainik Bhaskar', lang: 'hi' },
];

// ── ENGLISH Feeds ──
var ENGLISH_FEEDS = [
  // Google News English — specifically TOI, HT, Economic Times
  { url: 'https://news.google.com/rss/search?q=agriculture+farmer+India+crop+price&hl=en&gl=IN&ceid=IN:en', name: 'Times of India', lang: 'en' },
  { url: 'https://news.google.com/rss/search?q=Indian+farmer+MSP+wheat+rice+agriculture&hl=en&gl=IN&ceid=IN:en', name: 'Hindustan Times', lang: 'en' },
  { url: 'https://news.google.com/rss/search?q=farm+sector+India+agri+budget+subsidy&hl=en&gl=IN&ceid=IN:en', name: 'Economic Times', lang: 'en' },
  { url: 'https://news.google.com/rss/search?q=kisan+agriculture+scheme+India+news+english&hl=en&gl=IN&ceid=IN:en', name: 'NDTV', lang: 'en' },
  { url: 'https://news.google.com/rss/search?q=crop+harvest+mandi+price+India+farmers&hl=en&gl=IN&ceid=IN:en', name: 'Business Standard', lang: 'en' },
  // Direct English sources
  { url: 'https://www.downtoearth.org.in/rss/agriculture', name: 'Down to Earth', lang: 'en' },
  { url: 'https://www.agrihunt.com/feed/', name: 'AgriHunt', lang: 'en' },
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

/**
 * Fetches FIFA World Cup 2026 results using ESPN's public API — no API key required.
 * Iterates each tournament date and collects finished match scores.
 *
 * Run manually: node .github/scripts/fetch-results.mjs
 */

import { writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, '../../public/results.json');

const GROUP_MAP = {
  A: ['MEX','RSA','KOR','CZE'],
  B: ['CAN','BIH','QAT','SUI'],
  C: ['BRA','MAR','HAI','SCO'],
  D: ['USA','PAR','AUS','TUR'],
  E: ['GER','CUW','CIV','ECU'],
  F: ['NED','JPN','SWE','TUN'],
  G: ['BEL','EGY','IRN','NZL'],
  H: ['ESP','CPV','KSA','URU'],
  I: ['FRA','SEN','IRQ','NOR'],
  J: ['ARG','ALG','AUT','JOR'],
  K: ['POR','COD','UZB','COL'],
  L: ['ENG','CRO','GHA','PAN'],
};

const VALID_CODES = new Set([
  'MEX','RSA','KOR','CZE','CAN','BIH','QAT','SUI','BRA','MAR','HAI','SCO',
  'USA','PAR','AUS','TUR','GER','CUW','CIV','ECU','NED','JPN','SWE','TUN',
  'BEL','EGY','IRN','NZL','ESP','CPV','KSA','URU','FRA','SEN','IRQ','NOR',
  'ARG','ALG','AUT','JOR','POR','COD','UZB','COL','ENG','CRO','GHA','PAN',
]);

// ESPN abbreviation overrides where ESPN differs from our codes
const ABBR_MAP = {
  'ZAF': 'RSA', 'CIV': 'CIV', 'CUW': 'CUW', 'BIH': 'BIH',
  'KSA': 'KSA', 'CPV': 'CPV', 'COD': 'COD', 'UZB': 'UZB',
};

const NAME_MAP = {
  'Mexico':'MEX','South Africa':'RSA','Korea Republic':'KOR','South Korea':'KOR',
  'Czech Republic':'CZE','Czechia':'CZE','Canada':'CAN','Bosnia and Herzegovina':'BIH',
  'Bosnia & Herzegovina':'BIH','Qatar':'QAT','Switzerland':'SUI','Brazil':'BRA',
  'Morocco':'MAR','Haiti':'HAI','Scotland':'SCO','United States':'USA','Paraguay':'PAR',
  'Australia':'AUS','Turkey':'TUR','Türkiye':'TUR','Germany':'GER','Curaçao':'CUW',
  'Curacao':'CUW',"Côte d'Ivoire":'CIV','Ivory Coast':'CIV','Ecuador':'ECU',
  'Netherlands':'NED','Japan':'JPN','Sweden':'SWE','Tunisia':'TUN','Belgium':'BEL',
  'Egypt':'EGY','Iran':'IRN','New Zealand':'NZL','Spain':'ESP','Cape Verde':'CPV',
  'Saudi Arabia':'KSA','Uruguay':'URU','France':'FRA','Senegal':'SEN','Iraq':'IRQ',
  'Norway':'NOR','Argentina':'ARG','Algeria':'ALG','Austria':'AUT','Jordan':'JOR',
  'Portugal':'POR','DR Congo':'COD','Congo DR':'COD','Democratic Republic of Congo':'COD',
  'Uzbekistan':'UZB','Colombia':'COL','England':'ENG','Croatia':'CRO','Ghana':'GHA',
  'Panama':'PAN',
};

function resolveTeam(competitor) {
  const abbr = (competitor.team?.abbreviation || '').toUpperCase();
  const name = competitor.team?.displayName || competitor.team?.shortDisplayName || '';
  if (ABBR_MAP[abbr]) return ABBR_MAP[abbr];
  if (VALID_CODES.has(abbr)) return abbr;
  return NAME_MAP[name] || null;
}

function getGroup(codeA, codeB) {
  for (const [grp, teams] of Object.entries(GROUP_MAP)) {
    if (teams.includes(codeA) && teams.includes(codeB)) return grp;
  }
  return null;
}

function detectKnockoutRound(event, comp) {
  const txt = [event.name || '', ...(comp.notes || []).map(n => n.headline || '')].join(' ').toLowerCase();
  if (txt.includes('round of 32') || txt.includes('last 32')) return 'R32';
  if (txt.includes('round of 16') || txt.includes('last 16')) return 'R16';
  if (txt.includes('quarter')) return 'QF';
  if (txt.includes('semi')) return 'SF';
  if (txt.includes('final')) return 'FINAL';
  return null;
}

function formatDate(d) {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

async function fetchDay(dateStr) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateStr}&limit=20`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'WorldCupSimulator/1.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    return data.events || [];
  } catch {
    return [];
  }
}

async function main() {
  const today = new Date();
  const start = new Date('2026-06-11');
  const groupMatches = [];
  const knockoutMatches = [];
  const seen = new Set();

  const cur = new Date(start);
  while (cur <= today) {
    const events = await fetchDay(formatDate(cur));

    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const statusType = comp.status?.type;
      const isFinished = statusType?.completed === true;
      const isLive = statusType?.state === 'in';

      const competitors = comp.competitors || [];
      if (competitors.length !== 2) continue;

      const homeC = competitors.find(c => c.homeAway === 'home') || competitors[0];
      const awayC = competitors.find(c => c.homeAway === 'away') || competitors[1];

      const homeCode = resolveTeam(homeC);
      const awayCode = resolveTeam(awayC);
      if (!homeCode || !awayCode) continue;

      const pairKey = [homeCode, awayCode].sort().join('-');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const matchStatus = isFinished ? 'FINISHED' : isLive ? 'IN_PLAY' : 'SCHEDULED';
      const homeScore = (isFinished || isLive) ? (parseInt(homeC.score) ?? null) : null;
      const awayScore = (isFinished || isLive) ? (parseInt(awayC.score) ?? null) : null;

      const base = {
        homeTeam: homeCode,
        awayTeam: awayCode,
        homeScore: Number.isNaN(homeScore) ? null : homeScore,
        awayScore: Number.isNaN(awayScore) ? null : awayScore,
        status: matchStatus,
        utcDate: comp.date || event.date || null,
      };

      const group = getGroup(homeCode, awayCode);
      if (group) {
        groupMatches.push({ ...base, group });
      } else {
        const round = detectKnockoutRound(event, comp);
        if (round) knockoutMatches.push({ ...base, round });
      }
    }

    await new Promise(r => setTimeout(r, 300));
    cur.setDate(cur.getDate() + 1);
  }

  let existing = {};
  try { existing = JSON.parse(readFileSync(OUT_FILE, 'utf8')); } catch {}

  const finishedNow = groupMatches.filter(m => m.status === 'FINISHED').length;
  const finishedBefore = (existing.groupMatches || []).filter(m => m.status === 'FINISHED').length;

  if (finishedNow === finishedBefore && existing.lastUpdated) {
    console.log(`No new results (${finishedNow} finished). Skipping write.`);
    return;
  }

  writeFileSync(OUT_FILE, JSON.stringify({
    lastUpdated: new Date().toISOString(),
    groupMatches,
    knockoutMatches,
  }, null, 2));

  console.log(`Updated: ${finishedNow} group matches finished, ${knockoutMatches.filter(m => m.status==='FINISHED').length} knockout matches finished.`);
}

main().catch(err => { console.error(err); process.exit(1); });

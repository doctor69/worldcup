/**
 * Fetches FIFA World Cup 2026 match results from football-data.org
 * and writes them to public/results.json.
 *
 * Requires env var: FOOTBALL_API_KEY
 * Free tier: https://www.football-data.org/client/register
 *
 * Run manually: FOOTBALL_API_KEY=<key> node .github/scripts/fetch-results.mjs
 */

import { writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, '../../public/results.json');

const API_KEY = process.env.FOOTBALL_API_KEY;
if (!API_KEY) {
  console.error('FOOTBALL_API_KEY env var is not set. Skipping update.');
  process.exit(0);
}

// football-data.org TLA → app team code (only overrides where they differ)
const TLA_OVERRIDE = {
  'ZAF': 'RSA',  // South Africa
  'TUR': 'TUR',  // Türkiye (same)
  'BOI': 'BIH',  // Bosnia — just in case
};

// Full name → app team code (fallback when TLA doesn't match)
const NAME_TO_CODE = {
  'Mexico': 'MEX', 'South Africa': 'RSA', 'Korea Republic': 'KOR',
  'South Korea': 'KOR', 'Czechia': 'CZE', 'Czech Republic': 'CZE',
  'Canada': 'CAN', 'Bosnia and Herzegovina': 'BIH', 'Qatar': 'QAT',
  'Switzerland': 'SUI', 'Brazil': 'BRA', 'Morocco': 'MAR', 'Haiti': 'HAI',
  'Scotland': 'SCO', 'United States': 'USA', 'Paraguay': 'PAR',
  'Australia': 'AUS', 'Türkiye': 'TUR', 'Turkey': 'TUR', 'Germany': 'GER',
  'Curaçao': 'CUW', "Côte d'Ivoire": 'CIV', 'Ivory Coast': 'CIV',
  'Ecuador': 'ECU', 'Netherlands': 'NED', 'Japan': 'JPN', 'Sweden': 'SWE',
  'Tunisia': 'TUN', 'Belgium': 'BEL', 'Egypt': 'EGY', 'Iran': 'IRN',
  'New Zealand': 'NZL', 'Spain': 'ESP', 'Cape Verde': 'CPV',
  'Saudi Arabia': 'KSA', 'Uruguay': 'URU', 'France': 'FRA', 'Senegal': 'SEN',
  'Iraq': 'IRQ', 'Norway': 'NOR', 'Argentina': 'ARG', 'Algeria': 'ALG',
  'Austria': 'AUT', 'Jordan': 'JOR', 'Portugal': 'POR',
  'DR Congo': 'COD', 'Democratic Republic of Congo': 'COD', 'Congo DR': 'COD',
  'Uzbekistan': 'UZB', 'Colombia': 'COL', 'England': 'ENG', 'Croatia': 'CRO',
  'Ghana': 'GHA', 'Panama': 'PAN',
};

// All valid app codes (to detect if TLA already matches)
const VALID_CODES = new Set([
  'MEX','RSA','KOR','CZE','CAN','BIH','QAT','SUI','BRA','MAR','HAI','SCO',
  'USA','PAR','AUS','TUR','GER','CUW','CIV','ECU','NED','JPN','SWE','TUN',
  'BEL','EGY','IRN','NZL','ESP','CPV','KSA','URU','FRA','SEN','IRQ','NOR',
  'ARG','ALG','AUT','JOR','POR','COD','UZB','COL','ENG','CRO','GHA','PAN',
]);

function resolveTeam(team) {
  if (TLA_OVERRIDE[team.tla]) return TLA_OVERRIDE[team.tla];
  if (VALID_CODES.has(team.tla)) return team.tla;
  return NAME_TO_CODE[team.shortName] || NAME_TO_CODE[team.name] || team.tla;
}

// "GROUP_A" → "A"
function parseGroup(raw) {
  if (!raw) return null;
  return raw.replace(/^GROUP_/, '');
}

async function fetchMatches() {
  const url = 'https://api.football-data.org/v4/competitions/WC/matches';
  const res = await fetch(url, {
    headers: { 'X-Auth-Token': API_KEY },
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

async function main() {
  let raw;
  try {
    raw = await fetchMatches();
  } catch (err) {
    console.error('Failed to fetch results:', err.message);
    process.exit(1);
  }

  const matches = raw.matches ?? [];

  const groupMatches = [];
  const knockoutMatches = [];

  for (const m of matches) {
    const homeTeam = resolveTeam(m.homeTeam);
    const awayTeam = resolveTeam(m.awayTeam);
    const status = m.status; // SCHEDULED | IN_PLAY | PAUSED | FINISHED | POSTPONED

    const base = {
      homeTeam,
      awayTeam,
      homeScore: m.score?.fullTime?.home ?? null,
      awayScore: m.score?.fullTime?.away ?? null,
      status: status === 'FINISHED' ? 'FINISHED' : status === 'IN_PLAY' || status === 'PAUSED' ? 'IN_PLAY' : 'SCHEDULED',
      utcDate: m.utcDate ?? null,
    };

    if (m.stage === 'GROUP_STAGE') {
      groupMatches.push({ ...base, group: parseGroup(m.group) });
    } else if (['ROUND_OF_32', 'LAST_32'].includes(m.stage)) {
      knockoutMatches.push({ ...base, round: 'R32' });
    } else if (['ROUND_OF_16', 'LAST_16'].includes(m.stage)) {
      knockoutMatches.push({ ...base, round: 'R16' });
    } else if (m.stage === 'QUARTER_FINALS') {
      knockoutMatches.push({ ...base, round: 'QF' });
    } else if (m.stage === 'SEMI_FINALS') {
      knockoutMatches.push({ ...base, round: 'SF' });
    } else if (m.stage === 'FINAL') {
      knockoutMatches.push({ ...base, round: 'FINAL' });
    }
  }

  // Read existing file to detect meaningful changes
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
  } catch {
    // file missing — that's fine
  }

  const finishedNow = groupMatches.filter(m => m.status === 'FINISHED').length;
  const finishedBefore = (existing.groupMatches ?? []).filter(m => m.status === 'FINISHED').length;
  const changed = finishedNow !== finishedBefore;

  if (!changed && existing.lastUpdated) {
    console.log(`No new finished matches (${finishedNow} total). Skipping write.`);
    return;
  }

  const output = {
    lastUpdated: new Date().toISOString(),
    groupMatches,
    knockoutMatches,
  };

  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Updated results.json — ${finishedNow} group matches finished, ${knockoutMatches.filter(m => m.status === 'FINISHED').length} knockout matches finished.`);
}

main();

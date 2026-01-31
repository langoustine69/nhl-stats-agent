import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { createAgentApp } from '@lucid-agents/hono';
import { payments, paymentsFromEnv } from '@lucid-agents/payments';
import { z } from 'zod';

const NHL_API = 'https://api-web.nhle.com/v1';
const USER_AGENT = 'Mozilla/5.0 (compatible; NHLStatsAgent/1.0)';

const agent = await createAgent({
  name: 'nhl-stats-agent',
  version: '1.0.0',
  description: 'Live NHL hockey stats, standings, and player data. Real-time scores, league leaders, team rosters, and comprehensive reports from the official NHL API.',
})
  .use(http())
  .use(payments({ config: paymentsFromEnv() }))
  .build();

const { app, addEntrypoint } = await createAgentApp(agent);

// === HELPER: Fetch NHL API ===
async function fetchNHL(endpoint: string) {
  const response = await fetch(`${NHL_API}${endpoint}`, {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!response.ok) throw new Error(`NHL API error: ${response.status}`);
  return response.json();
}

// Team abbreviation mapping for lookups
const TEAMS: Record<string, string> = {
  'avalanche': 'COL', 'colorado': 'COL', 'col': 'COL',
  'oilers': 'EDM', 'edmonton': 'EDM', 'edm': 'EDM',
  'lightning': 'TBL', 'tampa': 'TBL', 'tbl': 'TBL',
  'bruins': 'BOS', 'boston': 'BOS', 'bos': 'BOS',
  'hurricanes': 'CAR', 'carolina': 'CAR', 'car': 'CAR',
  'stars': 'DAL', 'dallas': 'DAL', 'dal': 'DAL',
  'wild': 'MIN', 'minnesota': 'MIN', 'min': 'MIN',
  'penguins': 'PIT', 'pittsburgh': 'PIT', 'pit': 'PIT',
  'sabres': 'BUF', 'buffalo': 'BUF', 'buf': 'BUF',
  'canadiens': 'MTL', 'montreal': 'MTL', 'mtl': 'MTL',
  'knights': 'VGK', 'vegas': 'VGK', 'vgk': 'VGK',
  'sharks': 'SJS', 'sanjose': 'SJS', 'sjs': 'SJS',
  'kraken': 'SEA', 'seattle': 'SEA', 'sea': 'SEA',
  'ducks': 'ANA', 'anaheim': 'ANA', 'ana': 'ANA',
  'flames': 'CGY', 'calgary': 'CGY', 'cgy': 'CGY',
  'canucks': 'VAN', 'vancouver': 'VAN', 'van': 'VAN',
  'kings': 'LAK', 'losangeles': 'LAK', 'lak': 'LAK',
  'jets': 'WPG', 'winnipeg': 'WPG', 'wpg': 'WPG',
  'predators': 'NSH', 'nashville': 'NSH', 'nsh': 'NSH',
  'blues': 'STL', 'stlouis': 'STL', 'stl': 'STL',
  'blackhawks': 'CHI', 'chicago': 'CHI', 'chi': 'CHI',
  'mammoth': 'UTA', 'utah': 'UTA', 'uta': 'UTA',
  'panthers': 'FLA', 'florida': 'FLA', 'fla': 'FLA',
  'redwings': 'DET', 'detroit': 'DET', 'det': 'DET',
  'senators': 'OTT', 'ottawa': 'OTT', 'ott': 'OTT',
  'mapleleafs': 'TOR', 'toronto': 'TOR', 'tor': 'TOR',
  'rangers': 'NYR', 'newyork': 'NYR', 'nyr': 'NYR',
  'islanders': 'NYI', 'nyi': 'NYI',
  'devils': 'NJD', 'newjersey': 'NJD', 'njd': 'NJD',
  'flyers': 'PHI', 'philadelphia': 'PHI', 'phi': 'PHI',
  'capitals': 'WSH', 'washington': 'WSH', 'wsh': 'WSH',
  'bluejackets': 'CBJ', 'columbus': 'CBJ', 'cbj': 'CBJ',
};

function resolveTeam(input: string): string {
  const normalized = input.toLowerCase().replace(/\s+/g, '');
  return TEAMS[normalized] || input.toUpperCase();
}

// === FREE ENDPOINT: Overview ===
addEntrypoint({
  key: 'overview',
  description: 'Free NHL overview - top teams, leading scorers, and today\'s games',
  input: z.object({}),
  price: { amount: 0 },
  handler: async () => {
    const [standings, leaders, scores] = await Promise.all([
      fetchNHL('/standings/now'),
      fetchNHL('/skater-stats-leaders/current'),
      fetchNHL('/score/now').catch(() => ({ games: [] })),
    ]);

    const topTeams = standings.standings.slice(0, 5).map((t: any) => ({
      team: t.teamAbbrev.default,
      points: t.points,
      wins: t.wins,
      losses: t.losses,
      otLosses: t.otLosses,
      goalDiff: t.goalDifferential,
    }));

    const topScorers = leaders.points?.slice(0, 5).map((p: any) => ({
      name: `${p.firstName.default} ${p.lastName.default}`,
      team: p.teamAbbrev,
      points: p.value,
    })) || [];

    const todayGames = scores.games?.slice(0, 5).map((g: any) => ({
      home: g.homeTeam?.abbrev || 'TBD',
      away: g.awayTeam?.abbrev || 'TBD',
      state: g.gameState,
      homeScore: g.homeTeam?.score,
      awayScore: g.awayTeam?.score,
    })) || [];

    return {
      output: {
        topTeams,
        topScorers,
        todayGames,
        fetchedAt: new Date().toISOString(),
        dataSource: 'NHL Official API (live)',
      }
    };
  },
});

// === PAID ENDPOINT 1 ($0.001): Standings ===
addEntrypoint({
  key: 'standings',
  description: 'Full NHL standings by conference and division',
  input: z.object({
    conference: z.enum(['eastern', 'western', 'all']).optional().default('all'),
  }),
  price: { amount: 1000 },
  handler: async (ctx) => {
    const data = await fetchNHL('/standings/now');
    
    let standings = data.standings.map((t: any) => ({
      team: t.teamAbbrev.default,
      teamName: t.teamName.default,
      conference: t.conferenceAbbrev,
      division: t.divisionName,
      gamesPlayed: t.gamesPlayed,
      wins: t.wins,
      losses: t.losses,
      otLosses: t.otLosses,
      points: t.points,
      pointPctg: t.pointPctg,
      goalFor: t.goalFor,
      goalAgainst: t.goalAgainst,
      goalDifferential: t.goalDifferential,
      streak: `${t.streakCode}${t.streakCount}`,
      last10: `${t.l10Wins}-${t.l10Losses}-${t.l10OtLosses}`,
    }));

    if (ctx.input.conference !== 'all') {
      const conf = ctx.input.conference === 'eastern' ? 'E' : 'W';
      standings = standings.filter((t: any) => t.conference === conf);
    }

    return {
      output: {
        standings,
        asOf: data.standingsDateTimeUtc,
        count: standings.length,
      }
    };
  },
});

// === PAID ENDPOINT 2 ($0.002): Player Stats ===
addEntrypoint({
  key: 'player',
  description: 'Get detailed player stats by NHL player ID',
  input: z.object({
    playerId: z.number().describe('NHL player ID (e.g., 8478402 for McDavid)'),
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const data = await fetchNHL(`/player/${ctx.input.playerId}/landing`);
    
    const stats = data.featuredStats?.regularSeason?.subSeason || {};
    const career = data.featuredStats?.regularSeason?.career || {};

    return {
      output: {
        player: {
          id: data.playerId,
          name: `${data.firstName.default} ${data.lastName.default}`,
          team: data.currentTeamAbbrev,
          teamName: data.fullTeamName?.default,
          number: data.sweaterNumber,
          position: data.position,
          birthDate: data.birthDate,
          birthCity: data.birthCity?.default,
          birthCountry: data.birthCountry,
          height: data.heightInCentimeters,
          weight: data.weightInKilograms,
          shoots: data.shootsCatches,
        },
        currentSeason: {
          gamesPlayed: stats.gamesPlayed,
          goals: stats.goals,
          assists: stats.assists,
          points: stats.points,
          plusMinus: stats.plusMinus,
          pim: stats.pim,
          powerPlayGoals: stats.powerPlayGoals,
          gameWinningGoals: stats.gameWinningGoals,
          shots: stats.shots,
          shootingPctg: stats.shootingPctg,
        },
        career: {
          gamesPlayed: career.gamesPlayed,
          goals: career.goals,
          assists: career.assists,
          points: career.points,
        },
        headshot: data.headshot,
      }
    };
  },
});

// === PAID ENDPOINT 3 ($0.002): Leaders ===
addEntrypoint({
  key: 'leaders',
  description: 'NHL stats leaders - goals, assists, points, and more',
  input: z.object({
    category: z.enum(['goals', 'assists', 'points', 'plusMinus', 'gaa', 'savePctg']).optional().default('points'),
    limit: z.number().min(1).max(25).optional().default(10),
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const isGoalie = ['gaa', 'savePctg'].includes(ctx.input.category);
    const endpoint = isGoalie ? '/goalie-stats-leaders/current' : '/skater-stats-leaders/current';
    const data = await fetchNHL(endpoint);

    const categoryData = data[ctx.input.category] || [];
    const leaders = categoryData.slice(0, ctx.input.limit).map((p: any, idx: number) => ({
      rank: idx + 1,
      name: `${p.firstName.default} ${p.lastName.default}`,
      team: p.teamAbbrev,
      position: p.position,
      value: p.value,
    }));

    return {
      output: {
        category: ctx.input.category,
        leaders,
        count: leaders.length,
        fetchedAt: new Date().toISOString(),
      }
    };
  },
});

// === PAID ENDPOINT 4 ($0.003): Team Details ===
addEntrypoint({
  key: 'team',
  description: 'Team details with roster and recent performance',
  input: z.object({
    team: z.string().describe('Team name or abbreviation (e.g., "Bruins", "BOS", "Boston")'),
  }),
  price: { amount: 3000 },
  handler: async (ctx) => {
    const teamAbbrev = resolveTeam(ctx.input.team);
    
    const [roster, standings, schedule] = await Promise.all([
      fetchNHL(`/roster/${teamAbbrev}/current`),
      fetchNHL('/standings/now'),
      fetchNHL(`/club-schedule-season/${teamAbbrev}/now`).catch(() => ({ games: [] })),
    ]);

    const teamStanding = standings.standings.find((t: any) => 
      t.teamAbbrev.default === teamAbbrev
    );

    const formatPlayer = (p: any) => ({
      id: p.id,
      name: `${p.firstName.default} ${p.lastName.default}`,
      number: p.sweaterNumber,
      position: p.positionCode,
      birthCountry: p.birthCountry,
    });

    const recentGames = schedule.games?.slice(-5).map((g: any) => ({
      date: g.gameDate,
      opponent: g.homeTeam?.abbrev === teamAbbrev ? g.awayTeam?.abbrev : g.homeTeam?.abbrev,
      home: g.homeTeam?.abbrev === teamAbbrev,
      result: g.gameOutcome?.lastPeriodType,
    })) || [];

    return {
      output: {
        team: {
          abbrev: teamAbbrev,
          name: teamStanding?.teamName?.default,
          conference: teamStanding?.conferenceName,
          division: teamStanding?.divisionName,
        },
        standing: teamStanding ? {
          leagueRank: teamStanding.leagueSequence,
          conferenceRank: teamStanding.conferenceSequence,
          divisionRank: teamStanding.divisionSequence,
          points: teamStanding.points,
          record: `${teamStanding.wins}-${teamStanding.losses}-${teamStanding.otLosses}`,
          goalDiff: teamStanding.goalDifferential,
          streak: `${teamStanding.streakCode}${teamStanding.streakCount}`,
        } : null,
        roster: {
          forwards: roster.forwards?.map(formatPlayer) || [],
          defensemen: roster.defensemen?.map(formatPlayer) || [],
          goalies: roster.goalies?.map(formatPlayer) || [],
        },
        recentGames,
      }
    };
  },
});

// === PAID ENDPOINT 5 ($0.005): Comprehensive Report ===
addEntrypoint({
  key: 'report',
  description: 'Full NHL report - standings, leaders, schedule, and injury updates',
  input: z.object({
    conference: z.enum(['eastern', 'western', 'all']).optional().default('all'),
  }),
  price: { amount: 5000 },
  handler: async (ctx) => {
    const [standings, skaterLeaders, goalieLeaders, scores] = await Promise.all([
      fetchNHL('/standings/now'),
      fetchNHL('/skater-stats-leaders/current'),
      fetchNHL('/goalie-stats-leaders/current'),
      fetchNHL('/score/now').catch(() => ({ games: [] })),
    ]);

    let filteredStandings = standings.standings;
    if (ctx.input.conference !== 'all') {
      const conf = ctx.input.conference === 'eastern' ? 'E' : 'W';
      filteredStandings = filteredStandings.filter((t: any) => t.conferenceAbbrev === conf);
    }

    const standingsSummary = filteredStandings.map((t: any) => ({
      rank: t.leagueSequence,
      team: t.teamAbbrev.default,
      points: t.points,
      record: `${t.wins}-${t.losses}-${t.otLosses}`,
      goalDiff: t.goalDifferential,
      last10: `${t.l10Wins}-${t.l10Losses}-${t.l10OtLosses}`,
      streak: `${t.streakCode}${t.streakCount}`,
    }));

    const topGoals = skaterLeaders.goals?.slice(0, 5).map((p: any) => ({
      name: `${p.firstName.default} ${p.lastName.default}`,
      team: p.teamAbbrev,
      value: p.value,
    })) || [];

    const topAssists = skaterLeaders.assists?.slice(0, 5).map((p: any) => ({
      name: `${p.firstName.default} ${p.lastName.default}`,
      team: p.teamAbbrev,
      value: p.value,
    })) || [];

    const topPoints = skaterLeaders.points?.slice(0, 5).map((p: any) => ({
      name: `${p.firstName.default} ${p.lastName.default}`,
      team: p.teamAbbrev,
      value: p.value,
    })) || [];

    const topGoalies = goalieLeaders.savePctg?.slice(0, 5).map((p: any) => ({
      name: `${p.firstName.default} ${p.lastName.default}`,
      team: p.teamAbbrev,
      savePctg: p.value,
    })) || [];

    const todayGames = scores.games?.map((g: any) => ({
      gameId: g.id,
      home: g.homeTeam?.abbrev,
      away: g.awayTeam?.abbrev,
      state: g.gameState,
      homeScore: g.homeTeam?.score,
      awayScore: g.awayTeam?.score,
      startTime: g.startTimeUTC,
      venue: g.venue?.default,
    })) || [];

    return {
      output: {
        standings: standingsSummary,
        leaders: {
          goals: topGoals,
          assists: topAssists,
          points: topPoints,
          goalies: topGoalies,
        },
        todaySchedule: todayGames,
        summary: {
          teamsCount: standingsSummary.length,
          gamesCount: todayGames.length,
          asOf: standings.standingsDateTimeUtc,
        },
        generatedAt: new Date().toISOString(),
      }
    };
  },
});

const port = Number(process.env.PORT ?? 3000);
console.log(`🏒 NHL Stats Agent running on port ${port}`);

export default { port, fetch: app.fetch };

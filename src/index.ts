import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { createAgentApp } from '@lucid-agents/hono';
import { payments, paymentsFromEnv } from '@lucid-agents/payments';
import { analytics, getSummary, getAllTransactions, exportToCSV } from '@lucid-agents/analytics';
import { z } from 'zod';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl';
const ESPN_V2 = 'https://site.api.espn.com/apis/v2/sports/hockey/nhl';

const agent = await createAgent({
  name: 'nhl-stats-agent',
  version: '1.0.0',
  description: 'Real-time NHL hockey stats, scores, standings, and player data via ESPN. Built for agents needing sports data.',
})
  .use(http())
  .use(payments({ config: paymentsFromEnv() }))
  .use(analytics())
  .build();

const { app, addEntrypoint } = await createAgentApp(agent);

// === HELPER: Fetch ESPN data ===
async function fetchESPN(path: string) {
  const response = await fetch(`${ESPN_BASE}${path}`);
  if (!response.ok) throw new Error(`ESPN API error: ${response.status}`);
  return response.json();
}

// === FREE ENDPOINT: League overview ===
addEntrypoint({
  key: 'overview',
  description: 'Free NHL overview - current season standings and today\'s games',
  input: z.object({}),
  price: { amount: 0 },
  handler: async () => {
    const [scoreboard, standingsRes] = await Promise.all([
      fetchESPN('/scoreboard'),
      fetch(`${ESPN_V2}/standings`).then(r => r.json())
    ]);
    
    // Extract today's games
    const todaysGames = scoreboard.events?.map((e: any) => ({
      name: e.name,
      date: e.date,
      status: e.status?.type?.description,
      homeTeam: e.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'home')?.team?.displayName,
      awayTeam: e.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'away')?.team?.displayName,
      homeScore: e.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'home')?.score,
      awayScore: e.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'away')?.score,
    })) || [];
    
    // Extract top 5 teams per conference
    const topTeams = standingsRes.children?.slice(0, 2).map((conf: any) => ({
      conference: conf.name,
      leaders: conf.standings?.entries?.slice(0, 5).map((e: any) => ({
        team: e.team?.displayName,
        wins: e.stats?.find((s: any) => s.name === 'wins')?.value,
        losses: e.stats?.find((s: any) => s.name === 'losses')?.value,
        points: e.stats?.find((s: any) => s.name === 'points')?.value,
      }))
    })) || [];
    
    return {
      output: {
        todaysGames,
        topTeams,
        fetchedAt: new Date().toISOString(),
        dataSource: 'ESPN NHL API (live)'
      }
    };
  },
});

// === PAID ENDPOINT 1: Live scores ($0.001) ===
addEntrypoint({
  key: 'scores',
  description: 'Live NHL scores for today or specific date',
  input: z.object({
    date: z.string().optional().describe('Date in YYYYMMDD format, defaults to today')
  }),
  price: { amount: 1000 },
  handler: async (ctx) => {
    const dateParam = ctx.input.date ? `?dates=${ctx.input.date}` : '';
    const data = await fetchESPN(`/scoreboard${dateParam}`);
    
    const games = data.events?.map((e: any) => {
      const competition = e.competitions?.[0];
      const home = competition?.competitors?.find((c: any) => c.homeAway === 'home');
      const away = competition?.competitors?.find((c: any) => c.homeAway === 'away');
      
      return {
        id: e.id,
        name: e.name,
        date: e.date,
        status: e.status?.type?.description,
        period: e.status?.period,
        clock: e.status?.displayClock,
        homeTeam: {
          name: home?.team?.displayName,
          abbreviation: home?.team?.abbreviation,
          score: home?.score,
          record: home?.records?.[0]?.summary
        },
        awayTeam: {
          name: away?.team?.displayName,
          abbreviation: away?.team?.abbreviation,
          score: away?.score,
          record: away?.records?.[0]?.summary
        },
        venue: competition?.venue?.fullName,
        broadcast: competition?.broadcasts?.[0]?.names?.[0]
      };
    }) || [];
    
    return { output: { games, count: games.length, fetchedAt: new Date().toISOString() } };
  },
});

// === PAID ENDPOINT 2: Team details ($0.002) ===
addEntrypoint({
  key: 'team',
  description: 'Detailed team info including roster, stats, and schedule',
  input: z.object({
    teamId: z.string().describe('ESPN team ID (e.g., "1" for Bruins, "10" for Maple Leafs)')
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const [team, roster] = await Promise.all([
      fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${ctx.input.teamId}`).then(r => r.json()),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${ctx.input.teamId}/roster`).then(r => r.json())
    ]);
    
    // Roster is grouped by position (Centers, Left Wings, etc.)
    const rosterData: any[] = [];
    if (Array.isArray(roster.athletes)) {
      for (const posGroup of roster.athletes) {
        if (posGroup.items) {
          for (const player of posGroup.items) {
            rosterData.push({
              name: player.fullName,
              position: player.position?.abbreviation,
              jersey: player.jersey,
              age: player.age,
              birthPlace: player.birthPlace?.country
            });
          }
        }
      }
    }
    
    return {
      output: {
        team: {
          id: team.team?.id,
          name: team.team?.displayName,
          abbreviation: team.team?.abbreviation,
          location: team.team?.location,
          color: team.team?.color,
          logo: team.team?.logos?.[0]?.href,
          venue: team.team?.franchise?.venue?.fullName,
          record: team.team?.record?.items?.[0]?.summary
        },
        roster: rosterData.slice(0, 25),
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === PAID ENDPOINT 3: Standings ($0.002) ===
addEntrypoint({
  key: 'standings',
  description: 'Full NHL standings by conference',
  input: z.object({
    conference: z.enum(['eastern', 'western', 'all']).optional().default('all')
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const response = await fetch(`${ESPN_V2}/standings`);
    if (!response.ok) throw new Error(`Standings API error: ${response.status}`);
    const data = await response.json();
    
    const standings = data.children?.map((conf: any) => ({
      conference: conf.name,
      teams: conf.standings?.entries?.map((e: any) => ({
        rank: e.stats?.find((s: any) => s.name === 'playoffSeed')?.value,
        team: e.team?.displayName,
        abbreviation: e.team?.abbreviation,
        gamesPlayed: e.stats?.find((s: any) => s.name === 'gamesPlayed')?.value,
        wins: e.stats?.find((s: any) => s.name === 'wins')?.value,
        losses: e.stats?.find((s: any) => s.name === 'losses')?.value,
        otLosses: e.stats?.find((s: any) => s.name === 'otLosses')?.value,
        points: e.stats?.find((s: any) => s.name === 'points')?.value,
        goalsFor: e.stats?.find((s: any) => s.name === 'pointsFor')?.value,
        goalsAgainst: e.stats?.find((s: any) => s.name === 'pointsAgainst')?.value,
      })) || []
    })) || [];
    
    // Filter by conference if specified
    const filtered = ctx.input.conference === 'all' 
      ? standings 
      : standings.filter((s: any) => s.conference.toLowerCase().includes(ctx.input.conference));
    
    return { output: { standings: filtered, fetchedAt: new Date().toISOString() } };
  },
});

// === PAID ENDPOINT 4: Player stats ($0.003) ===
addEntrypoint({
  key: 'player',
  description: 'Player statistics and career info',
  input: z.object({
    playerId: z.string().describe('ESPN player ID (get from team roster)')
  }),
  price: { amount: 3000 },
  handler: async (ctx) => {
    const response = await fetch(`https://site.api.espn.com/apis/common/v3/sports/hockey/nhl/athletes/${ctx.input.playerId}`);
    if (!response.ok) {
      return { output: { error: `Player not found (${response.status})`, playerId: ctx.input.playerId } };
    }
    const data = await response.json();
    
    if (data.code || !data.athlete) {
      return { output: { error: 'Player not found', playerId: ctx.input.playerId } };
    }
    
    const athlete = data.athlete;
    return {
      output: {
        player: {
          id: athlete?.id,
          name: athlete?.displayName,
          firstName: athlete?.firstName,
          lastName: athlete?.lastName,
          jersey: athlete?.jersey,
          position: athlete?.position?.displayName,
          team: athlete?.team?.displayName,
          age: athlete?.age,
          height: athlete?.displayHeight,
          weight: athlete?.displayWeight,
          birthDate: athlete?.dateOfBirth,
          birthPlace: athlete?.birthPlace ? `${athlete.birthPlace.city}, ${athlete.birthPlace.country}` : null,
          experience: athlete?.experience?.years,
          status: athlete?.status?.type
        },
        stats: athlete?.statistics?.slice(0, 3),
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === PAID ENDPOINT 5: Schedule ($0.002) ===
addEntrypoint({
  key: 'schedule',
  description: 'Upcoming NHL games schedule',
  input: z.object({
    days: z.number().optional().default(3).describe('Number of days to fetch (max 7)')
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const daysToFetch = Math.min(ctx.input.days, 7);
    const games: any[] = [];
    
    // Fetch multiple days sequentially to avoid overload
    for (let i = 0; i < daysToFetch; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
      
      try {
        const data = await fetchESPN(`/scoreboard?dates=${dateStr}`);
        const dayGames = data.events?.map((e: any) => ({
          id: e.id,
          name: e.name,
          date: e.date,
          status: e.status?.type?.description,
          venue: e.competitions?.[0]?.venue?.fullName,
          broadcast: e.competitions?.[0]?.broadcasts?.[0]?.names?.[0]
        })) || [];
        games.push(...dayGames);
      } catch (e) {
        // Skip failed dates
      }
    }
    
    return { output: { schedule: games, count: games.length, fetchedAt: new Date().toISOString() } };
  },
});

// === PAID ENDPOINT 6: Game details ($0.005) ===
addEntrypoint({
  key: 'game',
  description: 'Detailed game info including box score and play-by-play summary',
  input: z.object({
    gameId: z.string().describe('ESPN game ID')
  }),
  price: { amount: 5000 },
  handler: async (ctx) => {
    const [summary, boxscore] = await Promise.all([
      fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${ctx.input.gameId}`).then(r => r.json()),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard/${ctx.input.gameId}`).then(r => r.json()).catch(() => null)
    ]);
    
    const competition = summary.header?.competitions?.[0];
    const home = competition?.competitors?.find((c: any) => c.homeAway === 'home');
    const away = competition?.competitors?.find((c: any) => c.homeAway === 'away');
    
    // Get scoring plays
    const scoringPlays = summary.scoringPlays?.map((p: any) => ({
      period: p.period?.number,
      time: p.clock?.displayValue,
      team: p.team?.abbreviation,
      description: p.text,
      score: `${p.awayScore}-${p.homeScore}`
    })) || [];
    
    // Get team stats
    const teamStats = summary.boxscore?.teams?.map((t: any) => ({
      team: t.team?.abbreviation,
      stats: t.statistics?.map((s: any) => ({
        name: s.name,
        value: s.displayValue
      }))
    })) || [];
    
    return {
      output: {
        game: {
          id: ctx.input.gameId,
          name: summary.header?.gameNote || `${away?.team?.displayName} @ ${home?.team?.displayName}`,
          date: competition?.date,
          status: competition?.status?.type?.description,
          venue: summary.gameInfo?.venue?.fullName,
          attendance: summary.gameInfo?.attendance
        },
        score: {
          home: { team: home?.team?.displayName, score: home?.score },
          away: { team: away?.team?.displayName, score: away?.score }
        },
        scoringPlays,
        teamStats,
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === ANALYTICS ENDPOINTS (FREE) ===
addEntrypoint({
  key: 'analytics',
  description: 'Payment analytics summary',
  input: z.object({
    windowMs: z.number().optional().describe('Time window in ms')
  }),
  price: { amount: 0 },
  handler: async (ctx) => {
    const tracker = agent.analytics?.paymentTracker;
    if (!tracker) {
      return { output: { error: 'Analytics not available', payments: [] } };
    }
    const summary = await getSummary(tracker, ctx.input.windowMs);
    return {
      output: {
        ...summary,
        outgoingTotal: summary.outgoingTotal.toString(),
        incomingTotal: summary.incomingTotal.toString(),
        netTotal: summary.netTotal.toString(),
      }
    };
  },
});

addEntrypoint({
  key: 'analytics-transactions',
  description: 'Recent payment transactions',
  input: z.object({
    windowMs: z.number().optional(),
    limit: z.number().optional().default(50)
  }),
  price: { amount: 0 },
  handler: async (ctx) => {
    const tracker = agent.analytics?.paymentTracker;
    if (!tracker) {
      return { output: { transactions: [] } };
    }
    const txs = await getAllTransactions(tracker, ctx.input.windowMs);
    return { output: { transactions: txs.slice(0, ctx.input.limit) } };
  },
});

// Serve icon
import { readFileSync, existsSync } from 'fs';

app.get('/icon.png', (c) => {
  if (existsSync('./icon.png')) {
    const icon = readFileSync('./icon.png');
    return new Response(icon, { headers: { 'Content-Type': 'image/png' } });
  }
  return c.text('Icon not found', 404);
});

// ERC-8004 registration file
app.get('/.well-known/erc8004.json', (c) => {
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : 'https://nhl-stats-agent-production.up.railway.app';
  return c.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "nhl-stats-agent",
    description: "Real-time NHL hockey stats, scores, standings, and player data. 1 free + 6 paid endpoints via x402.",
    image: `${baseUrl}/icon.png`,
    services: [
      { name: "web", endpoint: baseUrl },
      { name: "A2A", endpoint: `${baseUrl}/.well-known/agent.json`, version: "0.3.0" }
    ],
    x402Support: true,
    active: true,
    registrations: [],
    supportedTrust: ["reputation"]
  });
});

const port = Number(process.env.PORT ?? 3000);
console.log(`NHL Stats Agent running on port ${port}`);

export default { port, fetch: app.fetch };

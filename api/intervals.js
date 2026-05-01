// Vercel Serverless Function — proxies requests to Intervals.icu API
// Fetches both planned events and completed activities for a date range.
//
// Usage: GET /api/intervals?oldest=2026-04-27&newest=2026-05-03
//
// Requires environment variables set in Vercel dashboard:
//   INTERVALS_API_KEY  — your Intervals.icu API key
//   INTERVALS_ATHLETE  — your athlete ID (e.g. "i12345" or "0" for authenticated user)

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.INTERVALS_API_KEY;
  const athleteId = process.env.INTERVALS_ATHLETE || '0';

  if (!apiKey) {
    return res.status(500).json({
      error: 'INTERVALS_API_KEY not configured. Add it in Vercel → Settings → Environment Variables.'
    });
  }

  const { oldest, newest, debug } = req.query;
  if (!oldest || !newest) {
    return res.status(400).json({ error: 'Missing oldest or newest query parameters (YYYY-MM-DD).' });
  }

  const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');
  const headers = {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json'
  };

  try {
    // Fetch both endpoints in parallel
    const [activitiesResp, eventsResp] = await Promise.all([
      fetch(
        `https://intervals.icu/api/v1/athlete/${athleteId}/activities?oldest=${oldest}&newest=${newest}`,
        { headers }
      ),
      fetch(
        `https://intervals.icu/api/v1/athlete/${athleteId}/events.json?oldest=${oldest}&newest=${newest}`,
        { headers }
      )
    ]);

    if (!activitiesResp.ok) {
      const text = await activitiesResp.text();
      return res.status(activitiesResp.status).json({
        error: `Intervals.icu activities API error: ${activitiesResp.status}`,
        detail: text
      });
    }
    if (!eventsResp.ok) {
      const text = await eventsResp.text();
      return res.status(eventsResp.status).json({
        error: `Intervals.icu events API error: ${eventsResp.status}`,
        detail: text
      });
    }

    const activities = await activitiesResp.json();
    const events = await eventsResp.json();

    // Debug mode: return raw API responses
    if (debug === 'true') {
      return res.status(200).json({
        _debug: true,
        athlete_id: athleteId,
        activity_count: activities.length,
        event_count: events.length,
        activities: activities.slice(0, 5),
        events: events.slice(0, 10)
      });
    }

    // ── Process ACTIVITIES (completed rides) ──
    const actByDate = {};
    for (const act of activities) {
      const type = (act.type || '').toLowerCase();
      if (!type.includes('ride') && !type.includes('cycling') && !type.includes('virtualride')) {
        continue;
      }
      const date = act.start_date_local ? act.start_date_local.slice(0, 10) : null;
      if (!date) continue;

      let energy = act.icu_joules ? Math.round(act.icu_joules / 1000)
                 : act.calories ? Math.round(act.calories)
                 : null;

      const avgWatts = act.icu_average_watts || null;
      const movingTime = act.moving_time || act.elapsed_time || 0;

      if (!energy && avgWatts && movingTime) {
        energy = Math.round(avgWatts * movingTime / 1000);
      }

      if (!actByDate[date]) actByDate[date] = [];
      actByDate[date].push({
        id: act.id,
        name: act.name || '',
        type: act.type || '',
        date,
        movingTime,
        elapsedTime: act.elapsed_time || 0,
        avgWatts,
        normalizedWatts: act.icu_weighted_avg_watts || null,
        energy,
        icu_training_load: act.icu_training_load || null,
        icu_intensity: act.icu_intensity || null,
        distance: act.distance || act.icu_distance || 0,
      });
    }

    // Aggregate activities per day
    const actResult = {};
    for (const [date, acts] of Object.entries(actByDate)) {
      const totalEnergy = acts.reduce((s, a) => s + (a.energy || 0), 0);
      const totalTime = acts.reduce((s, a) => s + (a.movingTime || 0), 0);
      const powers = acts.filter(a => a.avgWatts).map(a => a.avgWatts);
      const avgPower = powers.length
        ? Math.round(powers.reduce((s, p) => s + p, 0) / powers.length)
        : null;
      actResult[date] = {
        rideCount: acts.length,
        totalEnergy,
        totalTime,
        avgWatts: avgPower,
        rides: acts
      };
    }

    // ── Process EVENTS (planned workouts) ──
    const evtByDate = {};
    for (const evt of events) {
      const date = evt.start_date_local ? evt.start_date_local.slice(0, 10) : null;
      if (!date) continue;

      // Include cycling events + rest days / notes
      const cat = (evt.category || '').toUpperCase();
      const type = (evt.type || '').toUpperCase();

      // We want: RIDE events, and also NOTE/OTHER for rest-day markers
      const isCycling = cat === 'RIDE' || cat === 'CYCLING' || cat === 'VIRTUALRIDE'
                     || type === 'RIDE' || type === 'CYCLING' || type === 'VIRTUALRIDE';
      const isNote = cat === 'NOTE' || type === 'NOTE';
      const isRest = (evt.name || '').toLowerCase().includes('rest')
                  || (evt.name || '').toLowerCase().includes('off');

      if (!isCycling && !isNote && !isRest) continue;

      if (!evtByDate[date]) evtByDate[date] = [];
      evtByDate[date].push({
        id: evt.id,
        name: evt.name || '',
        description: evt.description || '',
        category: evt.category || '',
        type: evt.type || '',
        movingTime: evt.moving_time || 0,        // planned duration in seconds
        joules: evt.joules || 0,                  // planned energy
        icu_ftp: evt.icu_ftp || null,
        icu_intensity: evt.icu_intensity || null,  // planned IF
        icu_training_load: evt.icu_training_load || null,
        color: evt.color || null,
      });
    }

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
    return res.status(200).json({
      activities: actResult,
      events: evtByDate
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}
